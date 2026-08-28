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
- [ ] Deploy the enum migration alone and confirm `FALLING` exists in the production `Regime` type before any code that can write it ships → AC-F1
- [ ] Set the GitHub repository variable `STREAMFLOW_FORECASTING` to `false`, then confirm `.github/workflows/streamflow-score.yml` skips and `streamflow-pipeline.yml` still ingests and rescans → AC-F11
- [ ] Against production, forecasting off: `npx tsx apps/streamflow/scripts/backfill-regime.ts` → record the four bucket counts and the full transition matrix, per model and horizon, in `0010-falling-regime.md` beside the parent's 2,731 / 518 / 291 line → AC-F6
- [ ] Only once those numbers are in the file: `npx tsx apps/streamflow/scripts/backfill-regime.ts --write` → no forbidden cell, no row in or out of the null set, `live scores bound at scoredAt` is 0 → AC-F5, AC-F7, AC-F8, AC-F9
- [ ] Keep `apps/streamflow/.regime-backfill/pre-migration-labels.json` until the write run has finished cleanly. It is what a resumed run compares against, not a cache → AC-F9
- [ ] Set `STREAMFLOW_FORECASTING` back to `true`, then check the next issued slot: all three horizons present, each either regime conditioned or with `intervalSeeded` false → AC-F11, AC-F12
- [ ] Visit `/projects/streamflow` → the intervals paragraph names baseflow, rising, falling and at a peak → AC-F14

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
- [ ] The class names in the case study copy: the rendered page names four classes → AC-F14

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
