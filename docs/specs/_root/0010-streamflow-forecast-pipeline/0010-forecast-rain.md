# 0010 child: Rain, as it was forecast

## Summary

The model needs to know whether rain was expected, and it must learn that from what was *predicted* at the time rather than from what actually fell. This child adds a `WeatherForecast` table fed from Open-Meteo's Previous Runs archive, backfilled to the archive's real beginning in January 2024, and the one feature the first model will read from it: cumulative forecast rainfall over the lead window, at a lead that matches the prediction horizon. The whole design turns on refusing rainfall that arrived with too short a lead, because that kind of rain is knowledge from the future wearing a forecast's clothes.

## Context

The calibration panel splits interval coverage by what the river was doing, and one group is much worse than the rest. Measured 2026-08-29 against the live store, over 17,565 graded hindcast rows, conditioned intervals only, against a nominal 80 percent:

| persistence, by river state | coverage | rows |
|---|---|---|
| rising | **52.6%** | 1,474 |
| falling | 65.7% | 2,388 |
| peak | 67.4% | 242 |
| baseflow | 95.2% | 6,092 |

Climatology on a rising river reads 58.4 percent. Rising is the worst state by thirteen points and the second largest bucket, and it is the state where water is arriving. Nothing in the pipeline currently knows that water is arriving. Both forecasters see only the river's own past, so a storm is invisible to them until it is already in the channel, which is precisely why the rising bucket is where they fail.

The live record says nothing useful about this yet. It holds 60 graded rows, all issued since 2026-08-25, all inside the recession from the 7,470 cubic feet per second flood of 2026-08-20, and it contains no rising rows at all. Its 6.7 percent coverage is one hard event at small sample, not a verdict.

The forcing constraint is stated in the parent's rationale and is worth restating because everything here follows from it. Rain must enter the system as a forecast. Train on what fell and the model is handed perfect weather foresight it will never have in production; the backtest looks excellent, the live system disappoints, and nothing explains why. Leakage arrives disguised as success, which is what makes it dangerous.

What was not previously understood is that there are **two** ways to get this wrong, and the second one looks correct.

| source | what it returns | verdict |
|---|---|---|
| `archive-api` (ERA5) | reanalysis of what actually fell | the obvious trap |
| `historical-forecast-api` | archived forecasts, stitched from the first few hours of each run | **the subtle trap**: genuinely forecast data, at a lead near zero |
| `previous-runs-api` | fixed lead series, `_previous_dayN` | correct |

The Historical Forecast API passes any check that asks "is this a forecast". It fails the only check that matters, which is "forecast at what lead". Open-Meteo's own description is explicit that each run's first few hours are stitched into a continuous series, which is what makes it nearly as accurate as measurement. That accuracy is the problem.

There is a third hazard inside the correct endpoint. Requesting `precipitation_previous_day0` returns a column named plain `precipitation`, with no lead suffix and no documented lead. A request that casually includes `precipitation` therefore receives a near zero lead value sitting beside the honest ones, under a name that raises no suspicion.

The size of the gap between forecast and outcome is the argument for all of this. Daily total precipitation in millimetres at the gauge, around the flood:

| day | 24 h lead | 48 h lead | 72 h lead | ERA5 observed |
|---|---|---|---|---|
| 2026-08-17 | 25.9 | 6.9 | 1.3 | 9.2 |
| 2026-08-18 | 0.0 | 0.0 | 0.0 | 4.2 |
| 2026-08-19 | 0.0 | 0.0 | 0.4 | 2.9 |
| 2026-08-20 | 10.8 | **1.5** | 12.8 | **16.7** |
| 2026-08-21 | 0.0 | 1.6 | 0.0 | 0.6 |
| 2026-08-22 | 30.6 | 10.8 | 3.0 | 8.5 |
| **event total** | 67.3 | 20.8 | 17.5 | 42.1 |

On the day the flood crested, the 48 hour forecast called 1.5 millimetres against 16.7 observed, a 91 percent under forecast. Event totals sit between 51 percent below and 60 percent above the truth. A model trained on the last column learns that 16.7 millimetres produces a flood, and is then handed 1.5 at serving time.

Finally, the archive does not begin where the parent spec says it does. Measured at the gauge, nothing is returned before 2024-01-18, the 24 hour lead populates from 2024-01-20, and the 72 hour lead only from 2024-01-22. The boundary is staggered per lead, because a lead of N days needs N days of prior runs behind it. `config.ts` currently pins `BACKFILL_START` to 2024-01-01 and states in a comment that this is where the weather archive begins, which is false by about three weeks and false differently for each horizon.

## Requirements

**User stories**

- As the builder, I want the model to see rain the way it will see it in production, so that the backtest is measuring something that can actually be reproduced live.
- As the builder, I want a source of rainfall I cannot accidentally point at observations, so that the most dangerous mistake in this project is structurally hard to make rather than merely documented.
- As the builder, I want a missing forecast to be visible, so that an absent input never enters the model as a confident zero.
- As a visitor, I want to see the weather data credited as its licence requires.

**Acceptance criteria**

