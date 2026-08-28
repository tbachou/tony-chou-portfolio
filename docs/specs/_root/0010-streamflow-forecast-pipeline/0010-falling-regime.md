# 0010 child: Falling regime

## Summary

The pipeline sorts every forecast by what the river was doing, into three classes: calm, rising, or at a peak. There is no class for a river coming down, so the long drain after a storm is filed either as a peak or as calm, and its errors are averaged in with cases that behave nothing like it. This child adds a fourth class, FALLING, and settles the one question that decides whether the class is useful: a fall counts when the twelve hour change is at least ten percent of the river's current level, not ten percent of its seven day median. Existing rows are relabelled by the same rule so the two do not mix.

## Context

`classifyRegime` reads two numbers about the moment it judges: `m`, the median of the prior seven days, and `d`, the change over the prior twelve hours. It calls the moment RISING when `d` is at least `0.1 * m`, PEAK when it is not rising and the value sits at or above `1.5 * m`, and BASEFLOW otherwise. Two tests pin the falling cases on purpose today: a river back near normal after a storm is BASEFLOW, and a river still high while dropping hard is PEAK.

That is a real gap rather than a naming quibble, because the class picks the error bucket a prediction's interval is drawn from (AC-21, and the ladder in the interval child). Persistence, which forecasts the current reading, behaves differently on a recession than on a plateau: on a plateau it is roughly unbiased, while on a recession it is biased high every single time, because the river keeps dropping after the forecast is made. Filing both under PEAK pools an unbiased sample with a one sided one. The resulting quantiles are too wide for the plateau and centred wrongly for the recession, and neither failure is visible in an overall calibration figure, which is precisely the blind spot AC-16 exists to expose.

The forcing constraint is that a prediction's bounds are written once and never recomputed (AC-I11). Every six hours that this stays unfixed, more rows enter the public record with bounds drawn from the mixed bucket, and those rows can never be corrected.

There is a second force, which is what makes the denominator the whole question. A recession is close to exponential: flow decays by roughly a constant fraction per unit time, so its absolute rate of fall shrinks as the river drops. A threshold measured against the seven day median is a fixed number of cubic feet per second, so a recession from ten times the median clears it for days, right through the flat tail where persistence is easy and accurate again. A threshold measured against the current level tracks the fraction instead, and stops when the decay does.

## Requirements

**User stories**

- As the builder, I want the recession to be its own class, so that a forecast made while the river is draining is bounded by errors from other draining rivers rather than from flat ones.
- As the builder, I want the relabelling of history to be provably the same reconstruction the original jobs used, so that a bucket is not quietly rebuilt from readings that were not knowable at the time.
- As a visitor, I want the page to describe the classes the code actually uses.

**Acceptance criteria**

- **AC-F1**: `Regime` gains a fourth value, `FALLING`. The rule is stated once, in `classifyRegime`, and tested in this order: **RISING** when `d >= 0.1 * m`; **FALLING** when `d <= -0.1 * max(v, m)`; **PEAK** when `v >= 1.5 * m`; **BASEFLOW** otherwise. `v` is the value being classified, `m` the median of the prior seven days, and `d` the change from the reading nearest twelve hours back.
- **AC-F2**: RISING is unchanged. Its denominator stays the median at every level, so a rise of `0.1 * m` counts whether the river is at baseflow or at a storm peak, and no stored RISING row changes class.
- **AC-F3**: the three conditions that return null are unchanged: fewer than 224 readings in the prior seven days, a median at or below zero, or no reading within two hours of the twelve hour mark. A caller still must not default a null to BASEFLOW.
- **AC-F4**: both `Prediction.issueRegime` and `Score.regime` take their values from the same function, so the four classes mean the same thing on both columns. Their instants still differ, and that difference is the interval child's decision, not this one's.
- **AC-F5**: the backfill reproduces each row's own read rather than reading the store as it stands today.
  - `Prediction.issueRegime` is recomputed once per distinct `issuedAt`, not once per row, from the history bound at that instant, classified at `issuedAt`, with `v` the persistence value at issue drawn from that same history. One judgement is then shared by every prediction the slot wrote, which is exactly what the live job does, so the backfill cannot produce two labels for one slot.
  - `Score.regime` is recomputed per row, from the history bound at the instant the scoring job that wrote it actually read, classified at its prediction's `targetTime`, with `v` the score's stored `actualCfs`. That instant is **not** `scoredAt`: the live job binds its history at the run's `startedAt` and takes `scoredAt` from a second clock reading several awaits later, and `Score` records no `startedAt` of its own. For a live score the instant is therefore the `startedAt` of the `SCORE` `PipelineRun` with the greatest `startedAt` at or before that score's `scoredAt`, which is unambiguous because scoring runs hourly and every run writes a row (AC-5). For a hindcast score it is `scoredAt` itself, which already is the simulated slot the history was built at.
  - Where no `SCORE` run matches a live score, the backfill falls back to `scoredAt` and reports how many rows took the fallback. A silent fallback here would be a reconstruction drifting by seconds into a cell AC-F7 permits, which is the one failure neither detector can see.
  - The knowability axis is `validTime` when the prediction is a hindcast row and `recordedAt` otherwise (AC-H1, AC-H2). Reading a hindcast row on the default axis returns an empty history, because the archive was imported in one pass, so the axis is not an optimisation here; it is the difference between a correct label and a null.
