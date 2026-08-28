# 0010 child: The falling denominator

## Summary

The falling test asks whether the twelve hour change is at least ten percent of `max(v, m)`, the larger of the river's current level and its seven day median. The median half of that was a floor, added to keep ordinary summer drying out of the class. Measured against the whole record it does the opposite: it holds 742 scores in BASEFLOW that behave like recessions, with eighty percent of forecasts too high, pooled with 6,246 that are essentially unbiased. This child drops that floor. A fall counts when it is at least ten percent of the current value, guarded only by the gauge's frozen flow floor so the threshold cannot vanish at extreme low flow, and the stored record is relabelled a second time.

## Context

The falling regime child shipped on 2026-08-28. It added FALLING, ordered it ahead of PEAK, and relabelled 3,054 predictions and 3,000 scores. The relabelling worked: seventy percent of what had been filed as PEAK turned out to be a river draining, and PEAK became the crest and the plateau it was always meant to name.

The denominator was the one question that child said it existed to settle, and it settled it wrongly. Its Option 3 measured the fall against the current value alone and was rejected on the reasoning that below the median a fraction of a small number is smaller than ordinary summer drawdown, so a slow predictable decline would be filed with post storm drops. Option 4 kept that fraction above the median and put the median underneath as a floor. The floor was argued from a hypothetical, and nothing measured whether the slots it excludes are actually calm.

Two independent pieces of evidence say they are not. A finding recorded on 2026-08-27 against the real USGS record, [2026-08-27-falling-threshold-misses-tail.md](findings/2026-08-27-falling-threshold-misses-tail.md), classified every six hourly slot of a week long recession and showed the rule catches the steep early limb and then hands the rest back to BASEFLOW, which is exactly where the eight observed misses happened. All four of the miss slots stay BASEFLOW. They were shedding fifteen to twenty percent of the river every twelve hours while the seven day median still carried a 7,470 crest, so measured against that median they looked flat.

The same thing happened live on the first slot issued after the migration. The river was down from a 5,330 crest to 303, still falling 42 cubic feet per second over twelve hours, and it classified BASEFLOW because the threshold sat at 73 rather than at 30.

The forcing constraint is unchanged and it is the reason not to sit on this. A prediction's bounds are written once and never recomputed (AC-I11). Every six hours that this stands, more rows enter the public record drawn from a FALLING bucket that is missing its tail and a BASEFLOW bucket that is carrying it.

## Requirements

**User stories**

- As the builder, I want the falling class to cover the whole recession rather than its first thirty hours, so that a forecast issued into the tail is bounded by errors from other tails.
- As the builder, I want the relabelling to be repeatable, because this is the second time the same column has been rewritten and the evidence suggests it may not be the last.
- As the builder, I want the reason this changed to be legible next to the decision it reverses, so the next reader does not have to reconstruct why the floor came and went.

**Acceptance criteria**