- **AC-R1**: Weather ingest requests only the Previous Runs host, pinned as a constant, and parses only columns carrying an explicit `_previous_dayN` suffix. A `precipitation` column with no suffix is discarded without being read. A test proves a response containing both is stored from the suffixed columns alone.
- **AC-R2**: Every `WeatherForecast` row has `leadHours` of at least 24, enforced by a database check constraint as well as by the parser. The constraint's migration is created with `prisma migrate dev --create-only` and then applied by `prisma migrate dev`, so the SQL executes before it ships.
- **AC-R3**: `WeatherForecast` is append only. Nothing updates or deletes a row. A re-fetch whose `precipMm` and `tempC` both match the most recent known row for that (`gaugeId`, `validTime`, `leadHours`, `model`) writes nothing; a differing value writes a new row with a later `recordedAt`. A parsed `tempC` of `undefined` and a stored `tempC` of `null` count as equal, so a missing optional field cannot masquerade as a change and write a row on every run. The comparison needs a latest known read keyed on all four columns, which `forecastsAsOf` provides; the existing `selectChangedReadings` keys on `validTime` alone and cannot be reused unchanged.
- **AC-R4**: `leadHours` is canonical and `issuedAt` is stored as the derived value `validTime` minus `leadHours`. Uniqueness is on (`gaugeId`, `validTime`, `leadHours`, `model`, `recordedAt`). This amends the parent's **AC-4**, which names `issuedAt` in the key and carries no `recordedAt`.
- **AC-R5**: The backfill runs one request per calendar month per lead, each recording a `PipelineRun` with `job` of `OPEN_METEO_INGEST`, its `windowStart` and `windowEnd`, and the `leadHours` the chunk covered. Those columns are the resume key: a chunk is the pair (`windowStart`, `leadHours`), and a resumed run skips a chunk whose run is recorded `OK`. `leadHours` is what makes the key work, because one month at lead 24 and the same month at lead 48 are otherwise identical rows in job, window and status, so without it the skip has nothing to tell them apart. The column is nullable and holds null on every other job, and a run of this job that reaches the store without one covers no chunk rather than covering all of them. `PARTIAL` does not count as finished, because the archive ramps in at its start and a later re-run may find the service has since filled the gap. Re-running a completed month writes zero rows. How those rows reach the database is set by **AC-R16**, which is a separate concern from how they are fetched.
- **AC-R6**: The first usable date per lead is derived from the store, as the least `validTime` held for that (`gaugeId`, `leadHours`, `model`), never from a constant. No date literal for the weather archive appears in the codebase.
- **AC-R7**: The rain feature for a prediction issued at `T` for horizon `H` is the sum of `precipMm` over the window after `T` up to and including `T` plus `H`, taking **one row per `validTime`**: rows whose `leadHours` equals `H`, reduced to the single visible row with the greatest `recordedAt` for each hour, then summed. The reduction is not optional. The table is append only, so a revised hour holds more than one row for the same (`gaugeId`, `validTime`, `leadHours`, `model`), and summing the filtered rows without reducing first double counts every hour that was ever revised. This is the same rule `observationsAsOf` already applies to `Observation`, expressed on the weather key.
- **AC-R8**: The weather read takes the same `KnowabilityAxis` parameter the other three reads take, defaulting to `recordedAt`. On the `recordedAt` axis a row is visible when its `recordedAt` is at or before `T`. On the `validTime` axis, which the hindcast alone passes, a row is visible when its **`issuedAt`** is at or before `T`. Visibility and reduction are two separate steps: the axis decides which rows may be seen, **AC-R7**'s reduction then picks one per hour from among them.
- **AC-R8a**: The weather read must not reach its axis column by a generic `row[axis]` lookup. The axis names the knowability mode, and for weather the archive mode column is `issuedAt`, not the `validTime` the string spells. The mapping is written out by hand, `axis === 'validTime' ? row.issuedAt : row.recordedAt`, and a test fixture in which the two columns would give different answers proves the right one was used. `reconstructAsOf` indexes `row[axis]` directly and is the pattern a builder would copy, which is exactly why this is stated rather than left to care.
- **AC-R9**: A test proves that the rain feature for a prediction issued at `T` draws on no row whose `recordedAt` is after `T` on the live axis, and none whose `issuedAt` is after `T` on the archive axis. This extends the parent's **AC-13** to weather rows.
- **AC-R10**: The lead window for horizon `H` holds exactly `H` hourly slots, since the window is `H` hours long and the archive is hourly. If the reduction in **AC-R7** yields fewer than `H` rows, the rain feature is null rather than zero. A forecaster that requires it is skipped for that horizon, the skip is counted in the existing skipped tally, and the run's status reflects it. No prediction is ever issued on a partially present rain window. The count is of reduced rows, not raw rows, so a revised hour cannot pad a short window up to the required length.
- **AC-R11**: The antecedent wetness feature is the median discharge over the prior seven days, read at `issuedAt` from the `Observation` store through the as of reconstruction on the slot's axis. It is the same quantity `regimeInputs` already derives as `m`, and reuses that function rather than restating the window. Where `regimeInputs` refuses, which it does below `MIN_LOOKBACK_READINGS` of 224 prior readings or on a non positive median, the wetness feature is null and **AC-R10**'s skip applies. No rainfall observation source is introduced.
- **AC-R12**: `model` stores the pinned model name literally. `best_match` is never requested, and a test proves the request URL names the pinned model.
- **AC-R13**: Live weather ingest is its own `OPEN_METEO_INGEST` run at 00, 06, 12 and 18 UTC, ordered ahead of the prediction job, computing its window from what is stored rather than from the schedule so a missed run recovers the whole gap, as the parent's **AC-6** requires of USGS ingest.
- **AC-R14**: A response returning fewer non null hours than its window implies records `PARTIAL`, not `OK`. The ramp in at the start of the archive is expected to produce exactly this and is not a failure.
- **AC-R15**: The dashboard carries Open-Meteo attribution as CC BY 4.0 requires. Satisfies the parent's **AC-17**.
- **AC-R16**: A month chunk costs a bounded number of database round trips, never one per row, in both directions. The rows already held for that (month, lead) are read in **one** query, the **AC-R3** comparison happens in memory against that set, and the rows that survive it are written with a batched insert in chunks of at most 1,000. Nothing iterates hourly values issuing a query each. A test proves that ingesting a month of 720 hours issues a number of statements in the low tens, not in the hundreds.

  The reason is cost, not elegance, and it is worth stating plainly because the naive version works fine and quietly spends the budget. The hosted database bills by operation and the free tier allows 200,000 a month. Writing the backfill's roughly 70,000 rows one at a time would spend about a third of a month's allowance in a single run, and reading hour by hour to diff them would spend as much again. Batched, the whole archive costs on the order of hundreds. The 1,000 row chunk is bounded by Postgres's limit of 65,535 parameters per statement: at ten columns a chunk of 1,000 binds 10,000, leaving ample headroom if a column is added later.

## Options considered

### Option 1: fixed lead series from Previous Runs, one pinned model (chosen)

Request `precipitation_previous_day1`, `_day2` and `_day3` plus their temperature counterparts from `previous-runs-api`, pinned to `gfs_seamless`. One row per (`validTime`, `leadHours`). `issuedAt` is derived.

