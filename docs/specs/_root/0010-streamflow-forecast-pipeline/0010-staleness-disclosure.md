# 0010 child: Saying how old the numbers are

## Summary

The dashboard shows a river reading and three forecasts, and none of them says how old it is. If ingest stops, the page keeps serving the last number it has, under a heading that reads live, for as long as the outage lasts. This child gives the page an age at which its behaviour changes: past nine hours the reading carries a warning that names its age and, when the pipeline is also failing, says so; forecasts made from a reading that old carry a marker; and forecasts whose target time has already passed stop being shown as though they were about the future. Nothing about the pipeline changes. The dishonesty was never that stale forecasts get issued, it was that the page displayed them silently.

## Context

The public safety audit on 2026-08-31 raised two findings against `/streamflow`, both pre existing and neither introduced by the rain child that logged them.

The first is that the newest reading is read with an unbounded `findFirst … orderBy: { validTime: 'desc' }`. Whatever the last row is, that is what renders, however old. The scheduled workflow's own comment records that GitHub drops scheduled runs entirely after sixty days of repository inactivity, so the worst case age is not merely long, it is unbounded. The page is not silent about age: it renders the reading's timestamp, its relative age and its qualifier. But it renders them at 11px in the lowest contrast colour on the palette, hard against a 23px glowing figure, and there is no age at which any of that changes. Freshness is the least prominent thing in the block.

The second is that forecasts are issued from stale inputs by design. The prediction job runs even when ingestion failed, deliberately, because declining to issue would leave a hole the skill chart cannot tell apart from a model with nothing to say. That reasoning is about scoring integrity and it is sound. The problem is that the same rows are shown to the public as a forecast, with nothing to say the input was old. `persistenceForecast` applies no maximum input age. Separately the dashboard shows forecasts issued up to two days ago as current, so a 24 hour row can carry a target time already in the past under the present tense heading "What each forecaster expects".

What makes both worth fixing is who reads this page. `/streamflow` is indexed, is marked `changeFrequency: daily` in the sitemap, and its own layout comment says it is "the page most likely to be linked to directly, since it is the one with something live on it". A reader arriving from a search during a rain event meets a discharge figure in glowing phosphor and a forecast table. The attribution child already added a line saying this is not a flood forecast. That line is about what the page *is*. This child is about whether what it shows is *current*.

One measurement bounds every answer here. Ingest runs on `0 0,6,12,18` and USGS publishes every fifteen minutes, so in healthy operation the newest stored reading peaks at roughly six hours old just before the next run. Any threshold at or below six hours fires constantly on a working pipeline, which trains a reader to ignore it.

## Requirements

**User stories**

- As a visitor, I want to know when the number I am looking at is old, so that I do not read a stopped pipeline as a calm river.
- As a visitor, I want to know when a forecast was made from an old reading, so that I can weigh it accordingly rather than assuming it saw the current river.
- As a visitor, I want the forecast table to be about the future, so that a row whose target has already passed does not read as a prediction.
- As the builder, I want the threshold tied to the ingest cadence, so that changing the schedule cannot silently leave the warning wrong.

**Acceptance criteria**

