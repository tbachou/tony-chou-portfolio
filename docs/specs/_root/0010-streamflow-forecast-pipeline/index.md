# 0010. Streamflow forecast pipeline

**Date**: 2026-08-23
**Status**: In Progress

## Summary

A live forecasting system that predicts river flow at one gauge on Big Darby Creek 24, 48 and 72 hours ahead, and publicly scores every prediction it has ever made against what actually happened. It exists to teach: Tony is a strong TypeScript engineer with little background in machine learning or time series work, so the build order follows concepts rather than pure engineering efficiency, and the reasoning in [rationale.md](rationale.md) explains the tradeoffs rather than only recording them. The central engineering idea is that every fact is stored with two timestamps, one for when it was true and one for when we learned it, which is the only way to prove the model was never trained on information it could not have had.

## Structure

Child specs, added when the decision they settle is reached:

1. [0010-prediction-intervals.md](0010-prediction-intervals.md): how a prediction's lower and upper bounds are derived, which regime conditions them, and what happens before enough scored history exists. Settles the parts of AC-20 and AC-21 this index leaves open.
2. [0010-hindcast-seeding.md](0010-hindcast-seeding.md): what "knowable at T" means while the seeding hindcast walks an archive that was imported in one pass, and where the interval bucket's time bound moves as a result. Settles what AC-20 leaves open about reconstructing history the pipeline learned all at once.
3. [0010-falling-regime.md](0010-falling-regime.md): a fourth regime for a river on its way down, and the threshold that decides when a fall counts. Settles the gap AC-12's three class rule leaves over a recession, where persistence is biased in a way the peak and baseflow buckets both hide.
4. [0010-falling-denominator.md](0010-falling-denominator.md): revises the falling threshold's denominator from `max(v, m)` to `v` alone, after measurement showed the median floor holds recession like scores in baseflow. Supersedes only the denominator of the child above; everything else in it stands.

## Requirements

**User stories**

- As the builder, I want each build slice to teach one concept, so that I understand why the system is shaped this way rather than only how to run it.
- As the builder, I want to reconstruct exactly what was knowable at any past moment, so that my backtest measures something real.
- As a visitor, I want to see how the model has performed against a simple baseline over time, including where it lost, so that I can judge whether it works.

**Acceptance criteria**