- **AC-F6**: the backfill defaults to a report only mode that writes no rows. It prints, per model and horizon, the four bucket counts and the full transition matrix of old class to new class. That report is run and its numbers recorded in this spec before any row is written.
- **AC-F7**: the transition matrix must contain only these movements. RISING stays RISING. PEAK stays PEAK or becomes FALLING. BASEFLOW stays BASEFLOW or becomes FALLING. Null stays null. Any other cell means the backfill is not reading the history the original job read, and it is a defect rather than a surprise.
- **AC-F8**: the set of rows whose regime is null is byte for byte identical before and after the backfill, on both columns. None of the null conditions changed, and the as of reconstruction at a past instant is stable because observations are never updated or deleted (AC-2), so any change in that set is the same defect AC-F7 catches.
- **AC-F9**: the write run reads every row's pre migration label into memory in one pass before it writes anything, and checks AC-F7 and AC-F8 against that snapshot rather than against the database. Comparing against live rows would let an interrupted and resumed run read its own already migrated labels as the old ones, so the subset it had already touched would report no movement and pass both checks without being examined.
- **AC-F10**: no stored interval is recomputed. `lowerCfs`, `upperCfs`, `q10Used`, `q90Used`, `intervalSeeded` and `bucketSize` are left exactly as written, so an old row keeps a truthful record of the interval it was actually issued with even though its regime label has changed. AC-I11 holds without exception.
- **AC-F11**: `STREAMFLOW_FORECASTING` is false for the whole window from the moment the new rule can reach the database until the backfill has run and its counts have been checked. Ingest and rescan keep running, as they are deliberately not gated and do not touch regime.
- **AC-F12**: a bucket that falls under the thirty error minimum after the split needs no new mechanism. The existing ladder falls through to pooled quantiles and sets `intervalSeeded` false (AC-I5, AC-I7), so such a prediction declares itself ungrounded on the page rather than claiming a conditioning it does not have.
- **AC-F13**: tests pin the new ordering and the floor: a high river dropping hard is FALLING and no longer PEAK; a high steady river is still PEAK; a rise through a high value is still RISING; the `max(v, m)` floor is exercised on both sides of the median, so that a proportional fall above the median counts and the same proportional fall well below it does not.
- **AC-F14**: the parent index states the four class rule in **AC-12** and in its Value sourcing regime row, and the case study copy naming baseflow, rising, or at a peak is corrected. No live surface describes a rule the code does not run.

## Options considered

### Option 1: keep three classes

Leave `classifyRegime` alone and accept that a recession is filed as PEAK while elevated and BASEFLOW once it is back near normal.

**Pros**:

- No migration, no enum change, no relabelling of 36,000 rows, and every stored interval keeps matching its stored label with no explanation needed.

**Cons**:

- The PEAK bucket stays a mix of an unbiased sample (the plateau) and a one sided one (the drain), and the pooled quantiles it yields are wrong for both. This is the failure AC-21 exists to prevent, occurring inside a single regime rather than across regimes.

### Option 2: a fall measured against the seven day median

`d <= -0.1 * m`, the exact mirror of the rising test. One denominator, one constant, and the rule reads as a single symmetric sentence.

**Pros**:

- The simplest rule to state and the easiest to reason about, with perfect symmetry between the two directions.
- Keeps the two thresholds in the same units, so a reader never has to hold two yardsticks in mind.

**Cons**:

- The threshold is a fixed number of cubic feet per second while a recession's rate of fall decays with the flow. A recession from ten times the median clears `0.1 * m` for days, so FALLING would swallow almost the whole tail, including the flat easy end where persistence is accurate again. That reproduces the mixing this decision exists to end, one class over.

### Option 3: a fall measured against the current value

`d <= -0.1 * v`. Scale free, with no dependence on the median at all, and equivalent to saying the river has dropped to below about 91 percent of where it was twelve hours ago.

**Pros**:

- Matches the physics directly: an exponential recession has a roughly constant fractional decline, so a fractional test means the same thing at every point on the curve.
- Ends the class when the decay ends rather than when an absolute number is crossed.

**Cons**:

- Below the median the test gets steadily looser in absolute terms. In a dry summer at a fifth of the usual flow, a few cubic feet per second of ordinary drying down clears the bar, so slow predictable drawdown is filed with post storm drops. That is the same mixing again, at the other end of the range.

### Option 4: a fall measured against the current value, floored at the median

`d <= -0.1 * max(v, m)`. Above the median it is Option 3 exactly; below it, the median holds the bar where Option 2 puts it, which at low flow is a decline steep enough that ordinary drawdown never reaches it.

**Pros**:

- Keeps Option 3's fractional behaviour over the whole range that matters, the elevated recession, and takes Option 2's absolute floor only where Option 3 goes soft.
- Says something defensible in one line: FALLING means the river is draining meaningfully and is not already back below its recent normal.

**Cons**:

- Two yardsticks in one expression, so the rule needs a sentence of explanation that Option 2 does not.
- It is deliberately asymmetric with RISING, which keeps the plain median denominator. At a storm peak a small climb counts as RISING while the mirror image fall does not count as FALLING.

## Decision

**Chosen option**: Option 4: a fall measured against the current value, floored at the seven day median.

`FALLING` joins the enum, and `classifyRegime` tests RISING, then FALLING at `d <= -0.1 * max(v, m)`, then PEAK, then BASEFLOW; the whole stored record is relabelled by the same function while forecasting is paused.

