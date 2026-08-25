# Verify: hindcast seeding over a bulk imported archive · spec 0010 · updated 2026-08-24

_Steps derived from the acceptance criteria in [0010-hindcast-seeding.md](0010-hindcast-seeding.md). `/check verify` runs these; `/test` locks the durable ones._

## Commands

- [ ] `npm test --workspace=apps/streamflow` → all green, including `as-of.spec.ts`, `observations.repository.spec.ts`, `score.repository.spec.ts`, `bucket.spec.ts`, `bucket.repository.spec.ts`, `hindcast.spec.ts` → AC-H1, AC-H3, AC-H5, AC-H6, AC-H9
- [ ] `npx tsc --noEmit -p apps/streamflow/tsconfig.json` and the same for `apps/web` → clean
- [ ] Against a throwaway local Postgres with the migrations applied: `PIPELINE_DATABASE_URL=postgres://...@localhost:PORT/postgres?sslmode=disable npx tsx apps/streamflow/scripts/verify-bucket.ts` → all 6 cases agree across query, rule, fixture and both axes → AC-H4
- [ ] Against the live store, read only: `npx tsx apps/streamflow/scripts/verify-as-of.ts` → both axes report identical rows at every probe instant → AC-H1, AC-H3
- [ ] `grep -rn "'validTime'" apps/streamflow/src --include=*.ts | grep -v spec` → the only caller passing the loose axis is `forecast/hindcast.ts` → AC-H2

## Value sourcing checks

One per row of the spec's Value sourcing table, each exercising the edge that breaks if the source is wrong.

- [ ] Which axis bounds a read: call `observationsAsOf` and `scorablePredictions` with no axis, then with `'recordedAt'` → identical SQL text and identical parameters both times → AC-H1, AC-H6
- [ ] Hindcast history at slot `T`: over a fixture where every row shares one `recordedAt` far in the future, `asOfWalk(rows, 'validTime')` returns rows at every slot while `asOfWalk(rows)` returns none until that instant → AC-H3
- [ ] Live history at instant `T`: a reading revised after `T` stays invisible on the default axis → AC-H6
- [ ] Hindcast scoring: on the `validTime` axis a prediction whose target has passed is scorable even though every reading was recorded long after that target; where a target has two revisions the greater `recordedAt` wins → AC-H9
- [ ] Live scoring: with no axis passed, the lateral join still carries `o."recordedAt" <= $1` → AC-H6
- [ ] Which past errors enter a bucket: a bucket built for a prediction issued at `T` holds no error whose contributing prediction's `targetTime` is after `T`, and both axes return the same ratios → AC-H4, AC-H5
- [ ] The dashboard disclosure: constant text, checked in the UI step below → AC-H7

## Seeding run, against a throwaway before the live one

- [ ] Seed a throwaway store shaped like the live one, every reading sharing a single `recordedAt`, then run the hindcast over a window inside it → predictions land at every slot, not only the last handful, and scores land at every slot once the first targets pass. Reference run: 237 slots produced 1,422 predictions and 1,368 scores, of which 1,068 carried a measured interval rather than the placeholder → the failure this decision exists to fix
- [ ] On the same store, `publicPredictions` returns zero of the seeded rows → AC-H8
- [ ] Before any future re run against the live store, re measure the zero revision property: `SELECT COUNT(*) FROM (SELECT "validTime" FROM observations GROUP BY "gaugeId", "validTime" HAVING COUNT(*) > 1) t` → still 0, otherwise the loose axis is no longer equivalent and the decision needs revisiting

## UI / manual

- [ ] Visit `/streamflow` with at least one current forecast in the store → the seeding disclosure paragraph appears beside the forecasts table, in the muted terminal style, saying the ranges came from a backtest over readings USGS had already reviewed and may run slightly narrow → AC-H7
- [ ] Reload after the buckets are well past seeding → the paragraph is still there, it is not gated on anything about the seeding being in progress → AC-H7

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