**Pros**

- The leads returned are exactly 24, 48 and 72 hours, which are exactly the prediction horizons. The parent's equal maturity rule falls out of the storage shape rather than resting on a query getting it right.
- The zero lead trap is refusable at parse time, because the honest columns are the ones carrying a suffix.
- One request covers every lead for a month, so the whole backfill costs roughly seventy weighted calls against a limit of ten thousand a day.

**Cons**

- `issuedAt` is nominal rather than the true model run initialisation time, which this endpoint does not report. A row says it was forecast 24 hours earlier, and the run it actually came from may have initialised a few hours either side.
- Pinning one model gives up whatever accuracy `best_match` would have added.
- Lead is capped at seven days, so a horizon beyond that could not be served this way.

### Option 2: per run archive, storing whole model runs

Store each model run as issued, with its true initialisation time, and derive `leadHours` as the difference from `validTime`.

**Pros**

- The most faithful description of what a forecast actually is, and `issuedAt` would be a real observed timestamp rather than a derivation.
- Richer for later work: forecast evolution across successive runs becomes visible, which is a genuine uncertainty signal.

**Cons**

- Requires the Single Runs API and one request per run, which is a far larger backfill than one request per month per lead.
- Lead matching becomes a query concern rather than a storage guarantee, so the rule that keeps training and serving honest moves into code that can drift.
- Many more rows for a benefit no acceptance criterion currently needs.

### Option 3: Historical Forecast API

Use the stitched archived forecast series, which is simpler to request and needs no lead suffix handling.

**Pros**

- One variable name, no per lead requests, and a longer archive reaching back to 2022.
- Genuinely archived forecast data rather than reanalysis, so it is not the obvious mistake.

**Cons**

- It stitches the first hours of each run, so its effective lead is near zero. Training on it leaks almost as badly as training on observations while looking correct, which makes it worse than the obvious mistake rather than better.
- It cannot answer the question the model needs answered, which is what was expected 48 hours ahead.

## Decision

**Chosen option**: Option 1, fixed lead series from Previous Runs, pinned to one named model, with the zero lead column refused at three layers.

`WeatherForecast` gains a third timestamp so it obeys the same append only rule as `Observation`. The rain feature is cumulative forecast precipitation across the lead window at a lead equal to the horizon, paired with trailing discharge as the catchment wetness signal. A missing hour makes the feature null and skips the forecaster rather than reading as no rain.

**Implementation skills**: `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`) · `github-actions-templates` (`wshobson/agents`, `.claude/skills/github-actions-templates/`) · `github-actions-hardening` (`wshobson/agents`, `.claude/skills/github-actions-hardening/`)

## Rationale

**What "equal maturity" does and does not claim.** Each hour in a lead window carries its own `issuedAt`, namely its `validTime` minus `H`, so the hours were not all forecast at one instant. The first hour of a 24 hour window was forecast about 23 hours before the issue time and the last was forecast at it. The claim is not that a window is one snapshot. It is that every hour is matched to a forecast of the same age **relative to that hour**, in training and in serving alike, which is the property that stops a backtest measuring a system that cannot exist. Stated because the shorter phrase reads as the stronger claim.

**Whether the freshest hour is actually available in time.** The last hour of a live window needs a nominal issue time of now, which raised a real worry that the feature would be null on every live prediction while the backtest looked complete: availability producing the same disappointment leakage would, from the opposite direction. Measured 2026-08-30 against the live endpoint rather than reasoned about. All three leads return populated values for target times up to 120 hours ahead, so the window is not starved. The mechanism is that Open-Meteo serves the nearest available run under the nominal lead label rather than returning null, which is also why `issuedAt` is nominal. The direction of the resulting error is safe: for a target `H` hours out the shortest achievable lead is `H` itself, so a live feature can be staler than its training counterpart but never fresher, and a leak cannot enter this way.

**Why the storage shape carries the rule rather than the query.** The parent already states the equal maturity rule in its Value sourcing table: sum rows whose `leadHours` matches the prediction horizon. Option 2 would store runs and reconstruct that at read time, which is one more place the rule can be stated differently from how it is meant. Storing the fixed lead series means a row's lead is what was asked for, so a feature builder that filters on `leadHours` cannot accidentally assemble a set of mixed maturity. This workspace already treats a second statement of the same rule as the thing most likely to drift, which is why the hindcast child chose one parameter over two query families. The same instinct applies here.

**Why the guard is three layers rather than one.** The realistic mistake is not pointing at ERA5, which is documented and obvious. It is receiving the unsuffixed `precipitation` column, which arrives whether or not it was wanted, has no documented lead, and reads like the variable anyone would expect. Refusing it at the parser is the layer that actually catches the mistake. Pinning the host catches a wholesale change of endpoint. The check constraint catches a hand written insert months from now by someone who has forgotten why any of this matters, which is exactly when it will happen. None of the three is redundant because each catches a different mistake at a different time.

**Why `--create-only` rather than dropping the constraint.** The standing rule against hand written migrations exists because hand written DDL ships having never executed, and a subtle mismatch then surfaces later as drift. `--create-only` followed by `migrate dev` still applies the SQL before it ships, so the reason behind the rule is satisfied even though the letter of it bends. The alternative, enforcing the lead in application code alone, leaves the store itself open to precisely the insert the constraint exists to stop.

**Why a pinned model rather than `best_match`.** `best_match` is a selector, not a model. Which model backs it can change as Open-Meteo extends coverage, so a row from 2024 and a row from 2026 could come from different physics under one label, putting a silent inhomogeneity into a training set of only two and a half years. `gfs_seamless` was verified to return full coverage at all three leads from 2024-01-22, and pinning it makes the archive reproducible. The runner up was `icon_seamless`, equally well covered here; GFS was preferred as the American operational global model over an Ohio catchment. The accuracy given up is real and unmeasured, and is worth revisiting once there is a model whose skill can actually measure it.