**Implementation skills**: `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Rationale

Context gives one force that settles the denominator: a recession decays by a roughly constant fraction, so its absolute rate of fall shrinks as it goes. Only a fractional threshold keeps a stable meaning along that curve, which rules out Option 2. But a bare fraction (Option 3) inherits the opposite failure at low flow, where a fraction of a small number is smaller than ordinary drying down, so a slow predictable summer drawdown lands in the class built for the hard case. Option 4 is not a compromise between the two so much as each one applied where it is right: above the recent normal the fraction governs, below it the median holds the floor. The one line reading, draining meaningfully and not already back to normal, is what the class is for.

The asymmetry with RISING is a deliberate choice and not an oversight. A rise is driven by rain, an absolute quantity of water arriving in the catchment, so an absolute yardstick suits it, and the rising first ordering already exists to make sure a steep climb through a high value is never filed as a plateau. Changing RISING to match would re tag the 518 rising rows and shrink a bucket that is working, to buy symmetry in a rule where the two directions are genuinely different processes. The cost is real and stated: at 5,000 cfs against a 200 median, a 20 cfs climb is RISING while a 400 cfs drop is not FALLING.

Ordering FALLING ahead of PEAK is what makes the class worth having. Testing PEAK first would leave everything above `1.5 * m` in PEAK and give FALLING only the late recession, which is the part most like baseflow and least in need of its own bucket. Putting FALLING first narrows PEAK to what the name should have meant all along, the crest and the plateau, which is the one condition persistence is unbiased on. PEAK keeps its name because renaming an enum value costs a rewrite of every stored row to buy a better word, and a doc comment carries the narrowed meaning the same way it already carries the rising first ordering.

Relabelling history rather than starting the four classes from today is what keeps the buckets meaningful. A prediction's ratio of actual to central is a fact about the forecast and is unaffected by which label the row carries, so relabelling makes every one of the 17,565 existing scores available to the right bucket immediately, and FALLING is conditioned from its first live prediction instead of months later. The cost is stated plainly in AC-F10: an old row will name a regime whose bucket did not produce the bounds stored beside it. That is honest rather than confusing, because `q10Used`, `q90Used` and `bucketSize` were stored precisely so any interval can still be explained after the fact.

## Feature design

**Data model sketch**

No new tables and no new columns. One enum value:

| Entity | Change | Constraints |
|---|---|---|
| `Regime` (enum) | add `FALLING`, giving `BASEFLOW`, `RISING`, `PEAK`, `FALLING` | none; the value is added in its own migration and used only afterwards |
| `Prediction.issueRegime` | values only; still nullable, still written at issue | unchanged |
| `Score.regime` | values only; still nullable, still written at score | unchanged |

Postgres will not let a newly added enum value be used in the same transaction that adds it, and Prisma runs each migration in a transaction. The enum migration therefore lands on its own, ahead of anything that writes the value. The backfill is a script rather than a data migration, which satisfies this by construction.

**State transitions**

None. A regime is a label computed from a moment, not a lifecycle. The classes are unordered: nothing moves between them, and a row's label changes only when the rule that produced it changes, which is what the backfill is.

**API surface**

No change. `/api/observations` is the only endpoint built, and it does not carry a regime parameter. The endpoints the parent lists that would take `regime` are not built yet, and will pick up the fourth value from the enum when they are.

**Value sourcing**

| Action | Value produced / displayed | Source |
|---|---|---|
| classify | `m`, the seven day median | derived: median of every reading with `validTime` in the seven days strictly before the instant, from the supplied history |
| classify | `d`, the twelve hour change | derived: `v` minus the value of the reading nearest twelve hours back, rejected and null when the nearest is more than two hours off the mark |
| classify | the rising threshold | constant `RISING_FRACTION_OF_MEDIAN`, `0.1`, unchanged, applied to `m` |
| classify | the falling threshold | constant `FALLING_FRACTION_OF_LEVEL`, `0.1`, applied to `max(v, m)`. Same number as rising and stated as its own constant, because the two multiply different things and a shared constant would hide that |
| classify | the peak multiple | constant `PEAK_MULTIPLE_OF_MEDIAN`, `1.5`, unchanged |
| classify | the minimum history | constant `MIN_LOOKBACK_READINGS`, `224`, unchanged |
| backfill | a prediction's history | the as of reconstruction bound at that prediction's own `issuedAt`, never at the time the backfill runs. Computed once per distinct `issuedAt` and shared across the slot's rows, mirroring `draftPredictions` |
| backfill | a live score's history | the as of reconstruction bound at the `startedAt` of the `SCORE` `PipelineRun` with the greatest `startedAt` at or before that score's `scoredAt`. Not `scoredAt`, which the live job reads from a later clock call than the one it binds history at |
| backfill | a hindcast score's history | the as of reconstruction bound at the score's own `scoredAt`, which for a hindcast row is the simulated slot the history was built at |
| backfill | the pre migration labels | read once into memory before any write, and used for the AC-F7 and AC-F8 comparisons instead of the live rows |
| backfill | the knowability axis | derived: `validTime` when the prediction's `hindcast` is true, `recordedAt` otherwise (AC-H1, AC-H2) |
| backfill | `v` for a prediction | derived: the persistence value at `issuedAt` from that prediction's own history, the same call `draftPredictions` makes |
| backfill | `v` for a score | the score's stored `actualCfs` |
| backfill | how history is loaded | the gauge's full observation record read once into memory and reused for every row, rather than a query per row. One gauge at a quarter hour resolution since 2024 is a small table, and 36,000 round trips is not |
| backfill | the expected transition matrix | constant, stated in AC-F7, checked rather than reported |
| dashboard | the class names in the case study copy | constant text, corrected to name the four |

**Key invariants**

- Exactly one class applies to any classifiable moment, and the order decides it. The rising and falling conditions cannot both hold, because `d` cannot be at once at or above `0.1 * m` and at or below `-0.1 * max(v, m)` while `m` is positive, which AC-F3 already guarantees.
- The rule exists in exactly one place. Nothing recomputes a regime in SQL, so there is no second statement to drift, which is why the backfill is a script.
- A regime is a pure function of the history, the instant, and the value. That is what makes the backfill deterministic and, together with the store being append only, is what makes a rollback a rerun rather than a restore.
- No stored interval is ever recomputed (AC-I11), regardless of what happens to the label beside it.

**Security model**

Nothing changes. There are no public writes, the read surface gains no parameter, and the backfill is run by hand against the pipeline database with the same credentials the pipeline already uses. No regulated data is involved.

**Configuration required**

None new. `STREAMFLOW_FORECASTING` already exists and already gates the predict step and the whole scoring job.

**Critical test scenarios**

- A river well above its median, dropping by more than a tenth of its current value over twelve hours, is FALLING and not PEAK, verifies **AC-F1**, **AC-F13**.
- The same river, high and steady, is still PEAK, verifies **AC-F1**, **AC-F13**.
- The same river, high and climbing, is still RISING, verifies **AC-F2**, **AC-F13**.
- A fall of exactly a tenth of the current value counts while one cubic foot per second short does not, on both sides of the boundary, verifies **AC-F1**.
- Well below the median, a fall that is a tenth of the current value but not a tenth of the median is BASEFLOW, which is the floor doing its job, verifies **AC-F1**, **AC-F13**.
- Too little history, a non positive median, and a hole at the twelve hour mark each still return null, verifies **AC-F3**.
- The backfill on a fixture with one hindcast prediction and one live prediction reads the hindcast row on the `validTime` axis and the live row on `recordedAt`, and labels both, verifies **AC-F5**.
- The backfill run twice over the same fixture writes the same labels the second time, verifies **AC-F5**.
- A live score whose `scoredAt` falls after its run's `startedAt` is classified from the history at `startedAt`, and a fixture where a revision landed between the two proves the two instants give different answers, verifies **AC-F5**.
- A live score with no `SCORE` run at or before its `scoredAt` falls back to `scoredAt` and is counted in the report rather than passing silently, verifies **AC-F5**.
- A write run interrupted after some rows and rerun still compares against the pre migration labels, so a forbidden transition in the already migrated subset is still caught, verifies **AC-F9**.
- A backfill run in report only mode writes nothing, verifies **AC-F6**.
- A fixture whose transition matrix contains a forbidden cell, such as a RISING row moving, fails rather than reporting, verifies **AC-F7**.
- A row whose regime is null keeps its null through the backfill, verifies **AC-F8**.
- A prediction whose stored bounds came from the old PEAK bucket keeps those bounds, `q10Used`, `q90Used`, `intervalSeeded` and `bucketSize` unchanged after its label moves to FALLING, verifies **AC-F10**.
- A FALLING bucket holding fewer than thirty errors yields pooled bounds with `intervalSeeded` false rather than an error, verifies **AC-F12**.

## Build plan

Tracer Bullet, matching the parent. The thread here runs rule to store to page, and the ordering is bent by one production constraint: the enum value must exist in the database before any code that can write it is deployed, so the migration leads and the rule follows behind the pause.

1. Add `FALLING` to the `Regime` enum in `schema.prisma` and generate the migration. It lands on its own and deploys ahead of everything else. Nothing writes the value yet, so the running pipeline is unaffected. Satisfies **AC-F1**.
2. Turn `STREAMFLOW_FORECASTING` off. Predict and score stop; ingest and rescan continue. Satisfies **AC-F11**.
3. Extend `classifyRegime` with the falling test, the new ordering and `FALLING_FRACTION_OF_LEVEL`, updating the doc comment to state the narrowed meaning of PEAK. Flip the two existing tests that pin a falling river as PEAK or BASEFLOW, and add the boundary and floor cases. Satisfies **AC-F1**, **AC-F2**, **AC-F3**, **AC-F4**, **AC-F13**.
4. Write the backfill as a script under `apps/streamflow/scripts/`, reusing `classifyRegime` and the as of reconstruction, report only by default and writing only behind an explicit flag. It loads the gauge's history once, snapshots every pre migration label before writing anything, groups predictions by distinct `issuedAt`, resolves each live score's binding instant through its `SCORE` `PipelineRun`, picks the axis per row from the prediction's `hindcast` flag, and checks the transition matrix against AC-F7 rather than only printing it. Satisfies **AC-F5**, **AC-F6**, **AC-F7**, **AC-F8**, **AC-F9**.
5. Run it in report only mode. Record the four bucket counts per model and horizon, and the transition matrix, in this spec beside the parent's 2,731 / 518 / 291 line. Satisfies **AC-F6**.
6. Run the backfill for real, only once step 5's numbers are actually written into this file. Confirm the null sets are unchanged, the matrix holds against the snapshot, and no live score took the fallback. Satisfies **AC-F5**, **AC-F7**, **AC-F8**, **AC-F9**, **AC-F10**.
7. Turn `STREAMFLOW_FORECASTING` back on and confirm the next slot issues with a regime conditioned interval at all three horizons, or an honestly unseeded one where a bucket is now thin. Satisfies **AC-F11**, **AC-F12**.
8. Correct the case study sentence at `apps/web/src/app/projects/streamflow/page.tsx` and amend the parent index, both **AC-12** and the regime row in its Value sourcing table, to the four class rule. Satisfies **AC-F14**.

## Migration plan

**Strategy**: feature flagged pause, then expand and backfill. No strangler, because the rule is a pure function with one caller path and no second system to run beside it.

**Phases**:

1. Deploy the enum migration alone. The new value is inert; no code can produce it. Fully reversible by doing nothing.
2. Set `STREAMFLOW_FORECASTING` to false, then land the rule change and the backfill script. Nothing writes a regime while the flag is off.
3. Run the backfill in report only mode. Read the counts and the matrix, and stop here if the matrix contains a cell AC-F7 forbids.
4. Run the backfill for real, then verify the null sets and the matrix.
5. Set `STREAMFLOW_FORECASTING` back to true, and check the next issued slot.

**Rollback**: a regime is a pure function of an append only history at a fixed past instant, and observations are never updated or deleted (AC-2), so the old labels are not lost by being overwritten. Reverting is reverting the code commit and rerunning the backfill under the previous rule, which reproduces the previous labels exactly. Before phase 4 there is nothing to undo at all. The enum value can stay in place either way; an unused value costs nothing and dropping one from a Postgres enum is the awkward operation, not adding it.

That rollback is complete only up to the end of phase 5. Once forecasting is back on, every slot issues predictions whose bounds are drawn from the new buckets, and AC-I11 makes those bounds permanent. A defect found after that point can be stopped and the labels can be reverted, but those predictions keep bounds taken from a bucket the reverted rule no longer recognises. That residue is small and it is honest, since `q10Used` and `bucketSize` still explain each one, but it is not undoable, so phase 3 is the last cheap place to catch a mistake.

**Risks**:

- The backfill reads different history than the original jobs did, most likely by taking the default axis on a hindcast row. AC-F7 and AC-F8 are the detectors: a forbidden transition or any change in the null set means exactly this, and phase 3 catches it before a row is written.
- A bucket lands under thirty errors after the split, most plausibly the narrowed PEAK. This is handled rather than prevented (AC-F12), and phase 3 makes it known in advance rather than discovered on the page.
- Forecasting stays paused longer than intended and a gap appears in the prediction record. The gap is honest and visible in `PipelineRun`, and the phases are hours of work, not days.

## Measured

Report only run against the production store, 2026-08-28, before any row was written (**AC-F6**). Nothing else moved: `RISING` stays `RISING`, null stays null, and no live score took the `scoredAt` fallback.

**`Prediction.issueRegime`**, 18,909 rows. Counts are after the relabelling.

| model, horizon | BASEFLOW | RISING | PEAK | FALLING | null | moved to FALLING |
|---|---|---|---|---|---|---|
| climatology h24 | 1,483 | 355 | 60 | 411 | 110 | 272 baseflow, 139 peak |
| climatology h48 | 1,483 | 359 | 60 | 411 | 110 | 272 baseflow, 139 peak |
| climatology h72 | 1,484 | 362 | 60 | 411 | 110 | 272 baseflow, 139 peak |
| persistence h24 | 2,426 | 522 | 89 | 607 | 236 | 394 baseflow, 213 peak |
| persistence h48 | 2,426 | 522 | 89 | 607 | 236 | 394 baseflow, 213 peak |
| persistence h72 | 2,426 | 522 | 89 | 607 | 236 | 394 baseflow, 213 peak |
| **all** | **11,728** | **2,642** | **447** | **3,054** | **1,038** | 1,998 baseflow, 1,056 peak |

**`Score.regime`**, 17,581 rows.

| model, horizon | BASEFLOW | RISING | PEAK | FALLING | null | moved to FALLING |
|---|---|---|---|---|---|---|
| climatology h24 | 1,465 | 351 | 53 | 404 | 9 | 272 baseflow, 132 peak |
| climatology h48 | 1,465 | 351 | 53 | 404 | 9 | 272 baseflow, 132 peak |
| climatology h72 | 1,463 | 351 | 53 | 404 | 9 | 272 baseflow, 132 peak |
| persistence h24 | 2,352 | 518 | 83 | 596 | 36 | 388 baseflow, 208 peak |
| persistence h48 | 2,348 | 518 | 83 | 596 | 32 | 388 baseflow, 208 peak |
| persistence h72 | 2,343 | 518 | 83 | 596 | 31 | 388 baseflow, 208 peak |
| **all** | **11,440** | **2,607** | **408** | **3,000** | **126** | 1,980 baseflow, 1,020 peak |

**What the numbers say.**

PEAK was mostly a recession. Of the 1,503 predictions filed there, 1,056 were draining, so the class loses about seventy percent of its rows and keeps 447. That is the strongest evidence the split was worth making: the bucket this decision exists to clean up was majority mislabelled, not marginally so.

BASEFLOW gives up 1,998 of 13,726, about fifteen percent, which is the post storm tail that had already dropped below `1.5 * m` while still draining hard.

The risk the migration plan named did not land. AC-F12 anticipated the narrowed PEAK falling under the thirty error minimum; at 60 per model and horizon for climatology and 89 for persistence, it clears the floor by a comfortable margin at every combination, so no bucket falls through to pooled quantiles as a result of this change. PEAK is now the smallest bucket by a wide margin, though, and it is the one to re measure first if the record ever thins.

FALLING arrives well conditioned rather than empty: 411 rows per climatology horizon and 607 per persistence horizon, all far above the minimum. That is what relabelling history bought, and it is why the class is useful from its first live prediction rather than months from now.

## Consequences

**Positive**:

- A recession gets its own error distribution, so a forecast issued into one is bounded by errors from other recessions. The bias that makes persistence wrong on the way down stops being averaged into the plateau's sample.
- PEAK narrows to the crest and the plateau, which makes it a coherent class for the first time rather than a catch all for anything elevated.
- Every existing score is available to the right bucket the moment the backfill finishes, so FALLING is conditioned from its first live prediction instead of months later.
- The relabelling is a rerunnable pure function over an append only store, which makes the rollback a rerun. That property came free from the bitemporal design and is worth noticing.

**Negative / tradeoffs**:

- The rule is no longer symmetric between the two directions, and the asymmetry is stark at high flow. It now needs a paragraph of explanation where it used to need a sentence.
- The falling threshold multiplies `max(v, m)` while the rising one multiplies `m`. Two constants with the same value and different meanings is a thing a future reader can misread, which is why they are separate named constants rather than one shared one.
- After the backfill an old row names a regime whose bucket did not produce its stored bounds. This is recoverable from `q10Used` and `bucketSize`, but it is a real wrinkle in a record whose whole selling point is being explainable.
- The backfill now depends on `PipelineRun` rows surviving for every live scoring run, which is a coupling that did not exist before. It is a fair one, since AC-5 already requires a row per run and the fallback is counted rather than silent, but a pruned run table would quietly reduce the exactness of a rerun.
- The narrowed PEAK bucket is smaller than the 471 to 475 per horizon it holds today, and may drop under the thirty error minimum for some model and horizon. Handled, but it means some predictions that are conditioned today will be pooled tomorrow.
- Forecasting is paused for the migration window, leaving a real gap in the six hourly record.

**Neutral**:

- Adding a Postgres enum value is cheap and additive. Removing one is not, so the choice is effectively one way.
- The four class split makes a regime breakdown on the dashboard more worth building than it was, since there is now a comparison worth showing. That is deliberately out of scope here.
- Because `v` is the lower endpoint of a fall, `d <= -0.1 * v` is satisfied by a decline of about 9.1 percent from where the river was, not 10. The test is very slightly more generous than a decline measured from the earlier value, which is the right direction to err for a class whose job is to catch recessions.

## Follow-up

- [x] Record the measured bucket counts and transition matrix in this spec at build step 5, the way AC-I4 records 2,731 / 518 / 291. Done 2026-08-28, see [Measured](#measured); the `MIN_BUCKET_ERRORS` doc comment in `config.ts` was corrected at the same time, since it still described three regimes.
- [ ] Consider a regime breakdown on the dashboard, splitting skill and calibration by the four classes. It is what AC-15 and AC-16 always implied, and it is the only surface that would show whether this split earned its keep. Deliberately not in this child.
- [ ] Revisit the `0.1` falling fraction once a season of live falling scores exists. It was chosen to match rising rather than from measurement, and the transition matrix from step 5 is the first evidence about whether it splits the record usefully.
- [ ] No build approach is recorded for the project, so Tracer Bullet has now been assumed a sixth time. Still worth setting explicitly, as the parent already notes.
