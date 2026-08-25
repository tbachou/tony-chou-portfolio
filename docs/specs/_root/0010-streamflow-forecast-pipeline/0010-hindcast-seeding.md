# 0010 child: Hindcast seeding over a bulk imported archive

## Summary

The seeding hindcast cannot run. It asks what the pipeline knew at each past moment, and for the whole backfilled record the honest answer is nothing, because every reading was imported in a single pass two days ago. This child says that while the hindcast walks the archive, "knowable at T" means the reading was true by T rather than learned by T, and it moves the interval bucket's time bound from when a truth was learned to when it came true. Both are carried by one explicit parameter, so the live pipeline keeps the stricter rule it has today.

## Context

The store keeps two timestamps on every reading. `validTime` is when the reading was true at the gauge. `recordedAt` is when this pipeline learned it. Every reconstruction of the past filters on `recordedAt`, which is what makes a backtest honest: a forecast simulated at some past instant cannot see a reading the pipeline had not yet received.

That rule assumes the two clocks carry independent information. Measured against the live store, they do not:

| | span |
|---|---|
| `validTime`, when it was true | 2023-12-31 to 2026-08-24, about 2.6 years |
| `recordedAt`, when we learned it | 2026-08-23 to 2026-08-24, about two days |
| `validTime` values with more than one revision | 0 of 86,485 |

The backfill arrived in one pass, so nearly every row shares one `recordedAt`. Asking what was knowable in October 2024 correctly returns nothing, because the pipeline did not exist then. A walk of 3,868 six hourly slots produces predictions on only the last handful.

Three separate reads depend on that axis, and all three collapse the same way over the archive:

| Read | Its time bound | Over the archive |
|---|---|---|
| the hindcast's history | `recordedAt` at or before the slot | empty, so no forecaster can answer |
| the scorable prediction query | `recordedAt` at or before the scoring instant | no truth found, so nothing is ever scored |
| the interval bucket | `actualRecordedAt` at or before `issuedAt` | empty, so every interval falls to the placeholder |

Fixing only the first still yields no scores and no measured intervals. The parent spec's AC-20 requires each baseline's error distribution to be seeded by a hindcast across the backfilled history before the first live prediction, and that requirement cannot currently be met by any amount of running the job.

The cost of leaving it is permanent rather than temporary. A prediction's bounds are written once and never recomputed, so every forecast issued before the buckets fill keeps the wide placeholder band for the life of the record. Buckets need 30 errors; at four predictions per horizon per day that is roughly a week per bucket, and considerably longer for the peak regime, which only occurs during storms.

## Requirements

**User stories**:

- As the builder, I want the day one scorecard to carry measured intervals rather than placeholders, so the first weeks of the public record are worth reading.
- As the builder, I want the rule that makes a backtest honest to keep holding, so seeding does not quietly buy completeness with credibility.
- As a visitor, I want to know when an interval came from a backtest rather than from the pipeline's own live history, so I can weigh it accordingly.

**Acceptance criteria**:

- **AC-H1**: The history read, the scorable prediction query and the interval bucket query each accept an explicit axis, `recordedAt` or `validTime`, defaulting to `recordedAt`. Every existing caller is unchanged and passes nothing.
- **AC-H2**: The hindcast passes `validTime` to all three. No other caller passes it.
- **AC-H3**: On the `validTime` axis, the history at slot `T` holds, for each `validTime` at or before `T`, the row with the greatest `recordedAt`. Rows whose `validTime` is after `T` are excluded.
- **AC-H4**: The interval bucket is bounded by the **contributing** prediction's `targetTime` at or before the **new** prediction's `issuedAt`, on both axes. Both fields exist on both predictions, so naming which is which is the whole content of this criterion: read as one prediction's own two fields it is always true and filters nothing. This replaces the `actualRecordedAt` bound stated in AC-I13.
- **AC-H5**: A test proves that a prediction issued at `T` has no error in its bucket whose `targetTime` is after `T`, on either axis.
- **AC-H6**: A test proves the live paths are unaffected: with no axis passed, the history read, the scorable query and the bucket query produce exactly what they produce today.
- **AC-H7**: The dashboard states, beside the current forecasts table where the unseeded interval footnote already explains interval provenance, that intervals were seeded by a backtest over readings USGS had already reviewed, and may therefore run slightly narrow against live performance. It shows permanently rather than only while seeding, because the buckets stay hindcast dominated for as long as the rolling window stays deferred.
- **AC-H8**: Hindcast rows remain flagged and remain excluded from every public read. AC-I9 and AC-I14 are unchanged by this decision.
- **AC-H9**: On the `validTime` axis the scorable query drops its `recordedAt` bound entirely, keeping only that the target instant has passed. The truth for a target stays the row whose `validTime` equals `targetTime` with the greatest `recordedAt`, the same rule AC-H3 states for history. The dropped bound is what makes the query degenerate over the archive, and once a target instant has passed there is nothing left for that bound to protect: the reading was true before the forecast was even judged.