**Why a missing hour refuses rather than degrades.** The alternative, an explicit null with a missingness indicator, is ordinary machine learning practice and would keep coverage complete. It is the wrong default for this project specifically. The scorecard's entire claim is that a visible gap beats a confident wrong number, and a prediction issued on a rain window known to be incomplete is the flattering failure the dashboard exists to catch. The baselines need no rain and keep running regardless, so the public page never goes blank; only a forecaster that actually needs the feature is withheld. If this later proves too strict, the missingness indicator remains available and the refusal is one branch to change.

**Why trailing discharge rather than observed rainfall for antecedent wetness.** How much rain becomes runoff depends mostly on how saturated the ground already is, so some wetness signal is worth more than more rain detail. Observed antecedent rainfall from ERA5 would be truer to the physics, but it introduces a second source and a publication latency rule, and getting that rule wrong is itself a leak of exactly the kind this child exists to prevent. A creek still running high is a wet catchment. Trailing discharge is already in the store, already governed by the as of reconstruction, and therefore cannot leak. It is the weaker signal and the safer one, and the safer one is right while the leakage machinery is still being built.

**Why the archive boundary is probed rather than pinned.** The parent already made this mistake once, writing 2024-01-01 into `config.ts` with a comment asserting it was where the archive begins. The real boundary is 2024-01-20 for the 24 hour lead and 2024-01-22 for the 72 hour lead, it differs per lead, and it could move if Open-Meteo ever re-cuts the archive. Deriving it from the least `validTime` actually held makes it a measured property that maintains itself, and costs one query.

**Why the run row carries the lead rather than the rows deriving it.** The backfill's unit of work is a (month, lead) pair, but `PipelineRun` describes runs generically and knew only its window. Two runs for one month at different leads were therefore identical in job, window and status, and a resumed backfill had nothing to tell them apart. The alternative weighed was deriving the lead by joining the `WeatherForecast` rows back through `ingestRunId`, which needs no schema change and is wrong twice over. It answers a question about process state by inspecting the data that process happened to produce, which is the same instinct as reading a log to find out whether a job ran. Worse, it has no answer at all for a run that wrote nothing, and that is not an edge case here: **AC-R3** makes re-running an unchanged month write zero rows by design, so a successful run covering a real lead would report as covering none, and the backfill would fetch that month forever. A generic runs table carrying one job's parameter is a real wart, and it is the smaller one. Nullable serves two purposes at once: it is the only safe way to add a column to a table already holding rows, and it is the honest shape, because no other job has a lead to record.

Adding it nullable and not backfilling it does leave one seam. Any `OPEN_METEO_INGEST` run recorded before the migration holds a null lead, so the resume read cannot count it and the month it covered is fetched again. That is a cost, not a bug, and it is bounded: the re-fetch is one request, and **AC-R3** makes it write zero rows because nothing has changed. The seam closes itself after one pass and never reopens, which is why no backfill of the column was written. Backfilling it would have meant deriving the lead from the rows the run wrote, which is the approach rejected above, so paying for the re-fetch once was preferred over doing the wrong thing once.

## Feature design

**Data model sketch**

| Entity | Fields | Constraints |
|---|---|---|
| `WeatherForecast` | `id` · `gaugeId` FK (req) · `validTime` (req) · `leadHours` (req) · `issuedAt` (req, derived) · `recordedAt` (req) · `precipMm` (req) · `tempC?` · `model` (req) · `ingestRunId` FK (req) | unique (`gaugeId`, `validTime`, `leadHours`, `model`, `recordedAt`); index (`gaugeId`, `model`, `leadHours`, `validTime`); check `leadHours >= 24` |
| `PipelineRun` | the parent's existing columns, plus `leadHours?` (int) | unchanged: index (`job`, `startedAt`). No constraint ties the column to the job, because a partial index would state in the schema a rule the resume read already enforces by reading the pair |

The added column is the only change this child makes to an existing table. It is written when the run row is created, before anything is fetched, so a run killed halfway still says which lead it was covering. It is null on every job other than `OPEN_METEO_INGEST`, which is why it is optional rather than defaulted: a default would invent a lead for jobs that have none.

Relationships: `Gauge` 1:N `WeatherForecast`. `PipelineRun` 1:N `WeatherForecast`. No relation to `Prediction`; the link between a forecast and a prediction is the lead window, computed, never stored.

The three timestamps are three different questions and all three are needed. `validTime` is when the weather is expected to happen. `issuedAt` is when it was forecast. `recordedAt` is when this pipeline fetched the row. Without the third, an Open-Meteo re-analysis of its own archive would overwrite history invisibly, which is the failure the `Observation` table exists to prevent and there is no reason weather should be the one exception.

**State transitions**

None. A `WeatherForecast` row is immutable once written, exactly like an `Observation`. Change is expressed by writing another row with a later `recordedAt`.

**API surface**

No new endpoint. This child adds no public read; the dashboard's only new obligation is the attribution text required by **AC-R15**. The parent's endpoint table is unchanged.

**Value sourcing**

