# apps/streamflow — river forecast pipeline

## Overview

A live forecasting system for one USGS gauge on Big Darby Creek (site `03230500`). It ingests river readings and archived weather forecasts into an append only store where every fact carries two timestamps, issues predictions at 24, 48 and 72 hours from two baselines on a six hourly cron, and scores each one against what actually happened.

There is deliberately no machine learning here yet. Slices 1, 2, 3 and 5 of [spec 0010](../../docs/specs/_root/0010-streamflow-forecast-pipeline/index.md) have shipped; the first real model is slice 4 and does not exist. A baseline is a competitor in these tables, not a placeholder, and nothing downstream branches on whether a forecaster is a baseline or a model.

The two timestamps are the point of the whole workspace. `validTime` is when a fact was true at the river; `recordedAt` is when this pipeline learned it. Keeping them apart is what proves a forecast was never built on information it could not have had.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public surface. `apps/web` imports only from here. |
| `src/config.ts` | Every tuned constant, each with the reason it holds that value. Read before changing any number. |
| `src/types.ts` | `StoredObservation`, `KnowabilityAxis`, and why `gaugeId` is part of the type. |
| `src/db.ts` | The one Prisma client. Reads `PIPELINE_DATABASE_URL` and fails loudly when it is absent. |
| `src/asof/observations.repository.ts` | The as of reconstruction: what was knowable at an instant, on either time axis. |
| `src/forecast/predict.ts` | Issues one prediction per active forecaster per horizon. |
| `src/forecast/score.ts` | Grades a prediction once truth arrives, writing a new row per revision. |
| `src/forecast/staleness.ts` | Whether a reading or a forecast is too old to present as current. |
| `src/ingest/write.ts` | Batched writes, resumable on purpose and deliberately not atomic. |
| `src/usgs/client.ts` | The USGS fetch, and the timezone workaround its comment justifies. |
| `src/append-only.spec.ts` | Scans the workspace source for forbidden Prisma calls. Not a mocked test. |
| `prisma/schema.prisma` | Seven models. `Observation` and `WeatherForecast` are append only. |

## Commands

Run everything with Node 22 or newer. Every script below is a workspace script, so run it as `npm run <name> --workspace=@portfolio/streamflow` from the repo root, or plainly from this directory.

```bash
npm test --workspace=@portfolio/streamflow    # jest, fully mocked, no database and no network
npm run build --workspace=@portfolio/streamflow  # tsc to dist/, which apps/web imports at runtime
npx tsc --noEmit -p apps/streamflow/tsconfig.json # typecheck only
```

These reach the real world. None of them belongs in a test or a check:

| Command | Network | Database |
|---|---|---|
| `npm run ingest` | USGS | writes |
| `npm run rescan` | USGS | writes |
| `npm run ingest:weather` | Open-Meteo | writes |
| `npm run predict` | none | writes |
| `npm run score` | none | writes |
| `npm run hindcast` | none | writes |
| `npm run migrate:deploy` | none | changes schema |

## Conventions

- **Every exported function names the acceptance criterion it satisfies.** A comment reading `AC-3` or `AC-R7` points at [spec 0010](../../docs/specs/_root/0010-streamflow-forecast-pipeline/index.md) or one of its six child specs, where the governing rule is written out. Search the spec for the number before changing the behaviour.
- **The store is append only, and a test enforces it.** `src/append-only.spec.ts` walks every source file in the workspace, `scripts/` included, and fails on any call to `update`, `updateMany`, `delete`, `deleteMany` or `upsert` against `Observation` or `WeatherForecast`. `upsert` is forbidden as firmly as the rest: it is how an append only table quietly acquires an update. A fixture that wants to be re runnable uses `createMany` with `skipDuplicates`.
- **All input and output is injected, including the clock.** Fetchers and `now` arrive as parameters with real defaults, so tests replace them rather than mocking modules. Follow the existing shape instead of reaching for a module mock.
- **A constant is never a bare literal.** Values in `src/config.ts` carry the measurement or the reasoning that produced them, and several are derived from each other so a change moves everything that depends on it. `STALE_AFTER_HOURS` is `ISSUE_INTERVAL_HOURS * 1.5` for exactly that reason.
- **Which time axis a read used travels with the data.** `KnowabilityAxis` defaults to the strict `recordedAt` walk. The seeding hindcast passes the looser `validTime` walk, because the backfilled archive arrived in one pass and a `recordedAt` walk over it returns nothing. Whichever axis a caller reconstructed on is carried through so a whole slot reads on one axis.
- **Tests are colocated `.spec.ts`, fully mocked, and run on jest.** This workspace is jest; `apps/web` is vitest. Do not copy a test idiom across that boundary.