## Options considered

### Option 1: fall back to `validTime` for the archive (chosen)

While the hindcast walks, treat a reading as knowable once it was true. Live paths keep `recordedAt`.

**Pros**:

- Seeds the full record, so AC-20 is met and day one intervals are measured rather than invented.
- Defensible on evidence rather than on convenience: no `validTime` in the store has more than one revision, so there is no corrected version of any reading that a `validTime` walk could reach for. There is nothing to cheat with because nothing has ever been tidied.
- The live pipeline, where the two clocks genuinely differ and revisions genuinely arrive, is untouched.

**Cons**:

- The rule is honest today because of a property of the current data, not because of a property of the design. If revisions accumulate and the hindcast is re-run, a `validTime` walk would then reach corrected values that were not visible at the time.
- The archive holds readings USGS has already reviewed, while a live forecast sees provisional ones. Seeded intervals are therefore drawn from slightly cleaner inputs than the live system ever gets.

### Option 2: do not hindcast

Let the buckets fill from live scoring.

**Pros**:

- Introduces no new concept and needs no justification later. The strictest possible reading of the leakage rule.

**Cons**:

- AC-20 goes unmet, and not temporarily: every prediction issued during the fill carries the placeholder band permanently.
- The peak regime bucket, the one regime conditioning exists to serve, would take longest of all to fill, because peaks are rare. The dashboard would show its widest, least useful intervals exactly where the forecasting problem is hardest.

### Option 3: state a two era rule in the store itself

Declare that the store has an imported era and a live era, with the import instant as the boundary, and make every reconstruction aware of which era it is reading.

**Pros**:

- The most literally honest description of what the data actually is, and it degrades into the correct live behaviour on its own as the record grows.

**Cons**:

- Every query that reconstructs history gains a branch, including the ones on the live read path that have no need of it and are currently simple enough to verify against a pure oracle.
- It puts a date constant at the centre of the store's semantics, and that date is an accident of when the backfill happened to run rather than anything about the river.

## Decision

**Chosen option**: Option 1, fall back to `validTime` for the archive, carried by one explicit parameter.

The axis is a parameter on three reads, `recordedAt` by default. The hindcast is the only caller that passes `validTime`. The interval bucket's time bound moves from `actualRecordedAt` to `targetTime` on both axes, because that is the same property expressed on an axis the hindcast can actually use. The approved data bias is recorded as a stated limitation rather than corrected.