| Action | Value produced | Source |
|---|---|---|
| weather ingest | request host | constant, the Previous Runs host, pinned per **AC-R1** |
| weather ingest | requested columns | derived: `precipitation_previous_day{N}` and `temperature_2m_previous_day{N}` for each N in the horizon set divided by 24. Never an unsuffixed name |
| weather ingest | `leadHours` | derived: 24 times the N of the column the value came from. Canonical |
| weather ingest | `validTime` | the hourly timestamp Open-Meteo returns, read as UTC |
| weather ingest | `issuedAt` | derived: `validTime` minus `leadHours`. Nominal, because the endpoint does not report run initialisation time |
| weather ingest | `recordedAt` | this pipeline's wall clock when the row is written, matching how `Observation.recordedAt` is sourced |
| weather ingest | `model` | constant, the pinned model name, stored literally per **AC-R12** |
| weather ingest | whether to write a row | derived: compare `precipMm` and `tempC` against the most recent known row for that (`gaugeId`, `validTime`, `leadHours`, `model`); write only on a difference or when none exists |
| weather ingest | how the comparison set is fetched | derived: one query for the whole (month, lead) window, never one per hour, per **AC-R16** |
| weather ingest | how surviving rows are written | derived: a batched insert in chunks of at most 1,000, bounded by Postgres's 65,535 parameter limit at ten columns |
| weather ingest | `PipelineRun.windowStart` and `windowEnd` | the calendar month boundaries of the chunk being requested |
| weather ingest | `PipelineRun.leadHours` | the lead the chunk was requested at, written on the run row at creation. Never derived from the `WeatherForecast` rows the run went on to write |
| weather ingest | run status | derived: `PARTIAL` when non null hours returned fall short of the hours the window implies, else `OK` |
| live weather ingest | window start | derived: the greatest `validTime` stored for that lead and model, less the existing ingest overlap; the whole gap when a run was missed |
| backfill | which chunks remain | derived: one query for the `OPEN_METEO_INGEST` runs recorded `OK`, reduced to the set of (`windowStart`, `leadHours`) pairs they cover. A chunk absent from that set runs; a run missing either column contributes no pair |
| backfill | first usable date per lead | derived: least `validTime` held for that (`gaugeId`, `leadHours`, `model`), per **AC-R6** |
| feature build | which rows are visible | derived: `recordedAt` at or before the issue time on the live axis, `issuedAt` at or before it on the archive axis, per **AC-R8**; reached by a hand written branch, never `row[axis]`, per **AC-R8a** |
| feature build | which row stands for an hour | derived: among the visible rows for that (`validTime`, `leadHours`), the one with the greatest `recordedAt`. The same reduction `observationsAsOf` applies to `Observation` |
| feature build | rain feature | derived: sum of `precipMm` over the reduced one row per hour set, `leadHours` equal to the horizon, `validTime` in the window after `issuedAt` up to and including `targetTime` |
| feature build | hours a complete window holds | derived: exactly `H` for horizon `H`, the window being `H` hours long over an hourly archive |
| feature build | rain feature when the window is short | constant `null`, never zero, per **AC-R10** |
| feature build | antecedent wetness | derived: `regimeInputs(history, issuedAt, valueAtIssue).m`, the seven day median, on the slot's axis. Null where that function refuses |
| prediction | what happens on a null feature | derived: the forecaster is skipped and the existing skipped tally increments, the same path a null central estimate already takes |
| dashboard | attribution text | constant, required by Open-Meteo's CC BY 4.0 licence |

**Key invariants**

- No `WeatherForecast` row has a `leadHours` below 24. Enforced in the parser and again by the database, because the two catch different mistakes.
- A value that reached the store without an explicit lead suffix behind it is a defect, not a variant. The unsuffixed `precipitation` column is never read.
- `WeatherForecast` is append only. Nothing issues an update or a delete against it.
- `leadHours` is canonical and `issuedAt` is derived from it. If the two ever disagree, `leadHours` is right. Deriving in the other direction would let a rounding difference forge a duplicate that the unique key would not catch.
- No feature used by a prediction issued at `T` draws on a weather row that was not visible at `T` on the slot's axis. This is the parent's central correctness property, extended to the second data source.
- `KnowabilityAxis` names which knowability mode the slot is running in, not a column name. For observations the archive mode column is `validTime`; for forecasts it is `issuedAt`. A reader who assumes the value is always a column name will get the weather read wrong, and `reconstructAsOf` does exactly that with `row[axis]`, so the weather read branches by hand instead.
- A rain feature is computed over one row per hour, never over raw rows. The table is append only, so the filtered set can hold several revisions of the same hour, and a sum that skips the reduction silently over counts. Any code path that sums or counts weather rows without reducing first is a defect.
- A rain window is complete or it is null. Exactly `H` reduced hours for horizon `H`, never a partial sum and never a raw count standing in for a reduced one.
- No code path issues one database statement per hourly value. Reads for a window are one query and writes are chunked, in the backfill and in the live ingest alike. The store is billed by operation, so a loop that works correctly can still be a defect.
- Only the hindcast passes the archive axis. A second caller on it is a review failure, as the hindcast child already states for the other three reads.
- A rain feature is either complete across its whole window or null. There is no partial sum.
- The archive's start date lives nowhere as a literal. It is always the least `validTime` the store actually holds.
- Every `OPEN_METEO_INGEST` run written after the column exists records the lead it covered, and no run of any other job records one. A run of this job written without a lead is a defect rather than a variant: the resume read cannot see it, so the month it stands for is fetched again on every later run. The one legitimate exception is a run recorded before the migration, which is discussed below and costs a re-fetch rather than a wrong answer.
- The lead a run covered is read from the run row, never reconstructed from the rows that point at it. A run that wrote nothing still has to be able to say what it did.

**Security model**

Unchanged from the parent, and nothing here widens it. No authentication anywhere, no personal data, no new secret. Open-Meteo is keyless on the free non commercial tier, so the weather ingest introduces no credential to protect. The only write path remains GitHub Actions holding the database connection string as a repository secret, governed by the `github-actions-hardening` skill; the new scheduled job inherits that and must not run on `pull_request_target` from forks.

The licence position was settled in the parent's rationale and is not reopened here: Open-Meteo's terms define non commercial use to include private sites without subscriptions or advertising, and the data is CC BY 4.0 with attribution, which **AC-R15** discharges.

**Configuration required**

None. No new environment variable, no new secret, no account to create. `PIPELINE_DATABASE_URL` already covers the only credential this workspace holds.

**Critical test scenarios**