- **AC-1**: Ingesting a USGS window writes an `Observation` only when the value **or the qualifier** differs from the most recent known row for that `validTime`. Re-running over an unchanged window writes zero rows. Comparing the value alone would silently drop the provisional to approved transition, which is the single event this project most wants to capture.
- **AC-2**: A revised USGS value for an existing `validTime` creates a new row with a later `recordedAt`. No `Observation` row is ever updated or deleted.
- **AC-3**: For any timestamp T, the store returns the observations as known at T: per `validTime`, the row with the greatest `recordedAt` that is at or before T.
- **AC-4**: Weather forecasts are stored with both `issuedAt` and `validTime`, unique on (`gaugeId`, `issuedAt`, `validTime`, `model`).
- **AC-5**: Every scheduled job writes a `PipelineRun` row with source, outcome and rows written, including runs that fail. This covers ingestion, prediction, scoring and retraining, so a silent failure of any of them is visible.
- **AC-6**: A missed scheduled run is recovered by the next run requesting the whole gap window, not only the most recent window.
- **AC-7**: Two baselines exist as `ModelVersion` rows: persistence, and day of year climatology.
- **AC-8**: Every 6 hours the system issues one prediction per active horizon (24, 48, 72 hours) for every active `ModelVersion`, baselines included.
- **AC-9**: Every `Prediction` carries a central estimate, a lower bound, an upper bound, and the nominal interval level.
- **AC-10**: Once truth is available, each prediction gets a `Score` recording the actual value used and the `recordedAt` of the exact revision it came from.
- **AC-11**: When a revision changes the truth for an already scored prediction, a new `Score` row is written rather than the old one being altered. Unique on (`predictionId`, `actualRecordedAt`).
- **AC-12**: Every `Score` is tagged with a regime of `BASEFLOW`, `RISING`, `FALLING` or `PEAK`, by the documented rule in Value sourcing. The falling class is settled in [0010-falling-regime.md](0010-falling-regime.md) and the threshold that defines it in [0010-falling-denominator.md](0010-falling-denominator.md).
- **AC-13**: Feature building reads only through the as of reconstruction. A test proves that the training set for a prediction issued at T contains no row whose `recordedAt` is after T.
- **AC-14**: The backtest evaluates by walk forward (rolling origin): for each simulated issue time it trains only on data available at that time, and never on later data.
- **AC-15**: The public dashboard shows, per horizon, model error against each baseline over time, including the periods where the model is worse.
- **AC-16**: The dashboard shows interval calibration: the share of actuals that fell inside the stated interval, compared against the nominal level.
- **AC-17**: The dashboard displays Open-Meteo attribution as CC BY 4.0 requires.
- **AC-18**: All timestamps are stored in UTC. The dashboard renders them in `America/New_York`.
- **AC-19**: On every run, a trailing rescan re-polls a rolling 90 day window, and additionally re-polls any `validTime` whose latest row is still `PROVISIONAL` however old it is. Without this the ingest window only ever sees the live edge and a revision to an older reading would never be discovered, which would defeat the point of the store.
- **AC-20**: Before the first live prediction, each baseline's error distribution is seeded by a hindcast across the backfilled history. Where fewer than 30 scored errors exist for a given model, horizon and regime, a documented wide placeholder interval is used and the prediction is marked as having an unseeded interval.
- **AC-21**: Prediction interval bounds are derived from error quantiles conditioned on regime, not pooled across all regimes.

## Decision

**Chosen option**: Option 2: a bitemporal store in a separate database, with Python for modelling and TypeScript for everything else, joined only by the database.

The pipeline ingests USGS discharge and Open-Meteo archived forecasts into an append only bitemporal store in its own Postgres instance; GitHub Actions runs ingestion, prediction and scoring on a 6 hour cron; Python reads and writes that database directly for modelling with no service boundary; and a public Next.js page shows the running scorecard against two baselines.

**Implementation skills**: `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `github-actions-templates` (`wshobson/agents`, `.claude/skills/github-actions-templates/`) · `github-actions-hardening` (`wshobson/agents`, `.claude/skills/github-actions-hardening/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Rationale

Reasoning, tradeoffs, and the concepts behind each choice: see [rationale.md](rationale.md). That file is written to be read, not skimmed; it is where the teaching lives.

## Feature design

**Data model sketch**

| Entity | Fields | Constraints |
|---|---|---|
| `Gauge` | `id` · `usgsSiteId` (req) · `name` (req) · `lat` (req) · `lon` (req) · `drainageAreaSqMi?` · `timezone` (req) · `active` (req) | unique `usgsSiteId` |
| `Observation` | `id` · `gaugeId` FK (req) · `validTime` (req) · `recordedAt` (req) · `valueCfs` (req) · `qualifier` (req, enum) · `ingestRunId` FK (req) | unique (`gaugeId`, `validTime`, `recordedAt`); index (`gaugeId`, `validTime`, `recordedAt` desc) |
| `WeatherForecast` | `id` · `gaugeId` FK (req) · `issuedAt` (req) · `validTime` (req) · `leadHours` (req) · `precipMm` (req) · `tempC?` · `model` (req) · `ingestRunId` FK (req) | unique (`gaugeId`, `issuedAt`, `validTime`, `model`); index (`gaugeId`, `validTime`) |
| `ModelVersion` | `id` · `name` (req) · `kind` (req, enum) · `trainedAt?` · `trainWindowStart?` · `trainWindowEnd?` · `hyperparams?` json · `codeSha?` · `active` (req) | unique (`name`) |
| `Prediction` | `id` · `gaugeId` FK (req) · `modelVersionId` FK (req) · `issuedAt` (req) · `targetTime` (req) · `horizonHours` (req) · `centralCfs` (req) · `lowerCfs` (req) · `upperCfs` (req) · `intervalLevel` (req) | unique (`gaugeId`, `modelVersionId`, `issuedAt`, `targetTime`); index (`targetTime`) |
| `Score` | `id` · `predictionId` FK (req) · `scoredAt` (req) · `actualCfs` (req) · `actualRecordedAt` (req) · `absError` (req) · `pctError` (req) · `withinInterval` (req) · `regime` (req, enum) | unique (`predictionId`, `actualRecordedAt`) |
| `PipelineRun` | `id` · `job` (req, enum) · `startedAt` (req) · `finishedAt?` · `status` (req, enum) · `rowsWritten` (req) · `windowStart?` · `windowEnd?` · `error?` | index (`job`, `startedAt`) |