- **AC-D1**: the falling test becomes `d <= -0.1 * max(v, flowFloorCfs)`, where `v` is the value being classified and `flowFloorCfs` is the gauge's frozen flow floor. The seven day median plays no part in it. The constant is renamed from `FALLING_FRACTION_OF_LEVEL` to `FALLING_FRACTION_OF_VALUE`.
- **AC-D1a**: `flowFloorCfs` is a guard, not a regime input. It is frozen once at the 5th percentile of the gauge's whole record and cannot be moved by an event, unlike the rolling seven day median it replaces, which a flood inflates to forty times its value. It changes 3 slots in 3,644 and exists to stop the threshold approaching zero as `v` does, not to shape the class. `classifyRegime` therefore takes it as an argument, and a caller that cannot supply one is a build error rather than a silent default.
- **AC-D2**: nothing else in the ladder moves. The order stays RISING, FALLING, PEAK, BASEFLOW; the rising test stays `d >= 0.1 * m`; the peak test stays `v >= 1.5 * m`; the three null conditions stay as they are.
- **AC-D3**: **no stored PEAK row may change class.** PEAK requires `v >= 1.5 * m`, so every PEAK row has `v > m`, where `max(v, m)` already resolved to `v`. The two rules are identical on that whole region. This is provable rather than hoped for, and the transition check enforces it. The proof holds for a fixed `(v, m, d)`; on the `validTime` axis those inputs can move if a revision lands between two runs, which is what **AC-D8a** exists to prevent.
- **AC-D4**: the allowed transition matrix for this migration is BASEFLOW stays BASEFLOW or becomes FALLING; **FALLING stays FALLING, or becomes BASEFLOW, or becomes PEAK**; PEAK stays PEAK; RISING stays RISING; null stays null. Any other cell is a defect. FALLING is now a legal source, which it was not in the first migration.
- **AC-D4a**: the change is **not** uniformly looser, and an earlier draft of this spec wrongly said it was. Where the seven day median is at or above the floor the new threshold is looser or equal; where the median falls below the floor **and** the value is also below it, `max(v, f)` exceeds `max(v, m)` and the threshold is *stricter*, so a row can stop falling. (Where the value is above the floor both resolve to `v` and nothing moves.) That is why FALLING is not frozen.
- **AC-D4c**: a row that stops falling lands wherever the rest of the ladder puts it, which is usually BASEFLOW but is PEAK when `v >= 1.5 * m`. That combination needs `f > v >= 1.5 * m`, a river below the flow floor while still half again its own depressed median. It does not occur on the record measured today, and it is legal rather than forbidden, because refusing it would block a future run over a correct relabelling. Measured on the production record: 167 of 3,645 slots have a seven day median below the floor (the lowest median seen is 11.9 against a floor of 18.9), and exactly **one** row moves FALLING to BASEFLOW against 264 that move BASEFLOW to FALLING. A run reporting more than a handful in that direction is not this effect and should be treated as a defect.
- **AC-D4b**: PEAK, by contrast, is genuinely frozen and the proof is unconditional. PEAK requires `v >= 1.5 * m`, which forces `v > m`, so the old `max(v, m)` was already `v`, and the new `max(v, f)` is at least `v`, making the new threshold stricter or equal. A row that was not falling cannot start falling, so no PEAK row can move whatever the floor is.
- **AC-D5**: the backfill stops assuming it runs once, by these specific means:
  - `RegimeSnapshot` gains a `rule` field naming the rule the snapshot was taken under, as a short stable tag (`max-v-m` for the shipped rule, `max-v-floor` for this one).
  - On load, a snapshot whose `rule` does not match the rule about to run is **refused**, with a message naming both. This closes the hole that makes the existing guard unable to fire: `alreadyMigrated` is gated on `!snapshotReused`, so a stale snapshot that loads successfully skips the check entirely.
  - The snapshot path becomes a required argument with no default. The current hardcoded default already holds the first migration's file, so a default is a loaded gun.
  - The first migration's snapshot is moved to `.regime-backfill/archive/<rule>-<takenAt>.json` before this runs, and never read again.
  - The allowed transition matrix is passed in as an option on `BackfillOptions`, shaped as a map from old class to the set of classes it may become, replacing the module level `ALLOWED_TRANSITIONS` constant.