- **AC-S1**: The staleness threshold is derived as one and a half times `ISSUE_INTERVAL_HOURS`, in the shared streamflow config, and is not a literal. At the current six hour cadence it is nine hours. A test binds the relationship, not the number, so a cadence change moves the threshold with it.
- **AC-S2**: The newest reading is stale when `now` minus its `validTime` exceeds that threshold. At or below it, the page renders exactly as it does today.
- **AC-S3**: When the reading is stale, the gauge panel keeps the figure at its current size and glow and adds a warning naming how old the reading is. The number is never hidden, replaced or restyled: a reader who wants the last known value can still see it.
- **AC-S4**: When the reading is stale **and** the pipeline is not completing runs, the warning says so. Not completing means any of: the most recent ingest run recorded `FAILED` or `PARTIAL`; that run's own `startedAt` is older than the threshold; or no run exists at all. The last two matter because **a scheduler that stops entirely writes no new row**, so the most recent run stays the last successful one and its status stays `OK`. Reading status alone reports the worst failure this page has, a workflow GitHub disabled after sixty days of repository inactivity, as perfect health. When the reading is stale and the pipeline is merely late, the sentence is withheld, because late and broken are different findings.
- **AC-S5**: A displayed forecast is stale input when `issuedAt` minus the `validTime` of its input reading exceeds the same threshold as **AC-S1**. One threshold governs both surfaces.
- **AC-S6**: The input reading is the row with the greatest `validTime` among the loaded observations satisfying **both** `validTime <= issuedAt` **and** `recordedAt <= issuedAt`. No new query is issued and no column is added to `Prediction`. **The `recordedAt` bound is load bearing, not an optimisation.** The page loads one reconstruction as of `now`, not one as of `issuedAt`, and `writeObservations` stamps a single `recordedAt` on a whole batch. So after gap recovery backfills an outage (the parent's **AC-6**), a row whose `validTime` sits right against `issuedAt` but whose `recordedAt` is hours later would stand in as the input a forecast made during the outage supposedly used, and the row would read as fresh input. That is a false negative in precisely the case this criterion exists to catch. A test forges that shape and fails if `validTime` alone is used.
- **AC-S5a**: A displayed forecast is **also** stale when `now` minus its own `issuedAt` exceeds the same threshold, whatever its input's age was. Predictions are issued on the same six hourly cadence as ingest, so a forecast past the threshold means a missed predict cycle. This is a separate failure from **AC-S5** and the pre deploy audit found it reachable: the workflow runs ingest and predict as separate steps, so the predictor can die while ingest keeps running, and then the reading is fresh, the input was fresh when the forecast was issued, and a forecast forty hours old renders with nothing to say so. A forecast stale on either count is marked identically; a reader does not need to know which clock failed.
- **AC-S6a**: When no loaded observation satisfies both bounds, the forecast is treated as stale input rather than fresh. The derivation fails toward disclosure, never toward silence.
- **AC-S7**: Stale input forecasts are marked, and the marker is a double dagger, the next free symbol after the `*` and dagger the table already spends on interval provenance. It carries its own legend paragraph in the same style as those two. When only some rows are affected, each carries a per row marker and the legend follows the table beside the other footnotes; when every row is affected, a single note **above** the table replaces the per row markers, because a reader scanning numbers reaches the table before anything under it.
- **AC-S8**: A forecast whose `targetTime` is at or before `now` is not displayed. The table is about the future or it is not a forecast table.
- **AC-S8a**: **AC-S8**'s filter runs before **AC-S7**'s decision, and "every row" in **AC-S7** means every row that survived it. The order is load bearing: with six rows of which four are stale input and two have elapsed, the survivors are four of four stale and should carry one note, while counting before the filter reads four of six and would wrongly print per row markers.
- **AC-S9**: When **AC-S8** leaves no rows to show, the empty state says the current forecasts have elapsed and none newer has arrived, in wording distinct from the never issued state, because a stopped pipeline must not read as a fresh install. **The distinction is drawn from a read that is not bounded by the two day forecast window**, a `findFirst` for any non hindcast prediction at this gauge. Drawing it from the loaded rows, as the first draft did, makes the elapsed state unreachable: every issue slot writes all three horizons, and a 72 hour row issued at the oldest loadable instant still targets a day into the future, so "every loaded row has elapsed" is a shape the scheduler cannot produce. Verified by sweeping every admissible issue time at five minute resolution: zero all elapsed cases. The consequence of getting this wrong is not a missing message but a false one, since the page then falls through to "no forecast has been issued yet" during exactly the outage this criterion is for.
- **AC-S10**: No pipeline behaviour changes. The prediction job still issues from stale inputs, `persistenceForecast` still applies no maximum input age, and no scored row is affected.
- **AC-S11**: A failed read stays distinct from stale data. Staleness is only evaluated when a read succeeded, and the existing failure paths are untouched. **Correcting this criterion's first wording**, which claimed a rejected observations read renders a failure message: it does not, and never did. That read is the one the page deliberately does not settle, because the hydrograph is what this page is, so its rejection is rethrown to the error boundary and no part of the page renders. Every other panel settles and says so. This child does not change that, and the criterion now describes the behaviour rather than a behaviour that was assumed without checking.

## Options considered

### Option 1: disclose on the page, at a threshold derived from the cadence (chosen)

Leave the pipeline alone and change only what the page says. Compute staleness at render time from data already loaded, warn beside the reading, mark the affected forecast rows, and drop rows whose target has passed.

**Pros**

- Fixes the actual defect, which is silence, not behaviour.
- No migration, no new query, no change to any scored row.
- Works on historical rows immediately, because nothing depends on a column written from now on.
- Fully reverted by reverting one commit.

**Cons**

- The page recomputes at display time something the pipeline knew at issue time and threw away.
- Cannot answer a question a stored input age could: do stale input forecasts actually score worse?

### Option 2: refuse to issue above some input age

Stop the pipeline producing forecasts the page would only have to disclaim.

**Pros**

- The public surface needs no disclaimer, because nothing questionable is published.
- Arguably more honest: a forecaster with no current input has nothing to say.

**Cons**

- Breaks the unbroken scored record the current design deliberately protects, and the workflow comment says why.
- Changes what the skill chart means partway through its own history, so comparisons across the gap stop being like for like.
- Leaves a reader with nothing at all during an outage, which is not obviously better than a marked forecast.

### Option 3: record the input reading on `Prediction`

Add a column written at issue time, and read it back on the page.

**Pros**

- Durable and queryable, and it makes the scoring question above answerable later.
- The page reads a fact rather than deriving one.

**Cons**

- A migration for a display fix.
- Null for every row already issued, so the in memory derivation is needed anyway as a fallback, meaning both paths exist rather than one.
- Larger blast radius than the problem justifies today.

## Decision

**Chosen option**: Option 1: disclose on the page, at a threshold derived from the cadence.

The page gains a staleness threshold derived from the ingest interval, warns beside the reading it qualifies, marks forecasts made from a reading past that threshold, and stops showing forecasts whose target time has passed. The pipeline is untouched.

## Rationale

The two findings look like one problem but only share a symptom. Issuing forecasts from stale inputs is a deliberate, documented, and defensible choice about scoring integrity: an unbroken record is worth more than an aesthetically clean one, and a gap in the skill chart is genuinely ambiguous between "the model declined" and "the model had nothing to say". Option 2 would trade a real property for a cosmetic one. The defect is entirely in the display layer, so the fix belongs there.

Deriving the threshold rather than writing nine matters more than it looks. The number only makes sense relative to the cadence: at a six hour interval a healthy pipeline peaks near six hours old, so nine clears it with margin and still fires after a single missed run. Written as a literal, a later change from six hourly to four hourly would leave a threshold that is quietly too loose, and nothing would fail. Written as a derivation, the relationship is the thing recorded, and a test can bind the relationship instead of the number.

One asymmetry in that margin is worth stating, because the six hour figure above is a peak on one surface and a floor on the other. The reading's age cycles between roughly zero and six hours, so nine hours sits a clear step beyond anything healthy. A forecast's input age does not cycle: `issuePredictions` bounds its history read by the snapped issue slot, which structurally excludes the batch ingested moments earlier, so a perfectly healthy forecast is issued from a reading already about six hours old. The same nine hour threshold therefore leaves about three hours of real headroom on the forecast side against a full cycle on the reading side. It still clears healthy operation, which is the bar **AC-S1**'s invariant sets, but it is closer to the line than the reading case and is the first thing to re examine if the marker turns out to fire more than expected. The follow up on the `issuedAt` knowability bound is what would widen it.

Deriving the input age in memory, rather than adding a column, is the choice most likely to look wrong later and is worth stating plainly. It does recompute something the pipeline already knew. But the page already loads thirty days of observations and shows forecasts only from the last two days, so the input reading for every displayed row is already in memory: the derivation is a pure function over data in hand, not a query. That makes it cheap, testable in the shape this codebase already tests well, and correct for rows issued long before the change. A column would be better if the question were analytical rather than presentational. It is not, yet. The follow up records what would justify revisiting it.

Filtering elapsed rows rather than marking them follows from what the table claims. Its heading is present tense and its purpose is to say what is expected. A row whose target time has passed is not an expectation any more, it is a result awaiting a score, and the scoring surfaces already exist to show that. Keeping it would mean one table mixing two kinds of thing under one heading, which is the sort of quiet category error this project's two timestamp discipline exists to avoid.

## Feature design

**Data model**: unchanged. No migration. Every value this child needs already exists: `Observation.validTime`, `Prediction.issuedAt`, `Prediction.targetTime`, and `PipelineRun.status`.

**Value sourcing**

| Action | Value produced or displayed | Source |
|---|---|---|
| render any panel | the staleness threshold | derived as `ISSUE_INTERVAL_HOURS * 1.5` in `@portfolio/streamflow` config, exported as a named constant |
| gauge panel | age of the newest reading | `now` minus `newestReading.validTime`, both already on the page |
| gauge panel | whether to warn at all | that age compared against the threshold |
| gauge panel | whether the pipeline is failing | `lastRun.status` not `OK`, **or** `lastRun.startedAt` older than the threshold, **or** no run row at all, from the `PipelineRun` read the page already makes |
| forecast table | the input reading for a row | greatest `Observation.validTime` among loaded rows with **both** `validTime <= issuedAt` and `recordedAt <= issuedAt`; `null` if none qualifies, which counts as stale per **AC-S6a** |
| forecast table | a row's input age | that row's `issuedAt` minus the input reading's `validTime` |
| forecast table | whether a row is stale input | that age compared against the same threshold |
| forecast table | whether a row is stale in itself | `now` minus that row's `issuedAt`, against the same threshold (**AC-S5a**) |
| forecast table | whether to mark per row or once | whether every row **surviving the AC-S8 filter** is stale on either count, or only some |
| forecast table | whether a row has elapsed | `targetTime` compared against `now` |
| empty state | elapsed versus never issued | a `findFirst` for any non hindcast prediction at this gauge, **unbounded by the two day window**; the loaded rows cannot answer this (**AC-S9**) |

**Key invariants**

- The threshold is never at or below one ingest interval. A threshold that fires during healthy operation trains readers to ignore it, which is worse than not warning at all.
- The input lookup is bounded on `recordedAt` as well as `validTime`. Treating `validTime` alone as sufficient is the known failure, not a shortcut: the loaded rows are one snapshot as of `now`, and gap recovery writes older `validTime`s with a later `recordedAt`.
- Staleness is evaluated only when the underlying read succeeded. A failed read is a different finding and keeps its existing message.
- No displayed forecast has a `targetTime` at or before `now`.
- The reading figure is never hidden or restyled by staleness. Only text is added.
- Nothing in this child writes to the store.

**Copy**: pinned here rather than left to the build, following the `NOT_A_FLOOD_FORECAST` precedent the attribution child set. This page is unusually tone sensitive: the job is to stop a reader trusting an old number without implying a flood is coming. `{age}` renders in the same relative form the panel already uses ("7 days ago"), and `{hours}` is the derived threshold, never a literal nine.

| Constant | Text |
|---|---|
| `STALE_READING_NOTE` | Last measured {age}, and nothing newer has reached this page since. The river can change a great deal in that time. |
| `REDIRECT` | For the level right now see the USGS gauge, and for a flood warning NOAA's National Water Prediction Service. In an emergency, contact local emergency services. |
| `STALE_INGEST_NOTE` | No ingest run has completed since then either. |
| `ELAPSED_FORECASTS_NOTE` | Every forecast on record has passed the time it was predicting, and none newer has been issued. That means the pipeline has stopped, not that it has not started. |
| `STALE_FORECAST_LEGEND` | Issued more than {hours} hours ago, or from a river reading that old. Either way it does not describe the river as it is now. |
| `EVER_ISSUED_UNKNOWN_NOTE` | No current forecast is showing, and the check for whether any has ever been issued could not be read just now. |

Three things about this table are corrections rather than choices, and are written down so they are not undone.

**`{age}` is the page's existing relative form** ("41 h ago", "3 days ago"), and the sentence is built around it rather than fighting it. The first draft read `This reading is {age} old`, which renders as **"This reading is 41 h ago old"**. Both audit passes caught it and the spec's own copy table produced it, so the fix belongs here and not only in the code.

**`STALE_READING_REDIRECT` is appended to `STALE_READING_NOTE` and carries the same two links the footer block does.** Duplicating them is deliberate. A previous audit measured roughly 3,400px between the numbers and that footer, and `NOT_A_FLOOD_FORECAST` was hoisted for exactly that reason while the actionable half was left behind. Staleness is the state in which a reader most needs somewhere else to go, and it was the state in which the pointer was furthest away.

**`STALE_INGEST_NOTE` covers a stopped scheduler, not only a failed run**, per **AC-S4**, which is why it no longer says "the last ingest run did not complete". It is appended to `STALE_READING_NOTE`, never shown alone: a pipeline fault with fresh data on hand is a maintainer's problem, not a reader's.

The legend is renamed from `STALE_INPUT_LEGEND` because **AC-S5a** widened what it marks: a row now carries it for being old itself, not only for its input being old.

Two rules govern this table, both learned from audit findings rather than chosen up front, and both worth stating because each was broken once.

**A string must be true for every cause that can trigger it.** The legend's second sentence used to say the forecaster "had no newer measurement to work from". When **AC-S5a** is what fired, a one hour old reading is on screen three paragraphs above it, and the page contradicted itself. It is now cause neutral. The same rule caught the per row marker's `title`, which was the one stale string that escaped this table entirely.

**A string must state what is known, not predict what follows.** `STALE_INGEST_NOTE` used to say a newer reading "should not be expected shortly". Ingest runs every six hours and the threshold is nine, so a single skipped run trips it with the next due within three hours, and the sentence was wrong more often than right. It now reports the fact.

**The redirect reaches every state where the page has stopped being current**, which is three: the stale reading, the all stale forecast table, and the stopped or undeterminable empty state. The first version reached only the reading, and a reader can arrive at the other two with a perfectly fresh number on screen. It is deliberately absent from the mixed case, where current rows sit beside stale ones. The emergency clause is part of it and was dropped once already.

**Security model**: unchanged. `/streamflow` is a public read only page with no authentication and no user input. This child adds no endpoint and no parameter.

**Configuration required**: none. No new environment variable, credential or feature flag.

**Critical test scenarios**

- A reading nine hours and one minute old renders the warning; one at exactly the threshold does not, verifies **AC-S1**, **AC-S2**.
- Changing `ISSUE_INTERVAL_HOURS` in the fixture moves the threshold with it, so the test binds the relationship and not the number nine, verifies **AC-S1**.
- A stale reading with the last run `OK` warns about age only; the same reading with the last run `FAILED` also says the pipeline has not ingested, verifies **AC-S4**.
- A forecast issued from a reading ten hours older than its `issuedAt` is marked; one issued from a reading an hour older is not, verifies **AC-S5**, **AC-S6**.
- The gap recovery shape: a forecast issued during an outage, plus a backfilled observation whose `validTime` sits just before that `issuedAt` but whose `recordedAt` is hours after it. The forecast is still marked stale input, and the test fails if the lookup bounds on `validTime` alone, verifies **AC-S6**.
- A forecast with no qualifying observation at all is marked stale rather than treated as fresh, verifies **AC-S6a**.
- The predictor died but ingest did not: a fresh reading, and forecasts issued forty hours ago from an input that was fresh at the time. Every row is marked, and the test fails if staleness is measured only against the input, verifies **AC-S5a**.
- A pipeline stopped for three days renders the elapsed empty state and not the never issued one, with the fixture built only from shapes the scheduler can write (whole six hourly slots, all three horizons), verifies **AC-S9**.
- A scheduler that stopped without recording a failure, so the newest run row is an old `OK`, still says the pipeline is not completing runs, verifies **AC-S4**.
- The reading warning reads as a sentence at nine hours, at thirty hours and at forty days, verifies the Copy table.
- Four stale input rows and two elapsed rows render one note, not per row markers, because the elapsed pair is removed before the count, verifies **AC-S7**, **AC-S8a**.
- Two of six rows stale input renders per row markers; six of six renders one note and no per row markers, verifies **AC-S7**.
- A 24 hour row whose `targetTime` has passed is absent from the rendered table, verifies **AC-S8**.
- A store holding only elapsed forecasts renders the elapsed empty state, and a store holding none at all renders the never issued one, and the two differ in wording, verifies **AC-S9**.
- A rejected observations read still renders the existing failure message and no staleness warning, verifies **AC-S11**.
- The prediction job's tests are unchanged and still pass, verifies **AC-S10**.

## Build plan

Tracer Bullet, matching the parent. The thin thread is the reading warning: one derived constant, one pure predicate, one visible sentence, end to end. Everything after thickens it. The forecast table work depends on nothing in the reading work, but it lands second because the reading is the number a visitor sees first and the one most likely to be acted on.

1. Export the derived threshold from the shared streamflow config beside `ISSUE_INTERVAL_HOURS`, with a test binding the relationship rather than the value. Satisfies **AC-S1**.
2. A pure `isStale(validTime, now, threshold)` predicate and its suite, including the boundary at exactly the threshold. Satisfies **AC-S2**.
3. Render the warning in the gauge panel when stale, keeping the figure untouched, and say the pipeline is not completing runs when the last run failed, is itself older than the threshold, or is absent. End the warning with the redirect and its two links. This is the thin thread; look at it against a seeded store before going wider. Satisfies **AC-S3**, **AC-S4**, **AC-S11**.
4. A pure function returning the input reading for a given `issuedAt` from a list of observations, bounded on `recordedAt` as well as `validTime`, and the input age derived from it. Its suite covers the exact boundary, the gap recovery shape that `validTime` alone gets wrong, and the no qualifying row case that must fail toward disclosure. Satisfies **AC-S5**, **AC-S6**, **AC-S6a**.
5. Filter forecasts whose `targetTime` has passed, and split the empty state into elapsed and never issued, drawing that distinction from an unbounded `findFirst` rather than from the loaded rows. This lands **before** the marking step on purpose: **AC-S7**'s all or some decision is computed over the rows that survive here, so building them the other way round bakes in the wrong count. Satisfies **AC-S8**, **AC-S8a**, **AC-S9**.
6. Mark stale rows in the forecast table, on either count: an input older than the threshold, or an `issuedAt` older than it. Per row when some of the surviving rows are affected, and as one note above the table when all of them are. Satisfies **AC-S5a**, **AC-S7**.
7. Confirm the pipeline is untouched: the prediction and baseline suites unchanged and green, and no write path added. Satisfies **AC-S10**.

## Consequences

**Positive**

- The page stops presenting an unbounded age as current, which was its most direct route to misleading someone about a real river.
- Late and broken become distinguishable to a reader, from the page they are already on, rather than only in the bottom panel nobody scrolls to.
- The forecast table's present tense heading becomes true again.
- No migration, no new query, no pipeline change, so the whole child is reverted by reverting its commits.

**Negative and tradeoffs**

- The page recomputes at render time an input age the pipeline knew at issue time and discarded. That is real duplication, accepted because the alternative is a migration for a display fix.
- Nine hours is a judgement, not a measurement. It clears the observed healthy peak of about six hours with margin, but nothing here establishes it as optimal, and a reader will see nothing during the first nine hours of an outage.
- One threshold now governs two surfaces with different sensitivities. A six hour old input matters more to a 24 hour forecast than to a 72 hour one, and this treats them alike, because scaling by horizon would need a factor nothing here has measured.
- Filtering elapsed rows means that during a long outage the table empties. The empty state says why, but a reader who wanted the last thing the pipeline said no longer sees it on this page.
- Marking behaviour changes shape depending on how many rows are affected, so the table has two visual modes rather than one, and the mixed case is the rarer of the two to catch in review.

**Neutral**

- The threshold constant becomes a second consumer of `ISSUE_INTERVAL_HOURS`, which until now only the scheduler cared about. A cadence change is now a change with a visible public consequence, which is worth knowing before making one.
- This child is display only, so `/check verify` can exercise all of it from the web suite with no database.

## Follow-up

- [ ] Revisit storing the input reading on `Prediction` when the question stops being presentational. The moment it becomes worth answering whether stale input forecasts actually score worse, the derivation here stops being enough and a column earns its migration.
- [ ] Nine hours is unmeasured. Once the pipeline has a few months of run history, check how often it fires and whether a real outage was ever missed under it, and adjust from evidence rather than from the cadence arithmetic used here.
- [ ] The separate `issuedAt` knowability bound follow up, already logged in [0010-forecast-rain.md](0010-forecast-rain.md), is what makes a healthy forecast's input about six hours old in the first place. If that is ever fixed so a live prediction sees the current cycle, the forecast side of this threshold becomes far looser than it needs to be and should be revisited with it.
- [ ] Consider whether the walkthrough should explain the staleness rule, since it explains every other calculation the pipeline performs and this one is now visible to a reader.