Relationships: `Gauge` 1:N `Observation`, `WeatherForecast`, `Prediction`. `ModelVersion` 1:N `Prediction`. `Prediction` 1:N `Score` (more than one when a revision changes the truth). `PipelineRun` 1:N `Observation` and `WeatherForecast`.

Enums: `Qualifier` (PROVISIONAL, APPROVED) · `ModelKind` (BASELINE, MODEL) · `Regime` (BASEFLOW, RISING, PEAK, FALLING, the fourth added by [0010-falling-regime.md](0010-falling-regime.md)) · `PipelineJob` (USGS_INGEST, USGS_RESCAN, OPEN_METEO_INGEST, PREDICT, SCORE, RETRAIN) · `RunStatus` (OK, PARTIAL, FAILED). `PARTIAL` means the source responded but returned fewer intervals than the requested window implies, which is how a sensor outage shows up. A gap is never stored as a row; it is derived at read time from missing `validTime` slots.

**State transitions**

An `Observation` has no lifecycle; it is immutable once written, and change is expressed by writing another row. A `Prediction` moves from issued, to scored, and can be re-scored when a revision lands, each re-score adding a row rather than replacing one. A `ModelVersion` moves from active to inactive when superseded, and is never deleted, because predictions reference it.

**API surface**

All read only and public. No writes are exposed; the pipeline writes directly to the database from GitHub Actions.

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/forecast/current` | GET | `gaugeId?` | latest prediction per horizon per model, with the newest observation | public | 404 unknown gauge |
| `/api/forecast/history` | GET | `horizon`, `from?`, `to?`, `modelId?` | predictions joined to scores over the window | public | 422 bad range |
| `/api/forecast/skill` | GET | `horizon`, `window?`, `regime?` | error metrics per model, grouped by period and regime | public | 422 bad params |
| `/api/forecast/calibration` | GET | `horizon`, `window?` | observed interval coverage against nominal | public | 422 bad params |
| `/api/observations` | GET | `from`, `to`, `asOf?` | the hydrograph, optionally as known at `asOf` | public | 422 window too large |
| `/api/runs` | GET | `limit?` | recent ingest runs and their outcomes | public | none |

**Value sourcing**

| Action | Value produced / displayed | Source |
|---|---|---|
| as of reconstruction | observations as known at T | derived: per `validTime`, the row with greatest `recordedAt` at or before T. In Postgres, `DISTINCT ON (validTime) ... WHERE recordedAt <= T ORDER BY validTime, recordedAt DESC` |
| ingest | whether to write a row | derived: compare the incoming value against the latest known value for that (`gaugeId`, `validTime`); write only if different, or if none exists |
| ingest | `Observation.recordedAt` | this pipeline's own wall clock at the moment the row is written. USGS exposes no per value revision timestamp, so ingest time is the only honest source, and the whole bitemporal design rests on it |
| ingest | `PipelineRun.windowStart` | derived: the greatest `validTime` already stored for that source, minus a fixed 2 hour overlap; on an empty table, `2024-01-01`, which is where the weather archive begins |
| rescan | rescan window | constant 90 days, plus every `validTime` whose latest row is still `PROVISIONAL` at any age |
| baseline persistence | `centralCfs` | the latest `Observation` as known at `issuedAt` |
| any model | interval bounds | derived: empirical quantiles of that model's own historical errors at the same horizon **and regime**, from `Score` rows. Pooling across regimes would make storm intervals far too narrow while overall calibration still looked healthy, which is the exact failure AC-16 exists to expose |
| baseline climatology | `centralCfs` | derived: mean discharge for the target's (month, day) plus or minus 7 days, across all prior years in the store, computed through the as of reconstruction. Matching on a plus or minus window rather than an exact day avoids both leap year index drift and a sample of only one reading per calendar day per year |
| prediction | `horizonHours` | constant set `[24, 48, 72]` |
| prediction | `intervalLevel` | constant `0.80` |
| prediction | `issuedAt` | the scheduled run time, 00, 06, 12 and 18 UTC |
| model | rain features | **cumulative** precipitation over the lead window, summed from `WeatherForecast` rows whose `leadHours` matches the prediction horizon, so training and serving use forecasts of equal maturity. Cumulative rather than a single instantaneous reading, because flow responds to total water delivered to the catchment, not to the rate at one instant |
| model | quantile levels | constants `0.10`, `0.50`, `0.90`, giving the nominal 0.80 interval |
| scoring | `actualCfs` and `actualRecordedAt` | the `Observation` for `targetTime` with the greatest `recordedAt` at scoring time; both the value and which revision it came from are stored |
| scoring | `pctError` | derived: `absError / max(actualCfs, floorCfs)` where `floorCfs` is a constant equal to the 5th percentile of the gauge's historical flow, so a near zero denominator cannot produce a meaningless percentage |
| scoring | cadence and policy | runs hourly, scores any prediction whose `targetTime` has passed and for which an observation exists, using whatever revision is current, provisional included. Waiting for approval would leave the dashboard months stale |
| dashboard | default windows | constants: 90 days for skill and calibration, 30 days for history, and a hard maximum of 365 days on the observations endpoint before it returns 422 |
| scoring | `regime` | derived rule: let `m` be the median of the prior 7 days as known at `targetTime`, `d` the change over the prior 12 hours, `v` the value being classified, and `f` the gauge's frozen `flowFloorCfs`. `RISING` if `d` is at least 10 percent of `m`. `FALLING` if not rising and `d` is at most minus 10 percent of `max(v, f)`. `PEAK` if neither applies and `v` is at least 1.5 times `m`. `BASEFLOW` otherwise. The falling class is settled in [0010-falling-regime.md](0010-falling-regime.md), its denominator in [0010-falling-denominator.md](0010-falling-denominator.md) |
| dashboard | display timezone | constant `America/New_York` |
| dashboard | attribution text | constant, required by Open-Meteo's CC BY 4.0 licence |

**Key invariants**

- `Observation` is append only. Nothing in the codebase issues an update or delete against it.
- No feature used to produce a prediction issued at T may derive from a row whose `recordedAt` is after T. This is the project's central correctness property and AC-13 tests it directly.
- A `Prediction` always has `lowerCfs` at or below `centralCfs` at or below `upperCfs`.
- Baselines are stored as `ModelVersion` rows, so no scoring or display code branches on whether something is a baseline.
- Every `Score` names the revision of truth it used, so a score can always be explained.
- All stored timestamps are UTC. Day of year matching for climatology resolves the calendar day in `America/New_York`, not UTC, so a reading just after midnight Eastern is not attributed to the following day.
- The as of reconstruction always partitions by `gaugeId` as well as `validTime`. Omitting it is correct with one gauge and silently wrong with two.
- Prisma owns every schema change. The Python side reads and writes rows but never issues DDL, so there is exactly one migration history.
- At most one `MODEL` kind `ModelVersion` is active per model name. Retraining writes a new version and deactivates the one it supersedes. Differently named models may run concurrently on purpose, since comparing them is the point.

**Security model**

No authentication anywhere. Every endpoint is a public read, and the data is public domain river readings plus CC BY weather. No personal data of any kind is collected or stored, so no privacy surface exists.

The write path is the only thing needing protection: GitHub Actions holds the database connection string as a repository secret, and nothing else has write access. Because the workflow file is in a public repository, it must never echo the connection string, and it must not run on `pull_request_target` from forks. The `github-actions-hardening` skill governs this.

**Configuration required**

- `PIPELINE_DATABASE_URL`: connection string for this project's own Postgres instance, held as a GitHub Actions secret and separately in the Vercel project for the read path.

Neither data source needs a key. USGS is open and Open-Meteo is keyless on the free non commercial tier, which is one fewer secret to manage and one fewer thing to break.

**Critical test scenarios**

- Happy path: a scheduled run ingests a window, issues six predictions (three horizons, two baselines), and a later run scores the ones whose target time has passed, verifies **AC-1**, **AC-8**, **AC-10**.
- Correctness: given a fixture where a value is revised, the as of query returns the old value for a timestamp before the revision and the new value after it, verifies **AC-2**, **AC-3**.
- Correctness: re-running ingestion over an unchanged window writes zero new rows, verifies **AC-1**.
- Leakage: building features for an issue time T against a fixture containing rows recorded after T produces a feature set that excludes them, verifies **AC-13**.
- Revision: scoring a prediction, then revising the underlying truth and re-scoring, yields two `Score` rows rather than a mutated one, verifies **AC-11**.
- Recovery: with a 30 hour gap since the last run, the next run requests the full gap rather than the last 6 hours, verifies **AC-6**.

## Build plan

Build approach is Tracer Bullet, assumed rather than recorded, as in 0002, 0004 and 0009. Ordering is deliberately bent for teaching: each slice is a working end to end thread, and each one earns a concept that the next slice depends on. Notably, slice 2 delivers a complete live forecasting system with a public scorecard and **no machine learning at all**. That is the point. If the plumbing cannot be trusted, no model built on it can be either, and you will have learned what a baseline is by shipping one rather than by reading about it.

**Slice 1, the two time axes.** Concept: why one timestamp is not enough.

1. Create the workspace and its own Postgres instance. Prisma schema for `Gauge`, `Observation`, `PipelineRun` and their enums, migration generated not hand written. Satisfies **AC-2**.
2. USGS ingestion for site `03230500`, writing only when value or qualifier changes, recording every attempt as a `PipelineRun`. Satisfies **AC-1**, **AC-5**.
3. The as of reconstruction as a tested function, with a fixture containing a revision. Satisfies **AC-3**.
4. A minimal hydrograph page rendering the last 30 days, with an `asOf` control that lets you watch a revision appear and disappear. Satisfies **AC-3**, **AC-18**. This is also where you confirm empirically that Big Darby is unregulated: look for smooth rises and long curved recessions rather than flat plateaus and square steps.

**Slice 2, a forecaster with no model.** Concept: a baseline is a competitor, not a footnote; scoring is a loop, not an afterthought.

5. Add `ModelVersion`, `Prediction` and `Score` tables. Satisfies **AC-9**, **AC-11**.
6. Persistence and climatology baselines as `ModelVersion` rows, with intervals from their own historical error quantiles. Satisfies **AC-7**.
7. GitHub Actions cron at 00, 06, 12 and 18 UTC issuing predictions at all three horizons for both baselines. Satisfies **AC-8**.
8. Scoring job with regime tagging, writing a new `Score` per revision rather than mutating. Satisfies **AC-10**, **AC-11**, **AC-12**.
9. Gap recovery in the ingest window calculation, plus the trailing rescan that re-polls 90 days and every still provisional reading. Satisfies **AC-6**, **AC-19**.
9b. Hindcast seeding of baseline error distributions across the backfilled history, so intervals exist on day one. Satisfies **AC-20**, **AC-21**.
10. Public dashboard version one: the hydrograph, current forecasts, and error over time for both baselines. Satisfies **AC-15**.

**Slice 3, rain arrives.** Concept: exogenous inputs, and why you must train on forecasts rather than on what actually fell.

11. `WeatherForecast` table and Open-Meteo Previous Runs ingestion, backfilled from January 2024, storing `leadHours` explicitly. Satisfies **AC-4**.
12. Attribution on the dashboard. Satisfies **AC-17**.

**Slice 4, the first real model.** Concept: leakage, and what a backtest can and cannot prove.

13. Python workspace reading the same Postgres directly, no service boundary.
14. Feature builder that goes through the as of reconstruction only, with the leakage test as its first test. Satisfies **AC-13**.
15. Walk forward backtest harness over the backfilled window. Satisfies **AC-14**.
16. First model: gradient boosted trees on lagged flow plus lead matched rain features, with three quantile models producing the interval. Registered as a `ModelVersion`, competing in the same tables as the baselines. Satisfies **AC-9**.

**Slice 5, honesty surfaces.** Concept: an average hides everything that matters.

17. Interval calibration view: nominal 80 percent against observed coverage. Satisfies **AC-16**.
18. Skill split by regime, so baseflow performance cannot flatter storm performance. Satisfies **AC-15**.

**Slice 6, keeping it alive.** Concept: a pipeline is a thing that runs, not a thing that ran.

19. Weekly retraining as a scheduled workflow, writing a new `ModelVersion` and deactivating the version it supersedes. Satisfies **AC-21**.
20. `PipelineRun` coverage extended to the prediction, scoring and retraining jobs, and run history surfaced on the dashboard so a silent failure of any job becomes visible. Satisfies **AC-5**, **AC-21**.

## Consequences

**Positive**

- The correctness property that matters most, no training on unknowable data, is enforced by the storage design and proved by a test, rather than being a thing you tried to remember.
- A live public scorecard including losses is rare, and it is the part of the project that cannot be faked or produced in an afternoon.
- Slice 2 produces something worth showing before any machine learning exists, so the project has value early and does not depend on the model being good.
- Two data sources, no API keys, no paid tiers, and no personal data. Very little can go wrong operationally.

**Negative and tradeoffs**

- Append only storage grows without bound and every read pays for the as of logic. At this volume, hundreds of thousands of rows, that is free. It would not be at ten million.
- Two languages in one repository means two toolchains, two dependency sets, and a CI job that has to set up both.
- The weather forecast archive begins in January 2024, so the honest training window is about two and a half years, not the nineteen the river data offers. The older river history is useful for seasonality and for exercising the store, not for training.
- One gauge on one creek is a small claim. The schema supports more, but nothing here proves the approach generalises.
- The model may simply not beat persistence at 24 hours. That is a real possible outcome, and the design deliberately makes it visible rather than hideable.

**Neutral**

- The database is separate from the portfolio's, so this project's migrations and load cannot affect the live site, at the cost of a second connection string and a second thing to provision.
- GitHub Actions is not a real scheduler. Runs can be delayed under load, and scheduled workflows are disabled automatically after 60 days of repository inactivity. Gap recovery in AC-6 makes both survivable.

## Follow-up

- [ ] Confirm no significant impoundment upstream of gauge `03230500`. The National Scenic River designation makes this very likely, and slice 1's hydrograph will show it empirically, but it has not been traced.
- [ ] Root `AGENTS.md` describes `packages/shared` as hand written types, which `origin/main` has already superseded with one zod schema per HTTP contract. Worth correcting before this project adds contracts of its own.
- [ ] This worktree is 10 commits behind `origin/main`, which now carries Next 16 and the react-hook-form plus zod migration. Pull before building.
- [ ] No build approach is recorded for the project, so Tracer Bullet has now been assumed five times. Worth setting explicitly.
- [ ] Decide whether a second gauge, ideally one below a dam, gets added later as a deliberate contrast. It would demonstrate that the model fails where physics is replaced by an operator's decision, which is a strong thing to be able to show.