## Gotchas

- **`apps/web` imports the build output, not the source, but takes its types from source.** `package.json` sets `main` to `dist/index.js` and `types` to `src/index.ts`. So after editing anything here, a web typecheck passes while web's runtime and tests still see the previous build. Run `npm run build --workspace=@portfolio/streamflow` after every source change. `dist/` is git ignored and is produced by the repo root `postinstall`, so a fresh clone is fine and an edited working tree is not.
- **The connection string is `PIPELINE_DATABASE_URL`, not `DATABASE_URL`.** This pipeline has its own Postgres, separate from the portfolio API's. Use the plain `postgres://` form rather than `prisma+postgres://`, because the runtime connects through `@prisma/adapter-pg`. `.env.example` explains why `sslmode` is spelled `verify-full` rather than `require`, and the difference is not cosmetic.
- **USGS timestamps are sent as bare local time, with no timezone marker.** This looks wrong and is not. USGS converts any `startDT` or `endDT` carrying a designator using the site's *current* daylight saving offset rather than the one in force on the requested date, so a winter request from a summer machine returns readings an hour off. `src/usgs/client.ts` records the three way test against the live service that established this. The store still holds nothing but UTC; the conversion exists only at that boundary.
- **Never use the Open-Meteo model `best_match`.** It is a selector, not a model, and which model backs it can change over time, so rows from different years could come from different physics under one label. `OPEN_METEO_MODEL` is `gfs_seamless`, stored literally on every row.
- **`Gauge.flowFloorCfs` is frozen after the first scoring run derives it.** A floor that drifted as the record grew would give two scores of the same prediction different answers. Correct it by hand if that first run ever saw an unrepresentative store.
- **The two workflows share one concurrency group and both apply migrations.** They are queued, never parallel, because an `ALTER TABLE` waiting on a lock the pipeline's open write transaction holds would queue an exclusive lock behind it. The migration lock is capped at ten seconds, so a contending run does not wait politely, it exits with `P1002`.
- **Error text is sanitised before it is stored.** Run history is public on the dashboard, and the connection string is the one secret this pipeline holds.
- **`BACKFILL_START` is not where the Open-Meteo archive begins.** The forecast walk requests months before the archive starts, they come back short, and that is expected and recorded as `PARTIAL` rather than treated as a fault.

## Agent skills

Installed globally, not committed here (spec 0014); `skills-lock.json` at the repo root is the list.

- `javascript-typescript-jest`: `github/awesome-copilot`, the test idiom this workspace uses
- `prisma-database-setup` and `prisma-postgres`: `prisma/skills`, schema and Prisma Postgres work
- `github-actions-templates`: `wshobson/agents`, the two cron workflows that drive this pipeline
- `github-actions-hardening`: vendored by exception in `.claude/skills/`, since upstream no longer publishes it

## Related specs

[0010 streamflow forecast pipeline](../../docs/specs/_root/0010-streamflow-forecast-pipeline/index.md), plus its six child specs covering prediction intervals, hindcast seeding, the falling regime and its denominator, rain as it was forecast, and staleness disclosure. The umbrella's `verify.md` records how each slice was checked.

Workflows: `.github/workflows/streamflow-pipeline.yml` (ingest, rescan, weather, predict at 00, 06, 12 and 18 UTC) and `.github/workflows/streamflow-score.yml` (scoring, hourly at :30). Both are gated on the `STREAMFLOW_FORECASTING` flag.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
