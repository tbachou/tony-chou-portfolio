# 0010. Streamflow forecast pipeline, rationale

The reasoning behind [index.md](index.md), and the concepts it assumes. Written to be read rather than skimmed, because this project exists to teach.

## Context

> ⚠️ Premise note: the learning goal and the portfolio goal pull in different directions, and the spec resolves that tension in one direction on purpose. The fastest way to learn time series modelling is a notebook: load a CSV, fit a model, plot a chart, done in an evening. This spec instead spends its first two slices on storage and scoring before any model exists. That is the right call, because the pipeline is the part that cannot be produced in an afternoon and therefore the part worth showing, and because a model built on a store you cannot trust teaches you nothing true. But it does mean the machine learning arrives slowly, and there is a real failure mode where all the energy goes into modelling once slice 4 begins and the honesty surfaces in slice 5 never get built. If that happens, this becomes an ordinary tutorial project with an unusually good database. The calibration view and the regime split are not decoration; they are the deliverable.

Tony is a full stack TypeScript engineer with roughly seven years of production experience and effectively no background in machine learning, time series analysis, or the data engineering particular to this problem class. He wants a project that teaches him those things properly, step by step, including the analytics tradeoffs, and he wants it to be a live running thing rather than a static notebook.

The subject is river discharge at a single USGS gauge. Discharge is the volume of water passing a fixed point, measured every 15 minutes and published within minutes. It is an unusually good teaching dataset: the underlying process is physical rather than social, the data is free and public domain, the history is long, and there is a clear driver (rainfall) whose forecast is also obtainable.

It has one property that makes it much better than most: **USGS publishes readings as provisional and revises them later.** A value recorded today may be corrected in six weeks after field calibration. Most public datasets hide their corrections by overwriting. This one does not, which turns an ordinarily invisible problem into something you can see, store, and reason about.

The forcing constraint is that the interesting forecast horizons need rainfall, and rainfall must enter the system as a *forecast*, not as an observation. What actually fell is knowledge from the future. That single fact shapes the storage design, the training procedure, and the choice of weather source.

## The concepts this spec assumes

Read this section before the build plan makes sense.

### Two timestamps, not one

Think of a bank statement. If the bank corrects last Tuesday's transaction, there are two different questions you might ask: what did the balance appear to be on Tuesday, and what do we now believe it was. A table with one timestamp per row can answer one of those. A table with two can answer both.

So every fact here carries `validTime`, the moment it describes, and `recordedAt`, the moment we learned it. A correction is a new row with the same `validTime` and a later `recordedAt`, never an update. To ask what was knowable at time T, take each `validTime` and keep the row with the greatest `recordedAt` at or before T.

The cost is real: the table only grows, and every read pays for that filtering. At a few hundred thousand rows it is free. The alternative, overwriting on revision, is cheaper and destroys the only thing that makes the backtest meaningful.

### Leakage, and why it does not feel like a bug

Leakage is training on information that would not have been available at prediction time. The obvious version is easy to avoid. The subtle versions are not, and there are two in this project.

The first is revisions. Train against a table you have been updating in place and your model learns from corrected values it will never have in production.

The second is more interesting: **train on rain that actually fell and you have given the model perfect weather foresight.** In production it will only ever see a forecast, which is wrong in ways that matter. The backtest will look excellent and the live system will disappoint, and nothing will explain why. This is the reason the spec insists on archived forecasts at matching lead times rather than observed rainfall, and it is why Open-Meteo's Previous Runs API, which returns exactly what was predicted N days out, is the semantically correct source.

What makes leakage genuinely dangerous is its direction. Every engineering instinct you have is tuned to notice things getting worse. Leakage makes the numbers better. It arrives disguised as success.

### A baseline is not a formality

An error of twelve percent means nothing on its own. It only acquires meaning next to the error of the dumbest defensible alternative. If simply repeating the most recent reading achieves ten percent, your model is worse than doing nothing at all, and the twelve percent figure was never evidence of anything.

For rivers this matters more than usual, because **persistence is genuinely strong**. Water moves slowly, catchments drain over days, and tomorrow really does look a lot like today most of the time. At 24 hours it is a hard opponent. The spec drops the phrase "seasonal naive", and the reason is worth getting exactly right, because an earlier draft of this document got it wrong. The wrong reason: that rivers have no daily cycle. They do. Small and moderate catchments show a real daily rhythm in the growing season, because plants draw water during the day and stop at night. The correct reason is arithmetic. Seasonal naive with a 24 hour period predicts the value from a whole number of days ago, so at a horizon of 24, 48 or 72 hours it returns the most recent reading, which is exactly what persistence returns. It is not a weaker baseline than persistence. It is the same baseline under another name, and naming it that way would only have obscured what was being compared.

