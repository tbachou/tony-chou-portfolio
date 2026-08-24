# 0010 child: Prediction intervals

## Summary

Every prediction carries a range, not just a number, and that range comes from how wrong the same forecaster has been before in similar conditions. The catch is that "similar conditions" can only be judged from what the river is doing when the forecast is made, while the conditions that turn out to matter are the ones at the moment it comes true. This child settles that by recording both, and by saying exactly what happens when there is not enough history to draw a range from.

## Context

The parent spec requires every prediction to carry a lower and an upper bound, and requires those bounds to be conditioned on the river's regime rather than pooled across all conditions. It does not say which regime, because until the scoring loop was built it was not obvious there were two.

A regime is recorded twice in the life of one prediction. When the forecast is made, the river is doing something, and that is all the forecaster can see. When the forecast comes true, the river is doing something else, and that is what determines whether the forecast was any good. On this creek the two differ often enough to matter: a calm reading twelve hours before a storm looks exactly like a calm reading on a quiet week.

There is a second gap in the same area. The parent requires a wide placeholder interval before enough scored history exists, and requires such a prediction to be marked, but gives neither a width nor a field to mark it in. A build reaching this point has to invent both, and an invented interval width is the kind of number nobody revisits.

Neither gap can be deferred. Slice 2 issues its first predictions the moment the cron runs, and a prediction's bounds are written once and never recomputed, so anything wrong here is wrong permanently in the record.

## Requirements

**User stories**:

- As a visitor, I want each forecast to show how confident it is, so that a number in the middle of a storm is not read with the same weight as one on a calm Tuesday.
- As the builder, I want an interval that is honest on day one rather than absent, so the scorecard is complete from the first prediction instead of filling in months later.
- As the builder, I want to see when an interval is not properly grounded, so a wide guess is never mistaken for a measured claim.

**Acceptance criteria**:

- **AC-I1**: `Prediction` carries `issueRegime`, the regime at `issuedAt`, written by the job that used it to pick the interval bucket. It is nullable, and null means the regime could not be classified. `Score.regime` keeps its own meaning, the regime at `targetTime`, and is also made nullable for the same reason.
- **AC-I2**: interval bounds are multiplicative. Given a central estimate `c`, the bounds are `c * q10` and `c * q90`, where the quantiles are taken over the ratio `actualCfs / centralCfs` from past scores of the same model, gauge, horizon and issue regime.
- **AC-I3**: the quantile levels are 0.10 and 0.90, and `intervalLevel` is stored as 0.80 on every prediction. Quantiles use linear interpolation between order statistics (the R type 7 definition, which is also numpy's default): for `n` sorted ratios the index is `1 + p * (n - 1)`, interpolating between the two neighbouring values.
- **AC-I4**: a bucket, regime conditioned or pooled, needs at least 30 errors before its quantiles may be used. Measured against the backfilled record, all three regimes clear this: 2,731 baseflow, 518 rising and 291 peak issue times.
- **AC-I5**: when the regime bucket is thin, the fallback runs in order: pooled quantiles across all regimes for the same model, gauge and horizon, and if that is also under 30, the fixed band `[c / 3, c * 3]`. Both fallbacks set `intervalSeeded` false.
- **AC-I6**: when the regime at issue time cannot be classified, the prediction is still issued, `issueRegime` is written null, pooled quantiles are used, and `intervalSeeded` is false. This path is real but rare: 40 of 3,580 issue times on the backfilled record.
- **AC-I7**: `intervalSeeded` is true only when the bounds came from the regime conditioned bucket. It records whether the interval meets AC-21's conditioning requirement, not merely whether 30 errors existed. The column defaults to false, so an insert that forgets it cannot claim conditioning it does not have.
- **AC-I8**: `lowerCfs` is at or below `centralCfs`, which is at or below `upperCfs`, on every prediction without exception. When the raw quantiles would break that ordering, the offending bound is clamped to the central estimate and `intervalClamped` is set true.
- **AC-I9**: hindcast predictions are written as real `Prediction` and `Score` rows with `hindcast` true. They feed the quantiles and are excluded from every public read.
- **AC-I10**: a prediction that has been scored more than once contributes exactly one error to any quantile computation: the score with the greatest `actualRecordedAt`, breaking a tie on `id` so the choice is deterministic.
- **AC-I11**: a prediction's bounds are written once, at issue, and never recomputed. `q10Used`, `q90Used` and `bucketSize` are stored beside them so any interval can be explained after the fact.
- **AC-I12**: the bucket excludes any score whose prediction had a `centralCfs` at or below zero, so a zero or negative denominator cannot poison it.
- **AC-I13**: when building the interval for a prediction issued at `T`, the bucket includes only scores whose `actualRecordedAt` is at or before `T`. Without this a hindcast interval would be built from forecasts issued after the moment it simulates, which is the leakage AC-13 and AC-14 exist to prevent.
- **AC-I14**: every public read goes through one query helper that filters `hindcast` false. No endpoint composes its own predicate.

## Options considered

### Option 1: condition on the target regime, accept the mismatch

Keep the single `regime` column, bucket scores by the regime at `targetTime`, and at prediction time pick a bucket using the issue time regime as a stand in.

**Pros**:

- No schema change, and reporting keeps its natural meaning.

**Cons**:

- The population the quantiles are drawn from is not the population that was identified. A calm looking moment that turns into a storm draws from the calm bucket, so the interval is narrow exactly when it should be wide, and the miscalibration is invisible because both halves look correct on their own.

### Option 2: condition on the issue regime, and report by it too

Re tag `Score.regime` to mean the regime at issue time. Intervals and reporting then agree by construction.

**Pros**:

- One column, perfectly consistent, nothing can drift apart.

**Cons**:

- "Skill during storms" would mean "skill when it looked stormy at issue", which is a weaker and more confusing claim than the one AC-15 wants to make. The interesting failure, calm at issue and stormy at target, disappears into the calm bucket permanently.

### Option 3: record both regimes, one on each table (chosen)

`Prediction.issueRegime` is the regime when the forecast was made, written by the prediction job that used it. `Score.regime` stays the regime when it came true. Intervals draw on the first because that is all a forecaster can know. Reporting splits by the second because that is what actually happened.

**Pros**:

- Both uses are correct rather than one being compromised for the other.
- The gap between the two regimes is itself the forecasting problem, and recording both makes it measurable instead of averaged away.
- Each table holds exactly one regime, meaning the regime at that row's own defining instant, so grouping by the wrong one is nearly impossible.
- The regime that was actually used to pick the bucket is recorded by the job that used it, which makes the seeded flag auditable rather than an assertion.

**Cons**:

- Two tables must each compute a regime correctly, and the two computations run in different jobs against different reconstructions.
- A prediction is written before its score exists, so the two regimes for one forecast live in rows created hours apart, and any query comparing them must join.

## Decision

**Chosen option**: Option 3: record both regimes, one on each table.

Intervals are multiplicative, drawn from the ratio `actual / predicted` over that model's own scored history at the same horizon and the same issue time regime. Where that bucket is thin, the fallback degrades to pooled quantiles and then to a fixed wide band, and anything short of the regime conditioned bucket is marked unseeded. The ordering invariant is enforced by clamping, and a clamp is recorded rather than hidden.

**Implementation skills**: `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Rationale

The parent spec asks for intervals conditioned on regime and for a placeholder when history is thin, but it does not say which regime, in what units, or how wide the placeholder is. Each of those is load bearing, and a build would have had to invent all three.

**Why both regimes.** The whole reason regime conditioning exists is that persistence is roughly 9 percent wrong on a calm river and roughly 37 percent wrong on a rising one, measured over 3,552 issue times on the real record. An interval that ignores that spread is either uselessly wide most of the time or dangerously narrow when it matters. But the regime at issue is a genuinely different thing from the regime at target, and conflating them buys consistency at the cost of the one comparison worth making. Two columns is a small price.

**Why multiplicative.** This creek runs from about 11 to 13,200 cubic feet per second. A band expressed in cubic feet per second is absurd at baseflow and meaningless at a peak, and conditioning on regime narrows that range without closing it: the peak regime alone spans an order of magnitude. Ratios travel across the whole range, which is the same reason the hydrograph is drawn on a logarithmic axis. Note that the ratio divides by the prediction, not by the actual, so it needs no low flow floor: a prediction is either a real reading or a mean of real readings, and neither approaches zero. `pctError` keeps its floor because it divides by the actual, which can.

**Why a third to triple.** The placeholder has one job: never to imply more confidence than exists. Measured persistence error at 24 hours has a 90th percentile of 56 percent and a 99th of about 150 percent, so a band of half to double would be roughly the real 80 percent interval on a calm day and far too tight during a storm, which is precisely when an unseeded interval is most likely to be wrong. A third to triple sits outside anything observed, so it reads unmistakably as "we do not know yet".

**Why unseeded means unconditioned.** Defining the flag as "fewer than 30 errors" would leave the unclassifiable case with nowhere honest to sit: pooled quantiles are real data, so calling them unseeded on a sample size basis would be wrong, but calling them seeded would claim conditioning that did not happen. Defining it as "these bounds do not meet AC-21's conditioning requirement" covers both cases and is the thing a reader actually needs to know.

**Why hindcast rows are real but flagged.** Storing only the resulting quantiles would make day one intervals unauditable, and a seed nobody can recompute is a number of unknown provenance sitting under every early prediction. Writing them as ordinary rows without distinction would be worse in the other direction: the scorecard's claim is that it scores every prediction it has ever made, and thousands of retrospectively computed forecasts would quietly weaken that into something much less impressive. Real rows behind a flag keep both properties.

**Why the buckets are reachable.** The obvious risk with conditioning on a rare state is that its bucket never fills, leaving the regime the design exists to serve permanently on pooled quantiles. Measured against the backfilled record rather than assumed: of 3,580 six hourly issue times, 2,731 are baseflow, 518 rising, 291 peak and 40 unclassifiable. Peak clears the 30 minimum by roughly ten times, so no merged bucket tier is needed. Worth re measuring if the regime thresholds ever change.

**Why the interval records its own provenance.** The bucket grows over time, so bounds written today cannot be reconstructed tomorrow from the same query. Storing `q10Used`, `q90Used` and `bucketSize` beside the bounds is the same argument this spec already makes for writing hindcast rows rather than bare quantiles: a number of unknown provenance under every prediction is not auditable, and AC-I11 makes the bounds permanent.

**Why the cutoff exists.** A hindcast prediction's central estimate goes through the as of reconstruction, so it cannot see the future. Its interval would have, because the bucket query has no natural time bound. That asymmetry is invisible in review, since only half the calculation looks like a temporal read, which is exactly why it is stated as its own acceptance criterion.

**Why clamping is recorded.** A model whose 10th percentile ratio exceeds 1.0 is systematically under predicting, and that is a finding, not an inconvenience. Enforcing the ordering invariant silently would discard the signal at the moment it first appears. Dropping the invariant instead was rejected because the parent spec already states it and every consumer, including the chart, assumes it.

## Feature design

**Data model changes**

| Entity | Field | Type | Notes |
|---|---|---|---|
| `Prediction` | `issueRegime` | `Regime`, nullable | The regime at `issuedAt`, written by the prediction job that used it to pick the bucket. Null means it could not be classified. |
| `Prediction` | `hindcast` | `Boolean`, default `false` | True for rows produced by the seeding hindcast rather than issued live. |
| `Prediction` | `intervalClamped` | `Boolean`, default `false` | True when a raw quantile would have broken the ordering invariant. |
| `Prediction` | `intervalSeeded` | `Boolean`, default `false` | Already built in slice 2 step 5 with default `true`; the default flips, so a forgotten insert cannot claim conditioning. |
| `Prediction` | `q10Used`, `q90Used` | `Float`, nullable | The ratios the bounds were built from. Null on the fixed band path. |
| `Prediction` | `bucketSize` | `Int`, default `0` | How many errors the quantiles were drawn from. |
| `Score` | `regime` | `Regime`, becomes nullable | Already built as required. `classifyRegime` legitimately returns null, so a required column has no legal value to write. |

`Score` gains nothing. The regime it already carries is the only one it should hold.

**Value sourcing**

| Action | Value produced | Source |
|---|---|---|
| predict | `Prediction.issueRegime` | derived: `classifyRegime` over the as of reconstruction at `issuedAt`. Null when it cannot be judged. |
| predict | interval bucket | derived: scores joined to their predictions where `modelVersionId`, `gaugeId`, `horizonHours` and `issueRegime` all match, `hindcast` is any value, `centralCfs` is above zero, and `actualRecordedAt` is at or before this prediction's `issuedAt`. One score per prediction: the greatest `actualRecordedAt`, tie broken on `id`. |
| predict | pooled bucket | derived: the same query with the `issueRegime` condition dropped. Same 30 minimum. |
| predict | `q10Used`, `q90Used` | derived: the 0.10 and 0.90 quantiles of `actualCfs / centralCfs` over the bucket, by linear interpolation at index `1 + p * (n - 1)` |
| predict | `lowerCfs`, `upperCfs` | derived: `centralCfs * q10Used` and `centralCfs * q90Used`, then clamped to preserve ordering |
| predict | `bucketSize` | derived: the row count of the bucket actually used |
| predict | `intervalLevel` | constant `0.80` |
| predict | `intervalSeeded` | derived: true only when the regime conditioned bucket held at least 30 errors |
| predict | `intervalClamped` | derived: true when either clamp fired |
| predict | fixed band | constants: lower `centralCfs / 3`, upper `centralCfs * 3` |
| predict | minimum bucket size | constant `30`, for both the conditioned and the pooled bucket |
| score | `Score.regime` | derived: `classifyRegime` at `targetTime`, null when it cannot be judged |
| hindcast | issue times | derived: every 6 hours from `BACKFILL_START` (2024-01-01) to the present, matching the live cron's 00, 06, 12 and 18 UTC |
| hindcast | ordering | sequential: each simulated issue time is predicted and scored before the next is issued, so buckets fill as the walk proceeds |
| hindcast | `Prediction.hindcast` | constant `true` |
| any public read | population | derived: the one query helper, which filters `hindcast` false |

**Key invariants**

- `lowerCfs` at or below `centralCfs` at or below `upperCfs`, always.
- A prediction's bounds, and the `q10Used`, `q90Used` and `bucketSize` beside them, are immutable after issue. The scoring job writes `Score` rows and never touches `Prediction`.
- The bucket is scoped by gauge as well as by model, horizon and regime. The parent spec's own reconstruction invariant makes this point: omitting the gauge is correct with one and silently wrong with two.
- Quantiles use at most one error per prediction, so a re polled revision cannot double weight a single forecast.
- No score built on a non positive `centralCfs` ever enters a bucket.
- The bucket never contains a score learned after the prediction being built. This holds for live predictions trivially and for hindcast predictions only because of the explicit cutoff.
- Hindcast rows are ordinary in every respect except that no public read returns them.
- Every public read goes through the one helper. A hand written `where` clause on predictions is a review failure.

**Critical test scenarios**

- A bucket of 30 or more errors produces bounds equal to `central * q10` and `central * q90`, verifies AC-I2, AC-I4.
- Quantiles of a known 30 element sample match the linear interpolation definition exactly, verifies AC-I3.
- A regime bucket of 29 falls back to pooled and sets `intervalSeeded` false, verifies AC-I5, AC-I7.
- Neither bucket reaching 30 produces exactly `[c / 3, c * 3]`, verifies AC-I5.
- An unclassifiable issue regime issues the prediction with a null `issueRegime` and pooled quantiles, verifies AC-I6.
- A bucket whose `q10` exceeds 1.0 yields `lowerCfs` equal to `centralCfs` and `intervalClamped` true, verifies AC-I8.
- A prediction with two scores contributes one error, the one with the greater `actualRecordedAt`, verifies AC-I10.
- A score whose prediction had `centralCfs` of zero is absent from the bucket, verifies AC-I12.
- Building an interval at simulated time `T` excludes a score with `actualRecordedAt` after `T`, verifies AC-I13.
- The public helper omits hindcast rows while the quantile query includes them, verifies AC-I9, AC-I14.

## Build plan

Ordered as a thin thread first, per the project's Tracer Bullet approach: the pure interval maths is testable before any of it touches the database, and the seeding hindcast comes last because it is the only step that needs the whole chain working.

1. Migration adding `Prediction.issueRegime`, `hindcast`, `intervalClamped`, `q10Used`, `q90Used` and `bucketSize`, flipping the `intervalSeeded` default to false, and making `Score.regime` nullable. Generated against a throwaway. Every added column is nullable or defaulted, so it applies to the existing tables without a backfill step. Satisfies **AC-I1**, **AC-I7**, **AC-I11**.
2. `intervalFromErrors`, a pure function taking a central estimate and a set of ratios and returning bounds, the quantiles used, the bucket size, and the seeded and clamped flags. Covers the fallback ladder, the interpolation definition and the clamp. Satisfies **AC-I2**, **AC-I3**, **AC-I5**, **AC-I7**, **AC-I8**.
3. The bucket query: one score per prediction by greatest `actualRecordedAt`, filtered by model, gauge, horizon and issue regime, excluding non positive central estimates and anything learned after the issue instant. The pooled variant beside it. Satisfies **AC-I4**, **AC-I10**, **AC-I12**, **AC-I13**.
4. The public read helper, filtering `hindcast` false, and the endpoints routed through it. Satisfies **AC-I14**.
5. Wire steps 2 and 3 into the prediction job, including the unclassifiable path. Satisfies **AC-I6**, **AC-I11**.
6. Scoring job writes a nullable `regime`. Satisfies **AC-I1**.
7. The seeding hindcast: walk 6 hourly issue times from 2024-01-01 forward, predicting and scoring each before the next, writing flagged rows. Satisfies **AC-I9**.

## Consequences

**Positive**

- Interval width is measured rather than assumed, and it adapts per model, horizon and regime without anyone tuning a number.
- The day one scorecard is complete. Nothing is missing while the record fills.
- A wide interval is always distinguishable from a confident one, by a flag rather than by inspection.
- Recording both regimes turns the hardest forecasting case, calm now and stormy later, into something the calibration view can show directly.

**Negative and tradeoffs**

- Two jobs each compute a regime, in different reconstructions, and the two live on rows created hours apart. They cannot be compared without a join, and a future reader may still reach for the wrong one.
- The fallback ladder means an interval can be produced three different ways, so reading one requires checking a flag. That is the honest cost of not being absent on day one.
- Multiplicative bounds are wrong in shape for a forecaster whose error is genuinely additive. No baseline here is, but a future model might be, and it would need its own treatment rather than inheriting this one.
- The placeholder band is a judgement, not a measurement. It is deliberately too wide, which means early predictions look uninformative, which is the intended failure direction but still a real cost to the first weeks of the dashboard.
- Hindcast rows roughly double the prediction table for no live benefit. The single read helper is what keeps a forgotten filter from becoming a silent correctness bug in the flattering direction, so the helper is load bearing and bypassing it is a real failure, not a style preference.
- The hindcast walks about 3,580 issue times sequentially, predicting and scoring each before the next, because doing it in bulk would give every seeded row the fixed band and hand the calibration view a near perfect coverage figure for most of the record. Sequential is correct and considerably slower, and the build plan should expect it to take real time.
- Six new columns on `Prediction` for what is conceptually one idea. The provenance fields earn their place only when someone actually questions an interval.

## Follow-up

- [ ] The parent spec's `Prediction` data model sketch lists none of the six fields this child adds. Reconcile the sketch with them.
- [ ] AC-20 in the parent says "a documented wide placeholder interval" without a width. It is now `[c / 3, c * 3]`; consider amending the parent to point here rather than leaving the phrase open.
- [ ] The parent's AC-12 and its `Score` sketch both treat `regime` as always present. This child makes it nullable, because the classifier can legitimately refuse. Reconcile.
- [ ] Decide whether the dashboard should expose hindcast rows behind an explicit toggle, or keep them entirely internal. This child only settles the default.
- [ ] The 30 minimum is inherited from the parent, not derived. All three buckets clear it comfortably today, so nothing is blocked, but the number itself has never been justified.
- [ ] The bucket has no rolling window, so once the hindcast writes several thousand scores per bucket, live scores are permanently outvoted and the interval stops adapting. Harmless for a baseline that never changes, wrong for a retrained model. Settle before slice 6.
- [ ] Slice 6 retrains weekly, and a fresh `ModelVersion` starts with an empty bucket. Either retraining triggers its own hindcast, or the bucket is scoped to model name rather than model version. Settle before slice 6, not during it.
