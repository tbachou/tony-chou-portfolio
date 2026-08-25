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
