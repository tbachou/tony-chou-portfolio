# Verify: hindcast seeding over a bulk imported archive · spec 0010 · verified 2026-08-24

_Steps derived from the acceptance criteria in [0010-hindcast-seeding.md](0010-hindcast-seeding.md). `/check verify` runs these; `/test` locks the durable ones._

## Commands

- [x] `npm test --workspace=apps/streamflow` → all green, including `as-of.spec.ts`, `observations.repository.spec.ts`, `score.repository.spec.ts`, `bucket.spec.ts`, `bucket.repository.spec.ts`, `hindcast.spec.ts` → AC-H1, AC-H3, AC-H5, AC-H6, AC-H9
- [x] `npx tsc --noEmit -p apps/streamflow/tsconfig.json` and the same for `apps/web` → clean
- [x] Against a throwaway local Postgres with the migrations applied: `PIPELINE_DATABASE_URL=postgres://...@localhost:PORT/postgres?sslmode=disable npx tsx apps/streamflow/scripts/verify-bucket.ts` → all 6 cases agree across query, rule, fixture and both axes → AC-H4
- [x] Against the live store, read only: `npx tsx apps/streamflow/scripts/verify-as-of.ts` → both axes report identical rows at every probe instant → AC-H1, AC-H3
- [x] `grep -rn "'validTime'" apps/streamflow/src --include=*.ts | grep -v spec` → the only caller passing the loose axis is `forecast/hindcast.ts` → AC-H2

## Value sourcing checks

One per row of the spec's Value sourcing table, each exercising the edge that breaks if the source is wrong.

- [x] Which axis bounds a read: call `observationsAsOf` and `scorablePredictions` with no axis, then with `'recordedAt'` → identical SQL text and identical parameters both times → AC-H1, AC-H6
- [x] Hindcast history at slot `T`: over a fixture where every row shares one `recordedAt` far in the future, `asOfWalk(rows, 'validTime')` returns rows at every slot while `asOfWalk(rows)` returns none until that instant → AC-H3
- [x] Live history at instant `T`: a reading revised after `T` stays invisible on the default axis → AC-H6
- [x] Hindcast scoring: on the `validTime` axis a prediction whose target has passed is scorable even though every reading was recorded long after that target; where a target has two revisions the greater `recordedAt` wins → AC-H9
- [x] Live scoring: with no axis passed, the lateral join still carries `o."recordedAt" <= $1` → AC-H6
- [x] Which past errors enter a bucket: a bucket built for a prediction issued at `T` holds no error whose contributing prediction's `targetTime` is after `T`, and both axes return the same ratios → AC-H4, AC-H5
- [x] The dashboard disclosure: constant text, checked in the UI step below → AC-H7

## Seeding run, against a throwaway before the live one

- [x] Seed a throwaway store shaped like the live one, every reading sharing a single `recordedAt`, then run the hindcast over a window inside it → predictions land at every slot, not only the last handful, and scores land at every slot once the first targets pass. Reference run of 2026-08-24: 237 slots asked for, 237 produced a prediction, 1,422 predictions and 1,368 scores. Interval provenance splits 1,080 regime conditioned, 114 pooled from real errors, 240 fixed placeholder, so 1,194 of 1,434 rows in the store were drawn from measured errors. Note `intervalSeeded` means the conditioned bucket specifically, not any bucket → the failure this decision exists to fix
- [x] On the same store, `publicPredictions` returns zero of the seeded rows → AC-H8
- [x] Before any future re run against the live store, re measure the zero revision property: `SELECT COUNT(*) FROM (SELECT "validTime" FROM observations GROUP BY "gaugeId", "validTime" HAVING COUNT(*) > 1) t` → still 0, otherwise the loose axis is no longer equivalent and the decision needs revisiting. Measured 2026-08-24: 0 revised of 86,509 observations, across 6 distinct `recordedAt` values

## UI / manual

- [x] Visit `/streamflow` with at least one current forecast in the store → the seeding disclosure paragraph appears beside the forecasts table, in the muted terminal style, saying the ranges came from a backtest over readings USGS had already reviewed and may run slightly narrow → AC-H7
- [x] Reload after the buckets are well past seeding → the paragraph is still there, it is not gated on anything about the seeding being in progress → AC-H7

## Findings from the 2026-08-24 verify run

Neither is a defect in this child spec's implementation. Both are recorded here so the next reader does not rediscover them.

- **AC-H6 and AC-H4 contradict each other for the bucket query.** AC-H6 asks that the bucket query with no axis passed produce exactly what it produces today; AC-H4 moves its bound from `actualRecordedAt` to `targetTime` on both axes. The code follows AC-H4, which is what the Decision requires, and AC-H6 holds in full for the other two reads. The wording needs reconciling alongside the AC-I13 follow up already listed in the child spec.
- **The unseeded footnote misdescribes the pooled path, and now sits directly above the seeding disclosure.** `intervalSeeded` is true only for the regime conditioned bucket, so a range drawn from a large pooled sample renders with the `*` and the words "a deliberately wide placeholder". Observed on 2026-08-24 with a central of 166 and a range of 126 to 221 drawn from 232 real errors, where the actual placeholder band would have been 55 to 498. The two paragraphs then read as contradicting each other: one calls the range a placeholder, the next says it came from a backtest. This predates AC-H7 and belongs to the intervals child.