- A response carrying both `precipitation` and `precipitation_previous_day1` stores rows from the suffixed column alone, verifies **AC-R1**.
- An insert attempting a `leadHours` of 0 is rejected by the database, verifies **AC-R2**.
- Re-running a month whose values are unchanged writes zero rows; a changed value writes a second row with a later `recordedAt` and leaves the first intact, verifies **AC-R3**, **AC-R5**.
- A backfill interrupted midway and resumed skips the months already recorded `OK` and completes the rest, verifies **AC-R5**.
- A month recorded `OK` at lead 24 and not at lead 48 is skipped for the first and run for the second. This is the case a resume key without `leadHours` gets wrong, skipping both, verifies **AC-R5**.
- A run recorded `OK` carrying no `leadHours` contributes no covered chunk, rather than being read as covering every lead, verifies **AC-R5**.
- A month recorded `PARTIAL` is run again rather than skipped, so the archive's ramp in is not frozen as a permanent gap, verifies **AC-R5**, **AC-R14**.
- With no axis passed, a weather row fetched after the issue time is invisible; on the archive axis a row issued after the issue time is invisible while one issued before it is visible, verifies **AC-R8**, **AC-R9**.
- A lead window missing one hour yields a null feature, and the forecaster requiring it is skipped with the tally incremented rather than issued with a zero, verifies **AC-R10**.
- An hour holding two revisions contributes its newer value once, not both values summed. The same fixture with the revision removed produces the same total, verifies **AC-R7**.
- A window of `H` hours in which one hour holds two revisions and another holds none is short, not complete, so the feature is null. This is the case a raw row count would wrongly pass, verifies **AC-R7**, **AC-R10**.
- A weather row whose `validTime` and `issuedAt` would give opposite visibility answers is judged on `issuedAt` on the archive axis, which a `row[axis]` lookup would get wrong, verifies **AC-R8a**.
- A slot with fewer than `MIN_LOOKBACK_READINGS` prior readings yields a null wetness feature rather than a median of too little history, verifies **AC-R11**.
- A re-fetch in which `tempC` is absent from the response and null in the store writes no row, verifies **AC-R3**.
- Ingesting a month of 720 hourly values issues a statement count in the low tens against a counting stub, not one per hour, verifies **AC-R16**.
- A batch of more than 1,000 changed rows is written as several statements rather than one, verifies **AC-R16**.
- A window inside the January 2024 ramp in returns fewer hours than implied and records `PARTIAL` without failing the run, verifies **AC-R14**.
- The request URL names the pinned model and the pinned host, verifies **AC-R1**, **AC-R12**.
- The rain feature for a 48 hour prediction sums exactly the rows at `leadHours` 48 across its window, and excludes an otherwise identical row at `leadHours` 24, verifies **AC-R7**.

## Build plan

Tracer Bullet, matching the parent. The thin thread is one month of one lead going end to end, from request through storage to a feature value that can be read back and checked by eye. Everything after thickens it.

**Nothing in this child consumes the features.** `BASELINE_MODELS` exposes `central(history, issuedAt, targetTime, timeZone)` and neither baseline takes weather, so no `Prediction` row reads rain here and no task touches `predict.ts`, `models.ts` or `baselines.ts`. The builders in tasks 8 and 9 are pure functions with no TypeScript call site, following the pattern `bucket.ts` already sets: a pure oracle beside a repository query, with `scripts/verify-bucket.ts` proving the two agree against a real database. Slice 4's Python reader is their first consumer, and wiring a forecaster to them is slice 4's work, not this child's. This is stated because the earlier phrasing promised a prediction that reads rain, which this plan does not build and should not be read as deferring by accident.

1. Add `WeatherForecast` to the Prisma schema with its unique key and index, and generate the migration. Add the `leadHours >= 24` check in a second migration created with `--create-only` and applied by `migrate dev` so it executes before shipping. Satisfies **AC-R2**, **AC-R4**.
2. The Open-Meteo client, with the host pinned and the column parser that reads suffixed names only and discards an unsuffixed `precipitation`. Unit tested against a captured response carrying both. Satisfies **AC-R1**, **AC-R12**.
3. `forecastsAsOf`, the latest known read on the four column key, plus the diff and write path above it: one read for the whole window, the comparison in memory, a batched insert of what changed, treating an undefined and a null `tempC` as equal. Write only on a changed value, never update. Mirrors the observation ingest in shape, not in code, because `selectChangedReadings` keys on `validTime` alone. Satisfies **AC-R3**, **AC-R16**.
4. Add the nullable `leadHours` to `PipelineRun` in its own migration, then ingest one month of one lead end to end against the real archive, recording its `PipelineRun` with the window and the lead. The column lands here rather than in task 1 because this is the first task that writes a run, and a Tracer Bullet migrates the thin thread's schema at the point the thread needs it. This is the thin thread; stop and look at the rows, and at the statement count, before going wider. Satisfies **AC-R5**, **AC-R14**, **AC-R16**.
5. Widen to all three leads and all months, chunked and resumable. One query reads the runs recorded `OK` and reduces them to the covered (`windowStart`, `leadHours`) pairs; a chunk already in that set is skipped. Walk months before leads, so an interrupted run leaves a contiguous prefix of fully covered months rather than one lead running far ahead of the others. Satisfies **AC-R5**.
6. Derive the first usable date per lead from the store, and correct the false comment on `BACKFILL_START` in `config.ts` without moving the date. Satisfies **AC-R6**.
7. The weather read, taking the `KnowabilityAxis` parameter with `recordedAt` as the default, mapping the archive axis onto `issuedAt` by a hand written branch rather than a `row[axis]` lookup, with a fixture where the two columns disagree. Satisfies **AC-R8**, **AC-R8a**.
8. The rain feature builder as a pure function: reduce to one row per hour by greatest visible `recordedAt`, then sum across the lead window at the matching lead, returning null unless exactly `H` hours survive. Paired with a repository query and a `verify-` script proving the two agree, as `bucket.ts` is. Satisfies **AC-R7**, **AC-R10**.
9. The antecedent wetness feature, the seven day median from `regimeInputs` read at `issuedAt` on the slot's axis, null where that function refuses. Satisfies **AC-R11**.
10. Extend the leakage test to weather rows on both axes, alongside the existing observation leakage test. Satisfies **AC-R9**.
11. The live weather ingest job at 00, 06, 12 and 18 UTC, ordered ahead of the prediction job, with the window computed from what is stored. Satisfies **AC-R13**.
12. Open-Meteo attribution on the dashboard. Satisfies **AC-R15**.

## Consequences

**Positive**

- The pipeline gains an input that can see a storm before it reaches the channel, aimed at the one river state where coverage is measurably worst.
- The most dangerous mistake available in this project becomes structurally hard rather than merely documented, at three independent layers.
- A second data source now obeys the same append only, two axis discipline as the first, so the store has one rule rather than one rule and an exception.
- The archive boundary becomes a measured property that maintains itself, retiring a constant that was already wrong.
- The backfill is cheap enough that quota never enters the design: roughly seventy weighted calls against ten thousand a day.