**Implementation skills**: `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Rationale

**Why `validTime` is defensible here and would not be in general.** The leakage rule exists to stop a backtest using information that did not exist when the forecast was made. Over the archive, there is exactly one version of every reading, so the set of things a `validTime` walk can see and the set of things a `recordedAt` walk would have seen differ only by the fact that the second set is empty. Nothing was revised, so nothing later can be reached. That is a measured property of the current store, 0 revisions in 86,485 rows, not an assumption, which is why the follow up asks for it to be re measured before any future re run.

**Why the bucket bound becomes `targetTime`.** AC-I13 exists so a hindcast interval is not built from forecasts issued after the moment it simulates. On the archive axis, `actualRecordedAt` is always the import instant, so that bound is either always true or always false and carries no meaning. `targetTime` at or before `issuedAt` says the same thing in terms the walk can evaluate: a prediction learns only from forecasts whose outcome had already happened when it was made. It is also correct for live predictions, where a target in the past is a precondition of having been scored at all.

**Why one parameter rather than a second set of queries.** This workspace already treats query duplication as the thing most likely to go wrong: every raw query is paired with a pure TypeScript oracle and a script that proves the two agree, precisely because a second statement of the same rule drifts silently. Two copies of the reconstruction rule, one per axis, would be the same trap with the same failure mode. A parameter keeps one statement of the rule and makes the axis visible at the call site.

**Why the approved data bias is recorded rather than corrected.** Every correction available is worse than the disclosure. Restricting the walk to a recent window buys much less seeding for the honesty gained and needs an invented boundary date, which this spec family already refused once when it declined to pick a placeholder width without measuring. Preferring the earliest revision of each reading changes nothing today, since no reading has been revised, and its benefit is entirely deferred. Saying plainly that seeded intervals came from reviewed data is the response this project is actually for, and slice 5's calibration view will eventually show the size of the gap rather than leaving it as a claim.

**The one honest weakening.** Moving the bucket bound to `targetTime` admits a narrow race on the live path. A prediction issued at 06:00 can see a score whose target passed at 05:55 but whose truth was recorded at 06:05, if the scoring pass ran in between. The window is bounded by the scoring cadence and the hindsight involved is minutes of a reading that was already true before the forecast was made. It is stated here rather than hidden because the alternative, keeping both bounds, reintroduces the empty bucket the whole decision exists to fix.

## Feature design

**Data model changes**

None. No column is added, altered or dropped, and no migration is generated. This is a change to three queries and to what the hindcast passes them.

**Value sourcing**

| Action | Value produced | Source |
|---|---|---|
| any reconstruction | which axis bounds the read | parameter, `recordedAt` by default; only the hindcast passes `validTime` |
| hindcast history at slot `T` | the readings a forecaster could use | derived: per `validTime` at or before `T`, the row with the greatest `recordedAt` |
| live history at instant `T` | the readings a forecaster could use | unchanged: per `validTime`, the row with the greatest `recordedAt` at or before `T` |
| hindcast scoring | the truth at `targetTime` | derived: the row whose `validTime` equals `targetTime`, greatest `recordedAt` |
| live scoring | the truth at `targetTime` | unchanged: greatest `recordedAt` at or before the scoring instant |
| any interval | which past errors may enter the bucket | derived: scores whose prediction's `targetTime` is at or before this prediction's `issuedAt` |
| dashboard | the seeding disclosure | constant text, required by AC-H7 |

**Key invariants**

- A prediction never learns from a forecast whose outcome had not yet occurred when it was issued. This is AC-I13's property, restated on an axis that survives a bulk import.
- The default axis is `recordedAt`. A caller that passes nothing gets exactly today's behaviour, so the live pipeline cannot acquire the looser rule by accident.
- Only the hindcast passes `validTime`. A second caller appearing on that axis is a review failure, not a style preference.
- Hindcast rows stay flagged and stay out of every public read.
- On a hindcast row, `Score.actualRecordedAt` holds the import instant, so a score simulating January 2024 records a revision timestamp from August 2026. It is still true, it is still the revision the score used, but it is **not** a knowability signal on those rows and must never be used as one. That is exactly why the bucket bound moved off it. For hindcast rows the knowability axis is `targetTime`.
- The archive's zero revision property is what makes this sound. It is recorded here so a future reader can check whether it still holds.

**Critical test scenarios**

- With no axis passed, the three reads return exactly what they return today, verifies AC-H1, AC-H6.
- On the `validTime` axis, a reading whose `validTime` is after the slot is excluded while one before it is included, verifies AC-H3.
- On the `validTime` axis, where a `validTime` has two revisions, the greater `recordedAt` wins, verifies AC-H3.
- A bucket built for a prediction issued at `T` excludes an error whose contributing prediction's `targetTime` is after `T`, on both axes, verifies AC-H4, AC-H5.
- On the `validTime` axis, a prediction whose target has passed is scorable even though every reading was recorded long after that target, verifies AC-H9.
- On the `validTime` axis, where a target instant has two revisions, the score uses the greater `recordedAt`, verifies AC-H9.
- A hindcast walk over a fixture whose readings were all recorded in one instant produces predictions and scores at every slot, which is the failure this decision exists to fix.
- The public read helper still returns no hindcast rows after seeding, verifies AC-H8.

## Build plan

Tracer Bullet, matching the parent. The thin thread here is one slot walking end to end on the new axis; the rest thickens it.

1. Add the axis parameter to the history read, defaulting to `recordedAt`, with tests that the default is byte for byte today's behaviour. Satisfies **AC-H1**, **AC-H3**, **AC-H6**.
2. Add the axis parameter to the scorable prediction query, same default and same proof, dropping the `recordedAt` bound on the `validTime` axis only. Satisfies **AC-H1**, **AC-H6**, **AC-H9**.
3. Move the interval bucket's bound to `targetTime` on both axes, and amend the bucket's pure oracle to match so the two still agree. Satisfies **AC-H4**, **AC-H5**.
4. Point the hindcast at the `validTime` axis for all three reads. Satisfies **AC-H2**.
5. Extend `scripts/verify-bucket.ts` so it proves the query and its oracle agree on the new bound, against a real database. Satisfies **AC-H4**.
6. Run the hindcast against a throwaway seeded to mimic the live store's shape, every reading sharing one `recordedAt`. Confirm predictions and scores land at every slot, and that the public read helper still returns none of them. Satisfies **AC-H8**.
7. Add the seeding disclosure to the dashboard. Satisfies **AC-H7**.

## Migration plan

**Strategy**: no schema migration; a one time data seeding run.

**Phases**:

1. Ship the code change. It is inert until something passes the `validTime` axis, so merging it changes no behaviour.
2. Run the hindcast once against the live store, by hand, before the scheduled pipeline issues its first live prediction.
3. Let the crons proceed. From the first scheduled run onward, intervals are drawn from the seeded buckets.

**Rollback**: the code reverts as one commit. The seeded rows do not, and they are the part worth thinking about before running. `hindcast = true` is a clean predicate for removing them, but there is no cascade on the score to prediction foreign key, so the undo is two ordered deletes, scores belonging to hindcast predictions first, then the predictions themselves.

**Risks**:

- Running the hindcast after the crons have started leaves a permanent band of placeholder bounded predictions at the very start of the public record. Sequence matters more than speed here.
- The walk is thousands of sequential round trips against a hosted database. It is idempotent and safe to interrupt, but it should be watched rather than left.
- If the walk is interrupted partway, the buckets are seeded up to that point only, and predictions issued in the meantime bind whatever the partial buckets held.

## Consequences

**Positive**

- The day one scorecard carries measured intervals, and the parent's AC-20 becomes satisfiable.
- The peak regime, the one the conditioning exists for, is seeded rather than waiting months for enough storms.
- The live pipeline keeps the strict rule, and the default makes that the outcome of doing nothing rather than of remembering.
- The bucket's time bound is now expressed in terms that survive a bulk import, so the same failure cannot recur the next time history is loaded in one pass.

**Negative and tradeoffs**

- There are now two meanings of "what was knowable", and a reader has to know which one a given call is on. The default and the single opted in caller are what keep that manageable, but it is a real increase in what the codebase asks you to hold.
- The soundness rests on a property of today's data rather than of the design. If revisions accumulate, a re run of the hindcast would silently become less honest than the first run was, and nothing in the code would notice.
- Seeded intervals are drawn from reviewed readings and are probably slightly narrow against live performance. The disclosure states it; it does not fix it.
- The live bucket bound is very slightly looser than before, by minutes, in a narrow race with the scoring pass.
- Seeding makes the buckets hindcast dominated from day one, so live scores are outvoted immediately rather than eventually. Harmless while only baselines run, and the existing follow up on a rolling window now matters sooner.

## Follow-up

- [ ] AC-I13 in [0010-prediction-intervals.md](0010-prediction-intervals.md) states the bucket bound as `actualRecordedAt` at or before `issuedAt`. AC-H4 replaces it. Reconcile the wording so one of them is not left contradicting the code.
- [ ] The parent's AC-20 says the seeding hindcast runs "across the backfilled history" without saying what the reconstruction means over an archive imported in one pass. Consider pointing it here.
- [ ] Re measure the zero revision property before any future re run of the hindcast. If revisions have accumulated, the `validTime` walk is no longer equivalent and this decision needs revisiting.
- [ ] The bucket still has no rolling window, and seeding makes that bite from day one rather than eventually. Deliberately left to slice 6, per the intervals child, because a bucket that never adapts is only wrong for a forecaster that changes, and slice 2 has none.
- [ ] Nothing tells the hindcast it is being re run against a store that has moved on. Consider whether a second run should refuse, or warn, when the axis it needs is no longer equivalent.