Two baselines are specified because which one is hardest changes with the horizon. Persistence is strong at 24 hours and decays as the horizon grows. Climatology, the average for this day of the year, is weak at 24 hours and relatively stronger at 72. Watching them cross over is itself one of the lessons.

### What a backtest proves, and what it cannot

A backtest done properly, walking forward through time and training only on what was available at each simulated issue point, proves one thing: given the data pipeline you actually had, the model would have performed roughly like this over that period.

It does not prove the future resembles the past. It does not prove your production feature availability matches the backtest's. And most importantly here, **it does not prove much about the cases you care about.** A two and a half year window on one creek probably contains only a handful of genuinely large storm events. Treat that as an assumption to verify against the actual hydrograph in slice 1, not as a measured fact; it has not been counted. If it holds, your entire estimate of peak performance rests on those few events. The thing you most want to forecast is the thing you have least data for, and no amount of statistical machinery fixes that. Stating it plainly is more honest than a confidence interval implying otherwise.

### Intervals, and checking whether they are honest

A single predicted number states a confidence nobody has. A range says something more useful and more truthful, particularly for a river, where the same rainfall forecast can produce very different flows depending on how saturated the ground already is.

An eighty percent interval makes a checkable claim: the truth should land inside it about eighty percent of the time. If it lands inside ninety eight percent of the time, the interval is so wide it is useless. If fifty percent, it is lying. That comparison is called calibration, it takes very little code, and almost no portfolio project does it. It is on the dashboard for that reason.

### Why the average is the enemy

The river is boring most of the time: flow drifts slowly down for weeks, and persistence predicts it nearly perfectly. The exact share is an assumption until slice 1 lets you measure it, and measuring it is worth doing, because that share determines how badly an unsplit average would mislead you. Then it rains and everything happens in six hours.

An overall average error is therefore dominated by the easy cases, and will look excellent for a model that completely fails during storms. Splitting every score into baseflow, rising and peak is what stops the headline number from flattering you. It is also the split that makes the project honest enough to be worth showing.

### A note on how this document was checked

Two claims above were wrong in an earlier draft, and both were caught by an independent model reviewing this spec rather than by its author. The seasonal naive explanation gave a plausible but incorrect reason for a correct conclusion, and two statistics were stated in the same confident register as the verified facts elsewhere despite never having been measured.

That is recorded rather than quietly fixed, for two reasons. It is precisely the failure mode this project is about: a confident statement, wrong in the flattering direction, with nothing to signal it. And it is why the spec was cross checked at all, since a reader learning the domain from this document cannot catch that class of error himself.

## Options considered

### Option 1: snapshot storage, overwrite on revision

One row per reading. When USGS revises a value, update the row.

**Pros**

- Far simpler schema, simpler queries, smaller table, and it is what most people would write without thinking.
- Every read is a plain select with no temporal filtering.

**Cons**

- Makes the central correctness property unprovable. Once a value has been overwritten there is no way to establish what was knowable at any past moment.
- Silently corrupts every backtest, in the flattering direction.
- Discards the single most interesting property of this dataset, which is that it corrects itself in public.

### Option 2: bitemporal store, Python for modelling, joined through the database

The chosen option. Append only storage with both time axes, Python reading and writing the same Postgres directly, GitHub Actions on a cron, a public scorecard.

**Pros**

- The correctness property is enforced by the storage design and provable by a test.
- Python gives access to the ecosystem the learning actually requires, while TypeScript keeps the parts already familiar.
- No service boundary between the halves, so no contract to version and nothing to keep warm.
- Produces a working, showable system at the end of slice 2, before any model exists.

**Cons**

- Two languages, two toolchains, and a CI job that must provision both.
- Append only growth and per read temporal filtering, which is free at this scale and would not be at ten million rows.
- More to build before the first model appears, which is a real cost when learning modelling is the stated goal.

### Option 3: notebooks only

Pull CSVs, explore and model in Jupyter, publish findings.

**Pros**

- By far the fastest route to the machine learning itself, which is the stated learning goal.
- Standard practice for this kind of analysis, and a genuinely good way to build intuition.