## Acceptance-criteria coverage

- AC-H1 covered by the two SQL statement checks and the bucket axis check
- AC-H2 covered by the hindcast spec's axis assertions, the predict spec's default check, and the grep
- AC-H3 covered by the `reconstructAsOf` and `asOfWalk` validTime tests and `verify-as-of.ts`
- AC-H4 covered by the bucket oracle and query tests and `verify-bucket.ts` on both axes
- AC-H5 covered by the bucket oracle test that no error with a later target survives
- AC-H6 covered by the byte for byte SQL comparisons for the history read and the scorable query
- AC-H7 covered by the two UI steps
- AC-H8 covered by the public read check on the seeded throwaway
- AC-H9 covered by the scorable query tests on the validTime axis

---

# Verify: falling regime · spec 0010 · written 2026-08-27

_Steps derived from the acceptance criteria in [0010-falling-regime.md](0010-falling-regime.md). `/check verify` runs these; `/test` locks the durable ones. Boxes marked `[x]` were run during the build; the unticked ones need the production database or the repository variable and are the operator's._

## Commands

- [x] `npm test --workspace=apps/streamflow` → 270 green, including 13 in `regime.spec.ts` and 22 in `backfill-regime.spec.ts` → AC-F1, AC-F2, AC-F3, AC-F5, AC-F6, AC-F7, AC-F8, AC-F9, AC-F10, AC-F13
- [x] `npx tsc --noEmit -p apps/streamflow/tsconfig.json`, and the same for `apps/web` and `apps/api` → clean
- [x] `npm run lint` → no errors (11 pre existing warnings in `apps/web`, none in the changed files)
- [x] Against a throwaway local Postgres with the migrations applied, seeded with one prediction whose old label is PEAK and one score whose old label is BASEFLOW, both FALLING under the new rule: `PIPELINE_DATABASE_URL=postgres://...@localhost:PORT/dev npx tsx apps/streamflow/scripts/backfill-regime.ts` → prints `PEAK -> FALLING` and `BASEFLOW -> FALLING`, per model and horizon, and writes nothing → AC-F6
- [x] The same fixture with `--write` → the two labels move, and `lowerCfs`, `upperCfs`, `q10Used`, `q90Used`, `intervalSeeded` and `bucketSize` are unchanged on the moved row → AC-F10
- [x] Rerun with `--write` and the snapshot file left in place → `reusing the one taken ...`, checks hold, 0 rows written → AC-F5, AC-F9
- [x] Delete `apps/streamflow/.regime-backfill/` and rerun `--write` over the migrated store → refuses, names the missing snapshot, exits non zero → AC-F9
- [x] Deploy the enum migration alone and confirm `FALLING` exists in the production `Regime` type before any code that can write it ships. Applied 2026-08-28 with `prisma migrate deploy`; `migrate status` clean and the enum reads `BASEFLOW, RISING, PEAK, FALLING` → AC-F1
- [x] Set the GitHub repository variable `STREAMFLOW_FORECASTING` to `false`, then confirm `.github/workflows/streamflow-score.yml` skips and `streamflow-pipeline.yml` still ingests and rescans. Scoring run 33170642752 shows `skipped`; pipeline run 33158495888 ingested 48 rows → AC-F11
- [x] Against production, forecasting off: report only run → counts and full transition matrix recorded in [0010-falling-regime.md](0010-falling-regime.md) under `## Measured` → AC-F6
- [x] `--write` → 3,054 predictions and 3,000 scores relabelled, no forbidden cell, null sets unchanged, 0 fallback scores, and the write run's matrix byte identical to the report run's → AC-F5, AC-F7, AC-F8, AC-F9
- [x] Snapshot kept through the write. A rerun with it present wrote 0 rows; deleting it and rerunning refused, naming the missing pre migration labels → AC-F9
- [x] Flag back on 13:11 UTC. The 12:00 slot issued at 16:12 with all 6 rows present (2 models x 3 horizons), every one `intervalSeeded` true against buckets of 1,450 to 2,342, so AC-F12's fall through was never needed → AC-F11, AC-F12
- [x] Visited the live page → the intervals paragraph names baseflow, rising, falling and at a peak → AC-F14

## Value sourcing checks

One per row of the spec's Value sourcing table, each exercising the edge that breaks if the source is wrong.

