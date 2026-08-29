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