**Negative and tradeoffs**

- `issuedAt` is nominal, not observed. Every row asserts a run time the endpoint never reported, and that assertion is off by however far the real run sits from the round number. It is recorded here rather than hidden, and the Single Runs API is the way to fix it if it ever matters.
- Pinning one model gives up whatever `best_match` would have added, and nothing here measures the size of that.
- Refusing to predict on an incomplete rain window means a rain aware forecaster will have gaps in its record that the baselines do not, so their scored populations are no longer identical. Any comparison between them has to account for that or it will quietly compare different sets of days.
- Trailing discharge is a weaker wetness signal than observed antecedent rainfall, chosen for safety rather than strength.
- A third timestamp on a second table is more for a reader to hold, and the `KnowabilityAxis` value `validTime` now means `issuedAt` in one of its four uses, which is a genuine wart. **AC-R8a** contains it with a hand written branch and a test rather than removing it, so the codebase now has one axis reader that deliberately breaks the `row[axis]` idiom every other one follows.
- Adding a column to `PipelineRun` breaks every writer whose database is behind the code, not just the one that wanted the column. `pipelineRun.create()` names every column of the model in its `RETURNING` clause, so a job that never touches `leadHours` still fails on it. This landed on 2026-08-30: the hourly scoring pass failed twice between the merge and the six hourly pipeline run that applied the migration, because scoring was the one scheduled entry point that did not apply migrations first. Fixed by giving it that step. The general lesson is that a shared runs table has as many deployment dependencies as it has writers.
- `PipelineRun` is a generic table that now carries one job's parameter, so a reader meets a column that is null on most of the jobs. The resume key needs it and the alternatives were worse, but the table is less uniform than it was, and the next job wanting a parameter of its own will point at this precedent rather than at a general mechanism.
- Append only storage plus a summed feature means every read path that touches weather has to reduce before it aggregates. That is one more rule a future query has to remember, and forgetting it produces a wrong number rather than an error.
- This child ships no consumer for the features it defines, so tasks 8 and 9 are proved only against fixtures and a verify script until slice 4 reads them. Correct for the layering, and it does mean the features go unexercised by a real prediction for a while.
- The training window remains about two and a half years, and the archive's real start pushes it three weeks shorter than the parent assumed. The number of genuinely large storms in it is still small, and this child does nothing about that.

**Neutral**

- Roughly seventy thousand new rows, which is the same order as the observation table. Measured 2026-08-30, the streamflow database is 64.1 MB against a 500 MB allowance shared with the portfolio's own database at 8.2 MB. At the observation table's 513 bytes a row, and allowing for this table's extra columns and wider indexes, the archive adds about 45 MB and lands the total near 127 MB, growing about 17 MB a year from live ingest. Storage is not the constraint; the operation count is, which is why **AC-R16** exists.
- The dashboard is the largest uncapped consumer of the operation allowance, at roughly eight to ten queries per page view, and it scales with traffic rather than with anything this pipeline controls. Worth knowing before the backfill spends any of the same budget.
- The prediction job gains a dependency on the weather job having run, which is a real ordering constraint in the workflow that did not exist before.
- Nothing here proves rain helps. It builds the input honestly and leaves the measurement to the model that consumes it, which is the right order but does mean the motivating number stays unmoved until slice 4.

## Follow-up