- **AC-D5a**: the already migrated guard must not claim a protection it cannot give. Deriving it from the transition matrix works for the first migration, where FALLING was not a legal source, and is **inert for this one**, where every class is legal: after the first relabelling the stored labels genuinely cannot tell a finished store from an unfinished one, so no label test can. The guard is therefore replaced rather than patched. A successful write stamps `completedAt` on its snapshot, and a run that loads a snapshot already carrying `completedAt` for the same rule refuses. That is an explicit record of what happened rather than an inference from row counts.
- **AC-D5b**: what no local check can detect is a store that was migrated and then had its snapshot deleted. The report says so in as many words rather than printing a clean check, because a guard that cannot fire while looking like it did is the failure this whole child descends from. Inferring it from a zero movement count was considered and rejected: an empty store, a newly onboarded gauge and a reset development database all move zero rows legitimately, and refusing them would be a false alarm carrying an accusing message.
- **AC-D6**: no stored interval is recomputed. `lowerCfs`, `upperCfs`, `q10Used`, `q90Used`, `intervalSeeded` and `bucketSize` are left exactly as written. AC-I11 and AC-F10 both continue to hold without exception.
- **AC-D7**: report only by default, as before. The run is done in report only mode first and its counts and full transition matrix are recorded in this spec before any row is written.
- **AC-D8**: `STREAMFLOW_FORECASTING` is false from the moment the new rule can reach the database until the backfill has run and its counts have been checked.
- **AC-D8a**: the drift check is mechanical, not visual. Ingest and rescan stay ungated and a revision landing on an old `validTime` is visible to a hindcast row's reconstruction, so the write run queries `PipelineRun` for any `USGS_INGEST` or `USGS_RESCAN` whose `startedAt` is later than the snapshot's `takenAt`, and **refuses to write** if it finds one. Comparing two printed transition matrices by eye is kept only as a secondary human check, because a large multi group table read under time pressure is not a control.
- **AC-D9**: the set of rows whose regime is null is identical before and after, on both columns, for the same reasons as AC-F8.
- **AC-D10**: every surface that states the rule is corrected: the parent index's **AC-12** and its Value sourcing regime row, and the `MIN_BUCKET_ERRORS` doc comment in `config.ts`, whose measured bucket sizes this change moves. The case study copy names the four classes without stating the threshold, so it needs no edit.
- **AC-D12**: the measurements this decision rests on are reproducible before the rule changes. The bucket share sweep, the bias measurement and the low flow guard measurement are written up with their method in a findings document, and the script that produced them is committed rather than discarded. A decision that invokes measurement and cannot be re measured is the failure this child was created to correct.
- **AC-D11**: every bucket still clears the thirty error minimum after the change, per model and horizon, or the ladder's existing fall through to pooled quantiles handles it and the prediction declares itself unseeded (AC-I5, AC-I7).

## Options considered

### Option 1: keep the floor

Leave `max(v, m)` in place and accept that FALLING covers the steep limb only.

**Pros**:

- No second relabel, no second pause, and the labels written today stay written.
- FALLING is still a real population split that did not exist a day ago, and PEAK is still clean.

**Cons**:

- Leaves 742 one sided scores pooled with 6,246 unbiased ones inside BASEFLOW. That is the same contamination the falling regime child exists to remove, relocated rather than fixed, and it is now measured rather than suspected.

### Option 2: drop the median floor, measure against the current value

`d <= -0.1 * max(v, flowFloorCfs)`, essentially the option the falling regime child rejected, with the rolling median replaced by the gauge's frozen flow floor as a guard against a vanishing threshold.

**Pros**:

- Catches all four of the observed miss slots and, over the whole record, moves 265 slots out of BASEFLOW whose scores measure 0.816 with eighty percent of forecasts too high. Those are recessions by their error signature, not by argument.
- Removes the term that was doing the damage. What is left is one yardstick plus a constant that cannot move, rather than two quantities whose larger one wins.
- Leaves PEAK provably untouched, so the part of the last change that worked is not disturbed.

**Cons**:

- Reverses a decision that is one day old, on one gauge and roughly two and a half years of record. The floor's original worry, a dry summer drawdown filed as a recession, is not disproven in general; it is disproven here.
- Costs a second relabel and a second pause.

### Option 3: keep the current value axis but raise the magnitude

`d <= -0.15 * v` or `-0.2 * v`, catching less of the tail while still dropping the median.

**Pros**:

- More conservative about sweeping in mild declines, and it grows PEAK back somewhat, from 89 slots to 128 at 0.15.

**Cons**:

- The marginal group that 0.1 adds already measures 0.816. Stopping at 0.15 would put a demonstrably biased population back into BASEFLOW to guard against a population nothing has yet observed.

### Option 4: replace the floor with a baseline the flood does not inflate

Keep a floor, but compute it from something longer than seven days, a thirty day or seasonal median, so a crest cannot drag it upward for a week.

**Pros**:

- Keeps a guard against low flow noise while fixing the specific mechanism that broke, which is a median short enough to be dominated by the event it is supposed to give context to.

**Cons**:

- Adds a new input, a new window length to justify, and a second thing that can be wrong, to solve a problem the measurement says does not exist. The slots the floor excludes are not noise.

## Decision

**Chosen option**: Option 2: drop the median floor and measure the twelve hour change against the current value, guarded by the frozen flow floor.

`classifyRegime` tests RISING, then FALLING at `d <= -0.1 * max(v, flowFloorCfs)`, then PEAK, then BASEFLOW. The whole stored record is relabelled a second time under the same script, which becomes repeatable in the process.

**Implementation skills**: `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Rationale

The floor was a prediction and the record disagrees with it. Its whole purpose was to keep a class built for hard cases from filling with easy ones, so the test that matters is whether the slots it excludes are easy. They are not. Persistence on them measures 0.816 with eighty percent of forecasts too high, which sits beside the 0.727 of the rows already called FALLING and nowhere near the 0.970 of genuine baseflow. A rule that pools those two populations is the failure AC-21 exists to prevent, and it does not become acceptable by happening inside BASEFLOW instead of inside PEAK.

The mechanism is worth stating plainly because it is the part that generalises. A seven day median is not a baseline during the week after a flood; it is mostly made of the flood. So a threshold anchored to it grows just when the river shrinks, and the rule goes quiet exactly where the recession gets long and persistence gets most biased. Measuring against the current value keeps the threshold in proportion to what is actually there, which is what a decaying process needs.

Dropping the floor rather than raising the magnitude follows from the same measurement. The question is not how much of the record FALLING should cover, it is whether the rows at the margin belong in it, and at 0.1 they do. Over the full record this is a smaller change than the one week sweep implied: FALLING goes from seventeen to twenty four percent of classifiable slots, not to eighty. The single week that first exposed the problem was a recession week, so nearly every slot in it was falling; the rate over two and a half years is the number that matters for whether the class stays meaningful, and it is modest.

The one honest discomfort is reversing a decision a day old. It is worth doing anyway, because the cost of waiting is measured in permanently bounded predictions rather than in effort, and because the evidence that arrived is of a different kind from the reasoning it overturns. The original argument was a hypothetical about dry summers. What replaced it is the error distribution of 742 real scores. Making the backfill repeatable is the concession to the possibility that this is not the last word.

## Feature design

**Data model sketch**

No change. No new tables, no new columns, no new enum values. `FALLING` already exists in the `Regime` type in production, applied by migration `20260828005236_add_falling_regime`. This child ships no migration at all; it is a code change plus a data relabelling run by hand.

**State transitions**

None. A regime is a label computed from a moment. What changes is which label the same moment produces.

**API surface**

No change. `/api/observations` carries no regime parameter, and the endpoints the parent lists that would take one are not built.

**Value sourcing**

| Action | Value produced / displayed | Source |
|---|---|---|
| classify | `m`, the seven day median | derived, unchanged: median of every reading with `validTime` in the seven days strictly before the instant. Still used by the rising and peak tests, no longer by the falling one |
| classify | `d`, the twelve hour change | derived, unchanged: `v` minus the reading nearest twelve hours back, null when the nearest is more than two hours off |
| classify | the falling threshold | constant `FALLING_FRACTION_OF_VALUE`, `0.1`, applied to `max(v, flowFloorCfs)`. Renamed from `FALLING_FRACTION_OF_LEVEL` |
| classify | `flowFloorCfs` | the frozen `Gauge.flowFloorCfs` column, derived once as the 5th percentile of the gauge's whole record and already used by `pctError` for the same reason. Passed into `classifyRegime` by the caller, which already loads the gauge; never recomputed here, never defaulted |
| backfill | the snapshot's `rule` tag | constant naming the rule the run implements, written into the snapshot on save and compared on load |
| backfill | whether a rescan intervened | derived: any `PipelineRun` with job `USGS_INGEST` or `USGS_RESCAN` and `startedAt` after the snapshot's `takenAt` |
| classify | the rising threshold | constant `RISING_FRACTION_OF_MEDIAN`, `0.1`, applied to `m`, unchanged |
| classify | the peak multiple | constant `PEAK_MULTIPLE_OF_MEDIAN`, `1.5`, unchanged |
| backfill | every reconstruction input | unchanged from the falling regime child: history bound at a prediction's own `issuedAt`, at a live score's `SCORE` run `startedAt`, at a hindcast score's `scoredAt`, on the axis the row's `hindcast` flag picks |
| backfill | the pre migration labels | a snapshot taken fresh at the start of this run and written to a per run path. **Not** the file the first migration left behind, which records labels from before FALLING existed |
| backfill | the allowed transition matrix | supplied per run rather than hardcoded. For this run: `BASEFLOW -> {BASEFLOW, FALLING}`, `FALLING -> {FALLING, BASEFLOW, PEAK}`, `PEAK -> {PEAK}`, `RISING -> {RISING}`, `null -> {null}` (**AC-D4**, **AC-D4c**) |
| backfill | whether drift occurred | derived mechanically per **AC-D8a**, not by comparing printed tables |
| config | the recorded bucket sizes | measured at the report run and written into the `MIN_BUCKET_ERRORS` doc comment, replacing the numbers measured on 2026-08-28 |

**Key invariants**

- The rule exists in exactly one place. Nothing recomputes a regime in SQL.
- A regime is a pure function of the history, the instant, and the value, which is what makes a second relabelling safe and a rollback a rerun rather than a restore.
- PEAK is untouched by this change, by construction rather than by care: `v >= 1.5 * m` implies `v > m` implies `max(v, m) = v`.
- Rising and falling still cannot both hold. `m > 0` is guaranteed by the null check and `flowFloorCfs` is validated positive where it is derived, so `max(v, flowFloorCfs)` is strictly positive whatever `v` is, and `d` cannot be at once at or above a positive number and at or below a negative one. The floor is what makes this hold unconditionally; against plain `v` it would need `v > -m`, which nothing checks.
- No stored interval is ever recomputed, whatever happens to the label beside it.

**Security model**

Nothing changes. No public writes, no new read parameters, no regulated data. The backfill runs by hand with the credentials the pipeline already holds.

**Configuration required**

None new.

**Critical test scenarios**

- A river well below its seven day median, falling by a tenth of its current value, is FALLING where it used to be BASEFLOW, verifies **AC-D1**.
- The live case from 2026-08-28: `v` 303, twelve hour change minus 42, median 730, is FALLING, verifies **AC-D1**.
- The four slots named in the 2026-08-27 finding all classify FALLING, verifies **AC-D1**.
- A river at a fifth of normal flow drifting down by two percent over twelve hours is still BASEFLOW, verifies **AC-D1**.
- At a value below `flowFloorCfs`, the threshold is computed from the floor rather than the value, so a decline that is a tenth of a very small number does not qualify, verifies **AC-D1a**.
- A caller that supplies no flow floor fails rather than defaulting, verifies **AC-D1a**.
- A high steady river is still PEAK, and a rise through a high value is still RISING, verifies **AC-D2**.
- Every value at or above `1.5 * m` produces the same class under both the old and the new rule, exercised as a property over generated values, verifies **AC-D3**.
- Too little history, a non positive median, and a hole at the twelve hour mark each still return null, verifies **AC-D2**.
- A backfill run leaves a FALLING row alone where the median is above the floor, and moves it to BASEFLOW where the median is below it, verifies **AC-D4**, **AC-D4a**.
- A run in which any PEAK or RISING row would move fails rather than writing, verifies **AC-D4**, **AC-D4b**.
- A write run that loads a snapshot already stamped `completedAt` for the same rule refuses, verifies **AC-D5a**.
- A successful write stamps `completedAt`, and a failed or refused one does not, verifies **AC-D5a**.
- An empty store, or any run that finds nothing to move, completes normally rather than being refused, verifies **AC-D5b**.
- A stored FALLING row where the median sits above the floor is left alone; one where the median and the value are both below it moves to BASEFLOW, verifies **AC-D4a**.
- A backfill loading a snapshot tagged with a different rule refuses, naming both rules, verifies **AC-D5**.
- A write run refuses when a `USGS_RESCAN` row exists with `startedAt` after the snapshot's `takenAt`, and proceeds when none does, verifies **AC-D8a**.
- Two successive relabellings under different rules over the same fixture each compare against their own run's snapshot, verifies **AC-D5**.
- A row whose label moves keeps its bounds and its interval provenance columns unchanged, verifies **AC-D6**.
- A report only run writes nothing, verifies **AC-D7**.
- A row whose regime is null keeps its null, verifies **AC-D9**.

## Build plan

Tracer Bullet, matching the parent. No migration leads this time, since the enum value already exists, so the thread runs rule to store to page in its natural order.

1. Write up the bucket share, bias and low flow measurements as a findings document with their method, and commit the sweep script beside the existing verify scripts so the numbers can be re measured. Satisfies **AC-D12**.
2. Change `classifyRegime` to test `d <= -0.1 * max(v, flowFloorCfs)`, take the floor as a required argument, rename the constant, and update the doc comment to state the rule, why the median is absent, and why the remaining floor is a different kind of thing. Satisfies **AC-D1**, **AC-D1a**, **AC-D2**.
3. Update and extend the tests: flip the floor cases, add the live 2026-08-28 case, the four slots from the finding, the sub floor case, the missing floor failure, and the property that nothing at or above `1.5 * m` changes class. Satisfies **AC-D1**, **AC-D1a**, **AC-D2**, **AC-D3**.
4. Make the backfill repeatable: add the `rule` tag to the snapshot and refuse a mismatch on load, make the snapshot path a required argument, move the allowed transition matrix onto `BackfillOptions` with FALLING able to reach BASEFLOW or PEAK and PEAK frozen, and replace the already migrated guard with a `completedAt` stamp written on a successful write and refused on reload. Satisfies **AC-D4**, **AC-D4b**, **AC-D4c**, **AC-D5**, **AC-D5a**, **AC-D5b**.
5. Add the mechanical drift check: refuse to write when an ingest or rescan run started after the snapshot instant. Satisfies **AC-D8a**.
6. Archive the first migration's snapshot to `.regime-backfill/archive/`, then turn `STREAMFLOW_FORECASTING` off. Satisfies **AC-D5**, **AC-D8**.
7. Run the backfill in report only mode and record its counts and full transition matrix in this spec. Satisfies **AC-D7**, **AC-D11**.
8. Run it for real in the same sitting and confirm the null sets, that PEAK and RISING did not move, and that the FALLING to BASEFLOW cell holds the single row **AC-D4a** predicts. Satisfies **AC-D4**, **AC-D4a**, **AC-D6**, **AC-D8a**, **AC-D9**.
9. Turn the flag back on and confirm the next slot issues at all three horizons. Satisfies **AC-D8**, **AC-D11**.
10. Correct the parent index's **AC-12** and its Value sourcing regime row, and the `MIN_BUCKET_ERRORS` doc comment with the numbers from step 7. Satisfies **AC-D10**.

## Migration plan

**Strategy**: feature flagged pause, then relabel. No schema change and no strangler: the rule is a pure function with one caller path.

**Phases**:

1. Land the rule change and the repeatable backfill behind the flag being off.
2. Archive the first migration's snapshot so it cannot be picked up by accident. The tag check in AC-D5 is the backstop if this is forgotten.
3. Report only run. Read the counts and the matrix. Stop here if any PEAK, FALLING or RISING row would move, or if the null set changes.
4. Write run, in the same sitting as step 3 and inside one six hour gap between pipeline runs. Compare the printed matrices.
5. Flag back on, check the next issued slot.

**Rollback**: a regime is a pure function over an append only store, so reverting is reverting the code and rerunning the backfill under the previous rule. That reproduces the previous labels exactly, as it did for the first migration. Complete only up to the end of phase 5: once forecasting is back on, predictions issue with bounds drawn from the new buckets and AC-I11 makes those permanent.

**Risks**:

- A rescan lands between the report run and the write run and shifts a hindcast row's reconstruction. The `PipelineRun` check in **AC-D8a** is the detector and it refuses the write; keeping both runs inside one six hour gap is the mitigation that stops it triggering.
- The first migration's snapshot is reused by accident, which would compare this run against labels from before FALLING existed and report the previous migration's movements. Phase 2 and the refusal in **AC-D5** both guard it.
- The threshold moves again once a second recession is on the record, making this the second of three relabellings. Handled rather than prevented: **AC-D5** is exactly this concession.

## Consequences

**Positive**:

- The recession bucket covers the recession. The 742 scores measured at 0.816 move out of a bucket whose median is 0.970, which sharpens both.
- The rule loses a term. One yardstick, one line, and no explanation needed for why a threshold has two denominators.
- PEAK is provably undisturbed, so the part of the previous change that demonstrably worked is carried forward untouched.
- The backfill becomes a tool rather than a one off script, which is what the evidence suggests this column will need.

**Negative / tradeoffs**:

- A decision is reversed one day after it shipped, and the record now carries two children that both decide the same term. That is honest but it is not tidy.
- A second pause and a second relabel, with the six hourly record showing another short gap.
- Rows relabelled twice will have been issued with bounds from a bucket that no longer matches their label, in some cases twice over. Still recoverable from `q10Used`, `q90Used` and `bucketSize`, but the wrinkle is now deeper than it was.
- The floor's original worry is unresolved rather than answered. Nothing here proves a dry summer drawdown will not land in FALLING; it proves that on this record the slots at the margin are recessions. A gauge with a flatter regime might not behave the same way.

**Neutral**:

- No migration, so nothing to deploy ahead of the code and nothing to roll back at the schema level.
- FALLING grows from about seventeen to about twenty four percent of classifiable slots. Every bucket stays far above the thirty error minimum.

## Follow-up

- [ ] Record the measured counts and transition matrix from build step 7 in this spec, the way the falling regime child records its own.
- [ ] PEAK measures 0.831 with seventy four percent of forecasts too high over 247 scores, even after the split. A genuine plateau should be close to unbiased. Worth its own investigation: either a crest is simply hard to forecast, or PEAK still mixes the crest with the first hours of the drop and wants splitting again. Deliberately not settled here.
- [ ] The marginal group at `-0.1 * v` still measures 0.816 rather than 0.97, which hints that a looser threshold would catch more real recession. Unmeasured. Sweep `-0.05 * v` and `-0.075 * v` for both bucket share and bias before touching the number again.
- [ ] Revisit once a second large recession is on the record. Every number here comes from one gauge and one climate, and the mechanism that broke the floor, a seven day median dominated by the event it is meant to give context to, may behave differently after a smaller flood.
- [ ] No build approach is recorded for the project, so Tracer Bullet has now been assumed a seventh time.

## References

**Project sources**

- [2026-08-27-falling-threshold-misses-tail.md](findings/2026-08-27-falling-threshold-misses-tail.md), the measured finding that the shipped rule catches none of the four observed miss slots, plus its addendum confirming this applies to `max(v, m)` and not only to the plain median.
- [2026-08-27-recession-regime.md](findings/2026-08-27-recession-regime.md), the original eight misses on the live scorecard.
- [0010-falling-regime.md](0010-falling-regime.md), the decision this child revises, including its measured bucket counts from 2026-08-28.
- [2026-08-28-falling-denominator-sweep.md](findings/2026-08-28-falling-denominator-sweep.md), the measurements this decision rests on: 3,644 classifiable slots swept across five candidate thresholds, the bias of each labelling group, and the low flow guard measurement, with the method needed to re run them.

**Practices and standards**

- Measure before you optimise. The floor was justified by a hypothetical population and removed by measuring the real one.
- Conditioning an error distribution on a covariate is only worth doing if the groups actually differ; pooling a one sided sample with an unbiased one produces quantiles wrong for both.