**Cons**

- Nothing runs. There is no live artifact, no accumulating scorecard, and nothing an interviewer can look at that could not have been produced in a weekend.
- Encourages exactly the leakage this project exists to avoid, because a notebook has no natural notion of what was knowable when.

### Option 4: a managed ML platform with a feature store

Adopt an off the shelf platform that provides point in time correct feature retrieval.

**Pros**

- Solves the point in time problem as a product feature rather than something to build.
- Closer to how a large team would work.

**Cons**

- Teaches a vendor's abstraction rather than the underlying idea, which defeats the purpose when the purpose is understanding.
- Adds a substantial dependency and probable cost to a project whose infrastructure is otherwise free.

## Rationale

Option 2 was chosen because the stated goal is understanding, and the thing most worth understanding here is the one that option 1 makes invisible and option 4 hides behind an abstraction. Point in time correctness is not a detail of this problem; it is the problem, and building it by hand once is worth more than configuring it a dozen times.

Option 3 deserved more weight than it usually gets, because it is genuinely the fastest way to learn modelling, which is what Tony asked for. It loses on the second half of the ask. He wanted something ongoing, and a notebook is by definition finished. The compromise the build plan makes is to front load the parts a notebook cannot teach and let the modelling arrive in slice 4, by which point the harness that makes modelling honest already exists.

The choice to separate this from the portfolio's existing database is not about scale, since the volumes are trivial. It is about blast radius. This project involves a Python process with write access running on a schedule from CI, built by someone deliberately working outside their expertise. That does not belong in the same database as a live site.

The decision to store baselines as ordinary model rows looks like a small thing and is not. It means no code anywhere branches on whether something is a baseline, adding a fourth or fifth approach later costs nothing, and the comparison that gives every number its meaning is structural rather than bolted on.

Finally, on the weather licence. Spec 0008 died partly because CC BY-NC gave no publisher guidance on whether a hiring oriented portfolio counts as commercial, and the resolution there was exclusion rather than adjudication. This is not that situation. Open-Meteo's own terms define non commercial to include private websites and apps without subscriptions or advertising, so there is nothing to adjudicate, and the data itself is CC BY 4.0 with attribution. The distinction is worth recording so the earlier ruling is not misapplied here as a blanket rule.

## References

**Project sources**

- Root `AGENTS.md`, for the stack, the migration rules, and the Node 22 requirement.
- Spec [0001](../0001-backend-ai-stack/index.md) and [0003](../0003-frontend-deployment-platform.md), for the existing Prisma, Postgres, Render and Vercel choices this project deliberately reuses and deliberately isolates from.
- Spec [0008](../0008-beta-clinical-evidence-check/index.md), for the licence rule this project checks itself against, and the reason it does not apply here.
- `.claude/skills/github-actions-hardening/`, governing the workflow that holds the only write credential in a public repository.

**Practices and standards**

- Bitemporal data modelling: separating valid time from transaction time so a store can answer both what was true and what was known.
- Walk forward, also called rolling origin, backtesting: evaluating a forecaster by repeatedly training only on data available before each simulated issue time.
- Persistence and climatology as forecast baselines, and forecast skill as improvement measured against them rather than as raw error.
- Prediction interval calibration: comparing observed coverage against the nominal level.

**Links**, all fetched and confirmed on 2026-08-23

- USGS Instantaneous Values service: https://waterservices.usgs.gov/docs/instantaneous-values/instantaneous-values-details/ — no API key, JSON, RDB and XML, one request reaches back to 1 October 2007.
- USGS site service, used to enumerate candidate gauges: https://waterservices.usgs.gov/nwis/site/
- Big Walnut Creek at Central College, the gauge rejected for sitting roughly 1,800 feet below Hoover Dam: https://waterdata.usgs.gov/monitoring-location/USGS-03228500/
- Open-Meteo Historical Forecast API, archived forecasts rather than observations, from around 2021: https://open-meteo.com/en/docs/historical-forecast-api
- Open-Meteo Previous Runs API, fixed lead time series, archived from January 2024, the source this spec uses: https://open-meteo.com/en/docs/previous-runs-api
- Open-Meteo terms, defining non commercial use and the CC BY 4.0 data licence: https://open-meteo.com/en/terms
- Open-Meteo pricing, for the free tier limits of 10,000 calls a day and 300,000 a month: https://open-meteo.com/en/pricing