- [x] `m`, the seven day median: readings at or after the instant being judged never enter it, so a future spike cannot drag the median → AC-F1
- [x] `d`, the twelve hour change: a hole more than two hours wide at the twelve hour mark returns null rather than comparing against the wrong reading → AC-F3
- [x] The rising threshold, still `0.1 * m`: a rise of `0.1 * m` is RISING at baseflow and at a storm peak alike, and rising is tested before falling → AC-F2
- [x] The falling threshold, `0.1 * max(v, m)`: at 1000 against a median of 200, a fall of exactly 100 is FALLING and a fall of 99 is PEAK → AC-F1, AC-F13
- [x] The same threshold's floor: at 50 against a median of 200, a fall of 5 (a tenth of the value) is BASEFLOW while a fall of 20 (a tenth of the median) is FALLING → AC-F1, AC-F13
- [x] The peak multiple, still `1.5 * m`: a high steady river is still PEAK → AC-F1, AC-F13
- [x] The minimum history, still 224 readings: fewer returns null, and a non positive median returns null → AC-F3
- [x] A prediction's history: bound at that prediction's own `issuedAt`, computed once per distinct issue slot, and every row the slot wrote carries the same label → AC-F5
- [x] A live score's history: bound at the `startedAt` of the newest SCORE run at or before its `scoredAt`. Over a fixture where a revision lands between the two instants, `startedAt` gives FALLING and `scoredAt` gives BASEFLOW, so the two really do differ → AC-F5
- [x] A live score with no SCORE run before it: falls back to `scoredAt` and is counted in the report rather than passing silently → AC-F5
- [x] A hindcast score's history: bound at its own `scoredAt`, ignoring any SCORE run → AC-F5
- [x] The pre migration labels: saved before the first row is written, and a resumed run compares against that file. Over a fixture where the store already holds FALLING and the file says RISING, the run reports `RISING -> FALLING` and refuses → AC-F9
- [x] The knowability axis: over an archive sharing one late `recordedAt`, a hindcast prediction is labelled on `validTime` and would be null on `recordedAt`, while a live prediction is labelled on `recordedAt` → AC-F5
- [x] `v` for a prediction: the persistence value at issue, drawn from that prediction's own history → AC-F5
- [x] `v` for a score: the score's stored `actualCfs` → AC-F5
- [x] How history is loaded: the gauge's whole record read once and walked forward once per axis, rather than a query per row → AC-F5
- [x] The expected transition matrix: checked rather than printed. A fixture where a RISING row would move fails with the cell named, and writes nothing → AC-F7
- [x] The class names in the case study copy: the rendered page names four classes → AC-F14

## Acceptance-criteria coverage

- AC-F1 covered by the ordering, boundary and floor tests in `regime.spec.ts`
- AC-F2 covered by the rising first tests and the forbidden `RISING ->` cell in the backfill checks
- AC-F3 covered by the three null tests, unchanged from before this child
- AC-F4 holds structurally: both columns are written from `classifyRegime`, and the backfill relabels both from the same function
- AC-F5 covered by the axis, slot sharing, run start, fallback and hindcast binding tests, plus the throwaway database run
- AC-F6 covered by the report only tests and the throwaway run; the production run is still owed
- AC-F7 covered by the forbidden cell test and the allowed transition table
- AC-F8 covered by the null stays null tests and the null set movement refusal
- AC-F9 covered by the interrupted and resumed test, the snapshot before write ordering test, and the already migrated refusal
- AC-F10 covered structurally by the writer interface, which can set only a regime, and observed on a real database
- AC-F11 not covered here: it is a repository variable, and the window is the operator's
- AC-F12 needs no new mechanism; the existing ladder already falls through to pooled with `intervalSeeded` false
- AC-F13 covered by the four ordering and floor tests
- AC-F14 half done: the parent index states the four class rule and the case study copy names four classes

---

# Verify: falling denominator · spec 0010 · written 2026-08-28

_Steps derived from the acceptance criteria in [0010-falling-denominator.md](0010-falling-denominator.md). `/check verify` runs these; `/test` locks the durable ones. Boxes marked `[x]` were run during the build; the unticked ones need the production database and the repository variable, and are the operator's._

## Commands