- [ ] Nothing yet measures whether forecast rain actually improves rising regime coverage. That is the point of the whole child and it cannot be answered until a forecaster consumes the feature. Re-measure the 52.6 percent when one does.
- [ ] `issuedAt` is nominal. If forecast run timing ever matters, the Single Runs API reports true initialisation times via its `run` parameter and would replace the derivation.
- [ ] The pinned model is unvalidated against alternatives. Once a model exists whose skill can measure it, compare `gfs_seamless` against `icon_seamless` on the same features before treating the pin as settled.
- [ ] `apps/streamflow` has no `AGENTS.md`, unlike `apps/web`, `apps/api` and `packages/shared`. This workspace now has enough of its own conventions, the axis parameter, the append only rule, the oracle paired queries, that the absence costs something.
- [ ] The parent's **AC-4** is superseded by **AC-R4** on both the unique key and the third timestamp. Reconcile the wording so one is not left contradicting the code, the same reconciliation the hindcast child already owes on **AC-I13**.
- [ ] The forecast against observed comparison in Context is a strong honesty surface in its own right and currently lives only in this spec. Consider whether the public walkthrough should show it, since it makes the leakage argument concrete in a way prose does not.
- [x] Done 2026-08-30. The parent [index.md](index.md) showed `PipelineRun` without `leadHours`. Its data model row now carries the column and its build plan task 11 says why the run row holds a lead at all, pointing here for **AC-R5**. The parent's **AC-4** reconciliation above is a separate item and is still open.
- [x] Done 2026-08-30. [verify.md](verify.md) now carries a section for this child, covering all seventeen criteria: eight exercised, eight marked not built because tasks 6 to 12 have no code yet, and AC-R2 split so the parser half reads as covered and the database check constraint reads as owed. Three steps stay unticked on purpose. They need a database, either a throwaway (the check constraint, the backfill run twice) or the live store (the runs per lead count), and they are the operator's to run.
- [x] Done 2026-08-31. Task 12 shipped, which completes this child's build plan. `/streamflow` credits Open-Meteo and links CC BY 4.0 from `app/streamflow/DataSources.tsx`, with a suite that asserts both by `href` and was shown to fail when either is removed. Note that the credit currently runs ahead of the display: nothing on that page reads the weather rows yet, so the copy deliberately says what the pipeline stores rather than what the page shows, and does not go stale when slice 4 wires a consumer.
- [x] Settled by [0010-staleness-disclosure.md](0010-staleness-disclosure.md) on 2026-08-31, display only and not yet built. **A stale reading is shown as the latest reading, with no ceiling and no escalation.** Raised by the public safety audit on 2026-08-31, pre existing rather than introduced by this child, and left open deliberately because the fix is a decision rather than a patch. `page.tsx` reads the newest observation with an unbounded `findFirst … orderBy: { validTime: 'desc' }`, so if ingest stops the page keeps serving whatever the last row was, however old. The workflow's own comment says GitHub drops scheduled runs entirely after 60 days of repository inactivity, so the worst case age is unbounded. The page is not silent, it renders the age and the qualifier, but at 11px muted against a 23px glowing figure, and there is no age at which its behaviour changes. The pipeline's own `FAILED` status appears only in the bottom panel. The decision owed is what threshold should change the page's behaviour and what it should then show, probably keyed off `ISSUE_INTERVAL_HOURS`. `/architect` owns it.
- [x] Settled by [0010-staleness-disclosure.md](0010-staleness-disclosure.md) on 2026-08-31, which deliberately leaves the issuing alone and changes only the display. **Forecasts are issued from stale readings by design, and the table gives a reader no way to tell.** Same audit, also pre existing. The prediction job runs even when ingestion failed, deliberately, because declining to issue would leave a hole the skill chart cannot tell apart from a model with nothing to say; that reasoning is about scoring integrity, and the same rows are shown to the public as a forecast. `persistenceForecast` applies no maximum input age. Separately the dashboard shows forecasts issued up to two days ago as current, so a 24 hour row can carry a target time already in the past under the present tense heading "What each forecaster expects". The existing footnote marker mechanism could carry a stale input marker, but which rows to mark or suppress is a product decision.
- [ ] Consider whether a missingness indicator should later replace the refusal in **AC-R10**, if refusing turns out to cost more coverage than expected.
- [ ] The live edge availability check was taken once, on 2026-08-30, at one instant. It says the window is not starved now; it does not establish that it never is. Re-check it from the first week of live weather ingest, using the count of predictions skipped for a null rain feature, which **AC-R10** already records.
- [ ] **The first consumer of the rain feature must not pass `issuedAt` as its knowability bound, and the obvious reading of `predict.ts` says to.** Found by the pre deploy audit on 2026-08-31, before anything consumes the feature, so nothing is broken today. `issuePredictions` snaps its issue instant backwards to the six hourly slot (`predict.ts:225`, `mostRecentIssueSlot`) and then passes that snapped value as the as of bound for observations (`predict.ts:257`). A rain read copying that pattern would bound on `recordedAt <= issuedAt`, and the live ingest that ran minutes earlier in the same workflow job stamps its whole batch with one `recordedAt` captured after the fetch, which is always later than the snapped slot. The entire current cycle would be invisible, with no older row behind it for the last six hours of the window, so **AC-R7**'s exact `H` hours never completes and **AC-R10** returns null at every horizon on every cycle, for ever. Measured in a harness: 18 of 24 hours visible at lead 24, 42 of 48, 66 of 72, and it does not depend on the delay, since an ingest one millisecond past the slot hides the same batch. It fails silently, as "no rain data", which is why it is written down now rather than left to be rediscovered. The same bound already hides the current cycle's USGS batch, so persistence forecasts from readings about six hours old; observations degrade quietly where rain refuses outright, and that asymmetry is why this went unnoticed. **The decision is which clock a live prediction's knowability bound should be**, the nominal issue slot or the run's real wall clock, and it is a decision rather than a fix: it touches what a prediction claims to have known. `/architect` owns it, in the slice that wires the first consumer.
- [ ] This spec was cross checked on a second model on 2026-08-30. It found a double counting bug in the original **AC-R7**, which had no reduction rule over an append only table, and an inconsistency between the build plan's stated thin thread and the tasks it listed. Both are fixed above. Recorded because the parent's rationale already keeps a note of the two claims an independent model caught there, and this is the same failure mode: confident, wrong, and in the flattering direction.

## References

**Project sources**

- The parent [index.md](index.md), for **AC-4**, **AC-13**, **AC-17** and the equal maturity rain rule this child settles the open parts of.
- The parent [rationale.md](rationale.md), for the leakage argument, the choice of Previous Runs, and the licence position that is not reopened here.
- [0010-hindcast-seeding.md](0010-hindcast-seeding.md), for the `KnowabilityAxis` mechanism this child reuses rather than reinvents.
- [0010-falling-denominator.md](0010-falling-denominator.md) and the findings beside it, for the measurement discipline these numbers follow.
- `apps/streamflow/src/config.ts`, for `BACKFILL_START` and the comment this child corrects.
- Root `AGENTS.md`, for Node 22, the generated migration rule, and the skills named above.

**Practices and standards**

- Point in time correct feature retrieval: a feature for an event at `T` may use only what was knowable at `T`.
- Lead matched forecast features: training and serving must use forecasts of equal maturity, or the backtest measures a system that cannot exist.
- Append only bitemporal storage, separating when a fact was true from when it was learned.
- Idempotent chunked backfill, checkpointed so an interrupted run resumes rather than restarts.

**Links**, all fetched and confirmed on 2026-08-29

- Open-Meteo Previous Runs API, the chosen source: https://open-meteo.com/en/docs/previous-runs-api — `_previous_dayN` for N of 1 to 7, most models archived from January 2024.
- Open-Meteo Historical Forecast API, the subtle trap: https://open-meteo.com/en/docs/historical-forecast-api — archived forecasts, but each run's first few hours stitched into a continuous series, so the effective lead is near zero.
- Open-Meteo pricing, for the free tier limits and the fractional call weighting: https://open-meteo.com/en/pricing — 10,000 calls a day, 300,000 a month, with 14 days across 14 variables counting as 1.0 call.
- Open-Meteo terms, defining non commercial use and the CC BY 4.0 data licence: https://open-meteo.com/en/terms

**Measurements taken 2026-08-29**, against the live pipeline database and the Open-Meteo archive at gauge `03230500`

- Coverage by river state, 17,565 graded hindcast rows, conditioned intervals only.
- Archive edge: nothing before 2024-01-18; the 24 hour lead full from 2024-01-20; the 72 hour lead full from 2024-01-22. Consistent across `best_match`, `gfs_seamless` and `icon_seamless`, so it is a property of the archive rather than of the model.
- `ncep_hrrr_conus` returns the 24 hour lead but no 72 hour lead, its model horizon being shorter than three days, which is why a high resolution regional model cannot serve this horizon set alone.
- The forecast against ERA5 comparison table in Context.