- [x] `npm test --workspace=apps/streamflow` → 289 green, including 20 in `regime.spec.ts` and 35 in `backfill-regime.spec.ts` → AC-D1, AC-D1a, AC-D2, AC-D3, AC-D4, AC-D4a, AC-D4b, AC-D4c, AC-D5, AC-D5a, AC-D5b, AC-D6, AC-D7, AC-D8a, AC-D9
- [x] `npx tsc --noEmit -p apps/streamflow/tsconfig.json` → clean; `npx eslint .` in the workspace → clean
- [x] Deliberate revert check: refreezing FALLING in the matrix fails the two AC-D4a and AC-D4c tests by name; removing the completion stamp fails the three AC-D5a tests by name. Both restored, suite green again → the new tests are not vacuous
- [x] The sweep script is committed at `apps/streamflow/scripts/sweep-falling-threshold.ts` and [2026-08-28-falling-denominator-sweep.md](findings/2026-08-28-falling-denominator-sweep.md) records the method → AC-D12
- [x] The first migration's snapshot is archived at `.regime-backfill/archive/max-v-m-2026-08-28T13:10:37.156Z.json` and the run takes `--snapshot` with no default → AC-D5
- [x] Rehearsal report only run against production, read only, forecasting still on (2026-08-28 23:33 UTC): checks hold, all 447 PEAK and 2,642 RISING predictions stay, null sets unchanged (1,038 predictions, 126 scores), FALLING → BASEFLOW holds 3 prediction and 3 score rows (one slot times persistence's three horizons, none for climatology, which has no rows at that slot), BASEFLOW → FALLING moves 1,320 predictions and 1,291 scores, 0 fallback scores, 0 mixed axis slots. A rehearsal only: the paused run's numbers are the ones AC-D7 records → AC-D3, AC-D4, AC-D4a, AC-D9
- [x] `STREAMFLOW_FORECASTING` set to `false` by the operator, read back `false` at 23:43 UTC on 2026-08-28. The 23:36 score run had already completed before the snapshot was taken, so nothing it wrote escaped the relabelling; the 00:30 skip and the 00:00 ingest are confirmed alongside the flag on step below → AC-D8
- [x] Against production, forecasting off: report only run at 23:41:55 UTC, `npx tsx scripts/backfill-regime.ts --snapshot=.regime-backfill/max-v-floor.json` from `apps/streamflow` → checks held and the counts and full transition matrix are recorded in the child spec under `## Measured` → AC-D7, AC-D11
- [x] Rerun with `--write` at the same snapshot path, same sitting (23:44:31 UTC) → reused the report's snapshot, zero drift runs, no forbidden cell, null sets unchanged on both columns, PEAK (447) and RISING (2,642) untouched, the FALLING → BASEFLOW cell exactly one slot (3 prediction and 3 score rows), 1,323 predictions and 1,294 scores written → AC-D4, AC-D4b, AC-D8a, AC-D9
- [x] After the write: the snapshot carries `completedAt: 2026-08-28T23:44:31.859Z`, and a rerun against it refused, naming that instant and exiting non zero → AC-D5a
- [x] Checked every moved row, not a sample (2026-08-29, read only, via the write snapshot's pre write labels): all 1,323 relabelled predictions keep ordered bounds and intact interval provenance (`q10Used`/`q90Used` present wherever `intervalSeeded` is true, `bucketSize` present everywhere). The three FALLING to BASEFLOW rows are the 2024-08-31 12:00 slot with a central of 15.8 against the 18.9 floor, the exact stricter region AC-D4a names → AC-D6
- [x] Pushed to main at `09cb13f` on 2026-08-29 after the predeploy gate cleared (security review clean, code review 10 findings all Medium and below, clinical auditor not applicable); flag back to `true`; the dispatched pipeline run issued the 2026-08-29T00:00 slot at all three horizons for both models, every row `intervalSeeded` true against the relabelled buckets, and the paused window's scheduled run ingested 12 rows while issuing nothing, so ingest never stopped. The score job's first post resume run lands at the next hourly cron and is gated by the same variable the predict step just proved → AC-D8, AC-D11
- [x] `MIN_BUCKET_ERRORS` doc comment in `apps/streamflow/src/config.ts` updated with the post relabelling per model and horizon bucket counts → AC-D10 (the parent index's AC-12 and its Value sourcing regime row were already corrected on this branch)

## Value sourcing checks

One per row of the spec's Value sourcing table, each exercising the edge that breaks if the source is wrong.

- [x] The falling threshold, `0.1 * max(v, flowFloorCfs)` with the median absent: the 2026-08-28 live miss, 303 against a median of 730 falling 42, is FALLING; the four slots from the 2026-08-27 finding all classify FALLING → AC-D1
- [x] The floor as guard, not input: below the floor the threshold comes from the floor, so a decline that is a tenth of a very small number does not qualify → AC-D1a
- [x] A caller that supplies no floor fails: `classifyRegime` throws on a missing or non positive floor rather than defaulting → AC-D1a
- [x] The rising threshold, the peak multiple, the test order and the three null conditions are unchanged → AC-D2
- [x] Every value at or above `1.5 * m` produces the same class under both rules, exercised as a property over generated values → AC-D3
- [x] The snapshot's rule tag: a snapshot taken under another rule, including the first migration's untagged file, is refused with both rules named → AC-D5
- [x] Drift: a report only run saves its snapshot and the write reuses it, so ingest and rescan runs are counted from the instant the report described the store, not from the write's own start → AC-D8a
- [x] The transition matrix arrives per run on `BackfillOptions`; the module level constant is a preset, not a default → AC-D4
- [x] The writer interface can set only a regime; the interval and provenance columns are unreachable from the backfill → AC-D6

## Acceptance-criteria coverage

- AC-D1, AC-D1a covered by the threshold, floor guard, live miss, four slot and throw tests in `regime.spec.ts`
- AC-D2, AC-D3 covered by the unchanged ladder tests and the generated property over both rules
- AC-D4, AC-D4a, AC-D4c covered by the corrected matrix tests: a FALLING row above the floor stays, one below the floor and value moves to BASEFLOW, and the PEAK landing is legal
- AC-D4b covered by the frozen PEAK refusal test and observed on the rehearsal run (447 stay)
- AC-D5 covered by the rule tag refusal, the required snapshot path, and the archived first snapshot
- AC-D5a covered by the stamp on success, no stamp on refusal or interruption, and the refusal on reload
- AC-D5b covered by the report caveat test; the blind spot is printed beside every clean check
- AC-D6 structural via the writer interface, and observed on the production store after the write: all 1,323 moved rows hold intact interval columns
- AC-D7 covered by the report only tests; the production report run is still owed
- AC-D8 is the repository variable; the window is the operator's
- AC-D8a covered by the drift refusal and report anchoring tests; exercised for real at the production write
- AC-D9 covered by the null set tests and the rehearsal (null sets unchanged)
- AC-D10 half done: parent index corrected; `MIN_BUCKET_ERRORS` numbers wait for the report run
- AC-D11 waits for the flag to come back on
- AC-D12 covered by the committed sweep script and the findings document

---

# Verify: interval calibration · spec 0010 · written 2026-08-29

_Steps derived from **AC-16** in [index.md](index.md): the dashboard shows interval calibration, the share of actuals that fell inside the stated interval, compared against the nominal level._

## Commands

- [x] `npm test --workspace=apps/streamflow` → 306 green, including 15 in `calibration.spec.ts` → AC-16
- [x] Deliberate revert check: flipping the sign of `gap` and returning 0 rather than null for an empty group each fail their named tests; the suffix-ranking regression fails the horizon ordering test. All restored → the tests are not vacuous
- [x] `npx tsc --noEmit` on both workspaces, `eslint` on both → clean
- [x] Against the live store, read only: `/streamflow` renders both populations separately — live 8.0% of 50, backtest 78.6% of 17,565, each against 80.0% claimed → AC-16
- [x] The by river state table renders worst gap first over the backtest, filtered to groups with 30 or more grades: rising 53.1% (−26.9 pts), climatology rising 57.8%, falling 64.1%, baseflow 95.1% (+15.1 pts, wider than needed), peak 65.4% and 67.9% → AC-16
- [ ] After deploy, confirm the section renders on the live site and the live figure has moved as more forecasts are graded

## Value sourcing checks

- [x] Coverage numerator and denominator: `Score.withinInterval` counted against all grades in the group, one score per prediction (the read applies the same newest revision rule the skill query does) → AC-16
- [x] The nominal level: averaged from each row's stored `Prediction.intervalLevel` rather than assumed to be 0.80, so a later policy change cannot silently reinterpret old rows
- [x] The two populations never sum: `gradedIntervals` takes the hindcast flag as a required argument and the page calls it twice, holding the reports apart
- [x] An empty group reports unknown rather than zero coverage, so "no data" and "every range missed" cannot render alike
- [x] Groups thinner than 30 grades are withheld from the breakdown, the same floor the intervals use before drawing on a bucket

## What this does not yet do

- The panel reports; it does not act. Nothing feeds the measured miscalibration back into how ranges are drawn, and the rising bucket at 53.1% is the strongest argument in the record for revisiting that.
- Coverage is read over the whole record rather than a window, so the live figure will move slowly once the sample grows. A windowed view is worth adding when there is enough live history for it to mean anything.

---

# Verify: rain, as it was forecast · spec 0010 · written 2026-08-30

_Steps derived from the acceptance criteria in [0010-forecast-rain.md](0010-forecast-rain.md). `/check verify` runs these; `/test` locks the durable ones._

_This child is **part built**. Build plan tasks 1 to 10 shipped: the table and its two migrations, the pinned client and parser, the as of read with its diff and batched write, one month ingested end to end, the resumable backfill, the archive boundary derived per lead from the store, the weather read's knowability axis, the rain window feature with its paired query and verify script, the antecedent wetness feature, and the leakage test over weather rows on both axes. Tasks 11 and 12 have not. Two of the sixteen criteria therefore have no code to exercise and are marked `not built` below, so an unticked box there is not mistaken for a check nobody got round to running. **AC-R10 is deliberately half built**: the feature returns null on a short window, and the forecaster skip and tally it calls for belong to slice 4, since nothing in this child consumes the features. Boxes marked `[x]` were run on 2026-08-30; the unticked ones under Commands need a database and are the operator's._

## Commands

- [x] `npm test --workspace=apps/streamflow` → 488 green across 39 suites, including 176 across the thirteen rain suites: `openmeteo/client` 11, `openmeteo/parse` 16, `asof/forecasts.repository` 17, `asof/forecast-as-of` 14, `forecast/rain` 18, `forecast/rain.repository` 16, `forecast/leakage` 9, `forecast/wetness` 11, `ingest/forecast-window` 18, `ingest/forecast-write` 8, `ingest/forecast-diff` 10, `ingest/ingest-forecasts` 12, `ingest/backfill-forecasts` 16 → AC-R1, AC-R2, AC-R3, AC-R4, AC-R5, AC-R6, AC-R7, AC-R8, AC-R8a, AC-R9, AC-R10, AC-R11, AC-R12, AC-R14, AC-R16
- [x] `npx tsc --noEmit -p apps/streamflow/tsconfig.json` → clean. Note a stale generated Prisma client fails three of these suites at compile time with `'leadHours' does not exist in type 'PipelineRunSelect'`; run `npx prisma generate` in the workspace first, since `src/generated/prisma` is gitignored and does not travel with a branch
- [x] Break it, then put it back: replace the hand written branch in `forecastKnowableAt` with `row[axis]` and the query's `"issuedAt" <= ${asOf}` with `"validTime"` → 7 tests fail across `asof/forecast-as-of` and `asof/forecasts.repository`. This is the bug AC-R8a exists to prevent, and it typechecks, so a passing suite before the mutation proves nothing on its own → AC-R8a
- [x] Break it, then put it back: change the `axis` default on both to `'validTime'` → 6 tests fail. A loosened default is how every live caller would silently acquire the archive rule by having been written before the parameter existed → AC-R8
- [x] Break it, then put it back: move the query's window bounds onto `"issuedAt"` along with the axis bound → 3 tests fail. The window asks which hours the caller wants, which is not the question the axis answers → AC-R8
- [x] Break it, then put it back: delete the `forecastKnowableAt(row, axis)` bound from `rainWindow` entirely → 4 of the 9 leakage tests fail, and they are exactly the four that carry the criterion: the two `draws on no row` assertions and the two refusals, one of each per axis. The five that still pass are the clean window, the two controls and the two fixture claims, which is the right split: the controls read where a shadow is meant to be visible, so they cannot be what catches a missing bound, and a leak should not be detectable by a test of well formed data → AC-R9
- [x] Break it, then put it back: replace that bound with a generic `row[axis]` lookup → 4 leakage tests fail, `draws on no row issued after the issue instant` among them. This is AC-R8a's hazard reaching AC-R9's property, and it typechecks → AC-R9, AC-R8a
- [x] Break it, then put it back: reverse the two arms of the branch in `forecastKnowableAt` → 6 of the 9 fail, every case on both axes. The axis is the whole of what these fixtures vary, so swapping it breaks all of them rather than half → AC-R9
- [x] `PIPELINE_DATABASE_URL=<throwaway> npx tsx scripts/verify-rain.ts` against a Postgres 16 container with the migrations applied → `all 15 cases agree: query, rule and fixture`, seeding 364 rows. This is the only check that the aggregate query and `rainWindow` mean the same thing; the unit suites can only read the statement. Re-running seeds 0 new rows, so the fixture is idempotent → AC-R7, AC-R9, AC-R10
- [x] Break it, then put it back: drop the `::int` from `COUNT(*)` in `rain.repository.ts` → 8 of 11 cases fail, every one of them a window that should have returned a number. Postgres counts in `bigint`, Prisma hands it back as a `BigInt`, and `hours !== horizonHours` is then true for every window ever read. The three that still pass are the ones expecting null, which is exactly why this would survive a casual look → AC-R10
- [x] Break it, then put it back: drop the `knowableBy` clause from the rain query, so the statement carries no visibility bound at all → 3 of 15 cases fail, one of them the archive leakage case, whose forged row is admitted on **both** axes once the bound is gone. The two control cases still pass, which is what they are for: they read where the shadows are meant to dominate, so they cannot be what catches this → AC-R9
- [x] Break it, then put it back: swap the two columns in `knowableBy`, so the live axis bounds on `issuedAt` and the archive axis on `recordedAt` → 6 of 15 fail, every axis case including all four leakage ones. This is the same mistake as the `row[axis]` mutation above, made in SQL instead of TypeScript, and the query path has to be held to it separately because no mock can → AC-R9, AC-R8a
- [x] Break it, then put it back: remove the `DISTINCT ON` from the rain subquery so the aggregate runs over raw rows → 2 of 11 fail, and they fail in opposite directions. The revised hour case goes null where it owed 28 mm; the padded short window returns 28 mm where it owed null, which is the database confidently reporting rain over a window it does not hold. Nine cases still pass, so a fixture without those two would have shipped the double count → AC-R7, AC-R10
- [x] Break it, then put it back: return `d` instead of `m` from `antecedentWetness` → 9 of 11 fail. Return `0` instead of null where `regimeInputs` refuses → 4 of 11 fail → AC-R11
- [x] Checked, and it does **not** fail: hardcoding `0` for `valueAtIssue` inside `antecedentWetness` leaves all 11 green. That is the honest state of it. The parameter feeds `d` alone, and the median and all three refusals are properties of the history, so there is nothing observable for a test to pin. It is passed through for forward coupling, not because the suite guards it → AC-R11
- [x] `gh workflow run streamflow-score.yml` against the live store → `No pending migrations to apply.` then `score OK: 0 rows, run cmtg99m18...`. A `pipelineRun.create()` whose RETURNING clause names `leadHours` now succeeds against the production schema, which is the exact call that raised P2022 on 2026-08-30 → AC-R5
- [ ] Against a throwaway local Postgres with the migrations applied, insert a `weather_forecasts` row with `leadHours` of 0 → rejected by `weather_forecasts_lead_hours_check`. The parser half is covered by the suite above; this is the database half, and the whole point of AC-R2 is that the two catch different mistakes → AC-R2
- [ ] Against a throwaway seeded with two months at two leads, run the backfill twice → the second pass fetches nothing and writes nothing. The suite proves the skip against a stubbed reader; this proves it against real rows and a real unique key → AC-R3, AC-R5
- [ ] Against the live store, read only: count `OK` `OPEN_METEO_INGEST` runs grouped by `leadHours` and compare against the months the archive covers → every month accounted for at every lead, no lead running behind the others → AC-R5
- [ ] Against a throwaway seeded at lead 48 with rows whose `issuedAt` and `validTime` straddle one issue time `T`, call `forecastsAsOf` at `T` on each axis → the archive axis returns rows the live axis cannot see, and neither returns a row issued after `T`. The suite compares generated SQL; this is the only check that the two axes mean what they say against real rows → AC-R8, AC-R8a
- [ ] Against the live store, read only: call `earliestStoredForecastValidTimes` for the gauge and pinned model → one date per lead, each at or after 2024-01-18, and none of them equal to `BACKFILL_START`. A date matching the constant would mean the derivation is reading a literal back to itself → AC-R6

## Value sourcing checks

One per row of the spec's Value sourcing table that has code behind it. Each names the test that exercises it.

- [x] Request host and columns: `names the pinned host`, `requests only suffixed columns for the lead it was given`, `stores from the suffixed columns alone, never the unsuffixed one` → AC-R1
- [x] The model: `names the pinned model and never best_match` → AC-R12
- [x] `leadHours` on a row: `tags every value with the lead it was requested at`, plus `throws rather than falling back when the suffixed column is absent`, so an absent column cannot quietly become a different lead → AC-R1, AC-R4
- [x] `issuedAt`: `derives issuedAt as validTime minus leadHours`, `always lands before the hour it describes` → AC-R4
- [x] `recordedAt`: `stamps rows with a recordedAt captured after the fetch, never the run start`, so no row claims it was known before the response arrived → AC-R3
- [x] Whether to write a row: `writes nothing when precip and temp both match`, `treats an absent tempC and a stored null as equal`, `re-running an unchanged month writes zero rows` → AC-R3
- [x] `PipelineRun.leadHours`: `records each run against its own lead`, written at run creation before anything is fetched → AC-R5
- [x] Which chunks remain: `keys on the month and the lead together, in one query`, `skips a month already recorded OK for that lead`, `still runs a month at lead 48 when only lead 24 is done`, `ignores a PARTIAL month, so a ramp in gap is not frozen forever`, `ignores a run carrying no lead, such as a USGS ingest` → AC-R5
- [x] Run status: `records PARTIAL when the response falls short of the window`, `is PARTIAL even when the response looks complete, so it is never skipped`, `is OK again once the month has fully elapsed` → AC-R14
- [x] Never asking for the future: `never asks for an hour that has not happened yet`, `records the run against the whole month, not the clamped request` → AC-R14
- [x] Bounded database cost: `reads the comparison set in exactly one query regardless of month length`, `issues exactly one statement per call`, `ingests a full month in a statement count in the low tens, not hundreds` → AC-R16
- [x] First usable date per lead: `asks for the least validTime per lead, at one gauge and model`, `binds no date at all, so no literal can slip in as a floor`, `omits a lead the store holds nothing for`, `reports nothing at all on an empty store, rather than a floor`, `reports a stray early row even when it makes leads non-monotonic`. The last one matters because the earliest row held is not the first usable date and does not even order across leads → AC-R6
- [x] Which rows are visible: `reads issuedAt, not validTime, on the archive axis`, `judges the archive axis on issuedAt`, `bounds on issuedAt, not validTime, when the archive axis is asked for`, `leaves the window bounds on validTime under the archive axis`, `keeps the reduction on recordedAt under the archive axis` → AC-R8, AC-R8a
- [x] That the mapping is hand written rather than looked up: `disagrees with a row[axis] lookup on the archive axis`, `agrees with a row[axis] lookup on the live axis, where the idiom is right`. The fixture is built so the two columns give different answers, which is what AC-R8a asks a test to show → AC-R8a
- [x] That no feature draws on a row it could not see: `draws on no row fetched after the issue instant` on the live axis, `draws on no row issued after the issue instant` on the archive axis, each with the matching `refuses the window rather than summing the hours that survive`. Every fixture is a knowable window shadowed at **every** hour by a thousand millimetre row the prediction could not have held, and is read a second time on the axis where that shadow is legitimately visible and does dominate. That second read is the control, and without it the whole suite would pass against a fixture that could never have leaked → AC-R9
- [x] That visibility is not reduction: `does not reduce, so a revised hour appears more than once`. The reduction lives in `rainWindow` and in the rain query, never in the read they draw from → AC-R8
- [x] Which row stands for an hour: `counts a revised hour once, at its newest visible value`, `agrees with the same window holding only the newer revision`, `ignores a revision that is not visible yet on the live axis` → AC-R7
- [x] The rain feature: `sums a complete window`, `takes only rows whose lead equals the horizon`, `excludes another gauge and another model`, `excludes the hour at the issue instant`, `includes the hour at the target instant`, `excludes an hour past the target instant` → AC-R7
- [x] Hours a complete window holds, and the refusal when it is short: `returns null when one hour is missing, never a partial sum`, `is null when a revised hour pads a window that is really short`, `returns null when the count somehow exceeds the horizon` → AC-R10
- [x] Zero against null, which are different answers: `returns 0 for a dry window and null for a missing one`, and the same pair against the database in `verify-rain`. A gap is not a forecast of no rain → AC-R10
- [x] Antecedent wetness: `is the median discharge over the prior seven days`, `is exactly the m that regimeInputs derives` (the reuse claim stated as an equality, so the feature and the regime cannot drift apart), `reads a real median, not the newest or the mean`, `ignores readings at or after the issue instant`, `ignores readings older than seven days`, `counts only the readings inside the window towards the minimum` → AC-R11
- [x] Where wetness refuses: `is null below the 224 reading minimum` (223 refuses, 224 answers), `is null on a non positive median`, and `is null when no reading sits near the twelve hour mark, though the median is fine`. **That third refusal is not in AC-R11's list**, and it is real: `regimeInputs` also needs a reading within two hours of the twelve hour mark, because it derives the twelve hour change beside the median. Wetness does not use that change and inherits the refusal anyway, so it refuses a little more often than the criterion's prose implies. Safe direction, since it becomes AC-R10's skip rather than a wrong number, and worth correcting in the spec → AC-R11
- [x] That the reconstruction is the caller's job: `cannot see the difference a reconstruction makes, which is why callers must do it`. `regimeInputs` filters on `validTime` only, so a reading that had happened but had not yet reached the pipeline is invisible to it. The axis is spent before a slot reaches wetness, which is why the function takes none → AC-R11

## What this does not yet do

Two criteria have no implementation at all, and one is half built. Listed so an unticked box is not read as an unrun check.

- **AC-R10 is half built.** `rainWindow` returns null on a short window, which is the part this child owns. The rest of the criterion, a forecaster skipped for that horizon with the existing skipped tally incremented and the run's status reflecting it, has nothing to attach to: no forecaster reads rain, `BaselineModel.central` takes no weather argument, and the build plan states plainly that nothing in this child consumes the features. It lands in slice 4 with the first consumer.
- **AC-R13**, live weather ingest at 00, 06, 12 and 18 UTC. The pipeline workflow has no weather step.
- **AC-R15**, Open-Meteo attribution on the dashboard. The walkthrough page credits the source; `/streamflow` does not, and the licence requires it wherever the data is shown.

## Acceptance-criteria coverage

- AC-R1 covered by the client and parser suites: suffixed columns only, the unsuffixed one never read, a missing column throwing rather than falling back
- AC-R2 covered on the parser side by `refuses a lead the store may never hold`; the database check constraint is unexercised and owed above
- AC-R3 covered by the diff suite, including the absent tempC against stored null case that would otherwise write a row every run
- AC-R4 covered by the write suite's derivation tests and by the unique key in migration `20260830050821`
- AC-R5 covered by the backfill suite's resume tests and, at runtime, by the dispatched scoring run writing a `PipelineRun` against the production schema
- AC-R6 covered by `earliestStoredForecastValidTimes` and its suite, which binds no date at all, so no literal can stand in as a floor
- AC-R7 covered by `rainWindow` and `rainWindowFromStore`, and by `scripts/verify-rain.ts` proving the two agree against a real database on the revised hour case
- AC-R8 covered by the axis on `forecastsAsOf` and by `forecastsVisibleAt`, on both the SQL bound and the in memory one
- AC-R8a covered by `forecastKnowableAt` and by the fixture whose two columns disagree, plus the mutation above that shows the suite catches `row[axis]`
- AC-R9 covered by `forecast/leakage.spec.ts` on the reference rule and by the four leakage cases in `scripts/verify-rain.ts` on the query, both axes on both. One caveat worth recording: **the archive half cannot be exercised by a well formed row.** With the lead matched to the horizon, a row valid inside the window was always issued inside `(T - H, T]`, so on real data the lead rule already implies the bound and the bound never binds. Both the suite and the script therefore forge a row whose `issuedAt` disagrees with its own lead, which no writer here can produce. That is deliberate: a guard only ever implied by another rule is not a guard, and it would stop holding the moment the lead rule loosened
- AC-R10 covered in part: the null on a short window is built and exercised on both the rule and the query; the forecaster skip and the tally are slice 4's, as above
- AC-R11 covered by `antecedentWetness` and its suite, including the equality against `regimeInputs`. One caveat recorded above: the function inherits a third refusal the criterion does not list
- AC-R12 covered by the client suite's pinned model assertion
- AC-R13 not built
- AC-R14 covered by the window suite's PARTIAL cases, including the clamped future window
- AC-R15 not built
- AC-R16 covered by the statement counting tests on both the read and the write path
