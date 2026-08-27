# 0010 child: A falling river gets a regime of its own

## Summary

The regime classifier knows three states: rising, at a peak, and baseflow (a calm river at its normal level). A river that is falling matches none of them, so it lands in baseflow by elimination. That is where the first eight live forecasts went wrong: all eight missed their interval, all in the same direction, because a recession (the long fall after a flood) was being priced with the error history of flat, calm days. This child adds a fourth state, `FALLING`, tested after peak so the peak bucket keeps its samples, and re seeds the error history under the new taxonomy.

## Context

Forecasting went live on 2026-08-25. A flood had crested at 7,470 cubic feet per second on 2026-08-20 and the river was receding through the whole first week: 7147, 5197, 2414, 1206, 826, 607, 456, 392 as daily means.

Of the first 8 live predictions to be scored, 8 fell outside their stated interval. The interval is published at the 80 percent level, so roughly 20 percent should miss. Persistence missed by 33 to 44 percent, every time in the same direction: it forecast too high, because the river kept dropping. Climatology missed by 93 to 94 percent, which is not a fault: late August averages 18 cubic feet per second in 2024 and 46 in 2025, against 2,068 in 2026, so this year is roughly a hundredfold anomaly and climatology is behaving exactly as designed by ignoring current conditions.

Every one of the 48 live predictions issued during the recession carries `issueRegime = BASEFLOW`. The classifier tests rising first (twelve hour change at or above ten percent of the seven day median), then peak (at or above 1.5 times that median), then falls through to baseflow. A receding river fails both tests: its change is negative, and its median falls alongside it so the peak ratio stays under 1.5.

The consequence is not a label problem. The interval comes from a bucket of past errors scoped to (gauge, model, horizon, regime). The seeded persistence bucket at 24 hours holds 2,715 ratio samples, overwhelmingly from genuinely flat days where persistence is around 10 percent wrong, which produces a band of roughly plus or minus 20 percent. On a recession the river falls 30 to 40 percent in a day. The band cannot contain the outcome, and because a prediction's bounds are written once and never recomputed (AC-I11), every forecast issued during a recession keeps that too narrow band permanently.

The seeding hindcast classified past recessions the same way, so the flaw is already inside the seeded quantiles rather than only in live classification.

The full evidence is recorded in [findings/2026-08-27-recession-regime.md](findings/2026-08-27-recession-regime.md).

## Requirements

**User stories**:

- As a visitor, I want the stated interval to mean what it says during a falling river, so the eighty percent claim is not quietly false for a week after every storm.
- As the builder, I want a recession priced from the errors of past recessions rather than the errors of calm days, because those are different populations.
- As the builder, I want the peak bucket left intact, since the peak regime is the one the conditioning exists to serve.

**Acceptance criteria**:

- **AC-F1**: `classifyRegime` returns `FALLING` when the twelve hour change is at or below the negative of `FALLING_FRACTION_OF_MEDIAN` times the seven day median, and the river is neither rising nor at a peak.
- **AC-F2**: the test order is rising, then peak, then falling, then baseflow. A river above 1.5 times its median that is falling stays `PEAK`. This ordering is load bearing, not incidental: see the Rationale.
- **AC-F3**: the `Regime` enum gains `FALLING`. `Prediction.issueRegime` and `Score.regime` accept it. The migration adds the value and rewrites no existing row.
- **AC-F4**: the boundary is inclusive and symmetric with rising. A change of exactly minus ten percent of the median is `FALLING`, exactly as a change of plus ten percent is `RISING`.
- **AC-F5**: after the re seed, every regime and horizon combination clears `MIN_BUCKET_ERRORS` for both baselines. This is measured against the store and reported, never assumed.
- **AC-F6**: the re seed is gated on the zero revision property still holding, re measured against the live store before anything is deleted. It then deletes prior hindcast rows before re running, scores first and predictions second (there is no cascade on the foreign key), and deletes no row where `hindcast` is false.
- **AC-F7**: live predictions issued before this change keep their bounds exactly as written. Nothing recomputes or deletes them, and their scores stand.
- **AC-F10**: those same rows keep `issueRegime = BASEFLOW`, so their errors stay in the baseflow bucket permanently. This is accepted rather than corrected, and the reason is recorded in Consequences.
- **AC-F8**: the dashboard states that forecasts issued before this change were conditioned under a taxonomy with no falling state, so their intervals were too narrow during the recession of late August 2026. The cutover is named as a date in the disclosure text. No per prediction marking is added: AC-F7 leaves those rows untouched, and marking them would mean writing to rows this spec has just promised not to touch.
- **AC-F9**: a test proves a slot inside a real recession classifies `FALLING` rather than `BASEFLOW`, and that a slot high on a falling limb still classifies `PEAK`.

## Options considered

### Option 1: a fourth state, `FALLING`, tested after peak (chosen)

Add one enum value. Test it after the peak test, so a river that is both high and falling stays `PEAK` and only the longer, lower tail of the recession becomes `FALLING`.

**Pros**:

- Fixes the observed failure. The eight misses happened at 642 down to 400 against a median near 1,200, well under the peak threshold, so they land in `FALLING` under this rule.
- Measured against the record: `FALLING` takes 405 of 3,879 issue slots while `PEAK` keeps all 304. Both clear the thirty error minimum comfortably.
- Symmetric with rising, so the classifier stays one readable rule set rather than a rule plus an exception.

**Cons**:

- `PEAK` now covers both the crest and the steep early fall, two things with different error behaviour. The name becomes slightly less honest than it was.
- A fourth bucket is a fourth thing that can go thin, and it splits the error history four ways rather than three.
- Costs a migration and a full re seed.

### Option 2: a fourth state, tested before peak

The same enum value, but a falling river is falling whatever its height.

**Pros**:

- Hydrologically purer. The recession limb is one thing and would be labelled one thing.
- Cleanest possible statement of the rule.

**Cons**:

- Measured: `PEAK` collapses from 304 slots to 47. A bucket is scoped per model and per horizon, so that is roughly 47 ratio samples, barely above the thirty minimum, and thinner still for climatology which cannot answer during the first year of the record.
- It guts the one regime the whole conditioning exists to serve. The parent spec's AC-21 exists because pooling across regimes makes storm intervals far too narrow; this option reintroduces that failure at the peak.

### Option 3: make the rising test signed

One rule catches change in either direction, no new enum value, no migration.

**Pros**:

- Smallest possible change. No migration, no re seed, no new bucket.
- Fewer states to reason about.

**Cons**:

- A rise and a fall have opposite error signatures: persistence under forecasts on a rise and over forecasts on a fall. Pooling them produces a band centred on roughly zero bias that fits neither, which is the same mistake at a smaller scale.
- The regime label would then say nothing about direction, so the scorecard could no longer report the two apart.

### Option 4: sub bucket baseflow by rate of change

Keep three states, split the bucket underneath them.

**Pros**:

- No enum change and no migration.
- The interval improves without the taxonomy moving.

**Cons**:

- `issueRegime` would say `BASEFLOW` while the bounds came from a hidden sub bucket. The stored provenance would be a lie, and AC-I11 exists specifically so an interval can be explained after the fact.
- Reporting still cannot split recessions out, so the scorecard could not show what was just discovered.

## Decision

**Chosen option**: Option 1, a fourth state `FALLING`, tested after peak.

`classifyRegime` gains a falling test at the negative of the existing rising fraction, placed after the peak test, and the `Regime` enum gains a fourth value. The seeded error history is rebuilt under the new taxonomy by re running the hindcast.

**Implementation skills**: `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`)

## Rationale

The ordering is the whole decision, and it was settled by measurement rather than taste. Testing falling before peak reads better on paper: a river that is falling is falling, regardless of how high it sits. But run over the 3,879 issue slots in the record, that ordering moves 257 of the 304 peak slots into falling, leaving peak with roughly 47 ratio samples per bucket against a thirty sample minimum. The parent spec chose regime conditioning precisely so that storm intervals would not be set by calm day errors (AC-21), and the peak regime is the sharp end of that. Buying a tidier taxonomy by starving the bucket it exists for is the wrong trade, and the intervals child already refused a similar trade when it declined to pick a placeholder width without measuring.

Testing falling after peak keeps peak whole at 304 slots and still gives falling 405, and it fixes the case actually observed: the eight misses occurred at 642 down to 400 cubic feet per second against a seven day median near 1,200, comfortably below the 1.5 multiple, so they classify falling under this rule. What the ordering costs is honesty about the peak label: `PEAK` now spans the crest and the steep early recession together. That is a real loss and it is recorded in Consequences rather than argued away. The follow up asks whether peak should later split into a crest state and a steep fall state, once there is enough of a record to measure whether they behave differently.

Reusing the rising fraction rather than inventing a new threshold is a starting assumption, not a measured result, and it is worth being exact about the difference. The measurement swept three candidate thresholds and reported how many slots each captured: at minus twenty percent the gentler part of a recession stays in baseflow where the problem began, and at minus five percent falling swallows 1,212 slots and starts eating genuinely calm days. That is population size, not calibration quality. It says nothing about whether a symmetric magnitude is the right number for a limb that is physically gentler than a rise, because rivers rise fast and fall slowly. Ten percent in either direction is one idea stated once, which is worth something on its own, and it is the honest place to start. The two constants stay separate in code so they can diverge without a rename, and the follow up below asks the second recession to measure coverage rather than population, which is the evidence this choice actually needs.

## Feature design

**Data model changes**

One migration, adding a value to an existing enum:

```sql
ALTER TYPE "Regime" ADD VALUE 'FALLING';
```

No column is added, altered, or dropped. No existing row changes. Both `Prediction.issueRegime` and `Score.regime` are already nullable columns of type `Regime` and accept the new value without further change. The index on `(gaugeId, modelVersionId, horizonHours, issueRegime)` is unaffected.

Note for the build: Postgres does not allow `ALTER TYPE ... ADD VALUE` inside a transaction block in the same statement batch that then uses the new value. Generate the migration and let it stand alone; do not hand write it into a migration that also inserts rows using `FALLING`.

**State transitions**

The classifier is a decision ladder, not a state machine. The order is now:

1. `RISING`, when the twelve hour change is at or above `RISING_FRACTION_OF_MEDIAN` times the median.
2. `PEAK`, when not rising and the current value is at or above `PEAK_MULTIPLE_OF_MEDIAN` times the median.
3. `FALLING`, when not rising and not at a peak and the twelve hour change is at or below the negative of `FALLING_FRACTION_OF_MEDIAN` times the median.
4. `BASEFLOW`, otherwise.
5. `null`, whenever there is not enough history to judge, exactly as today.

**Value sourcing**

| Action | Value produced | Source |
|---|---|---|
| classify a slot | the seven day median | derived: median of readings with `validTime` in the prior seven days, unchanged |
| classify a slot | the twelve hour change | derived: newest reading minus the reading nearest twelve hours earlier, unchanged |
| classify a slot | the falling threshold | new constant `FALLING_FRACTION_OF_MEDIAN`, 0.1, in `config.ts` beside the rising fraction |
| classify a slot | the regime label | derived: the ladder above; `null` when fewer than `MIN_LOOKBACK_READINGS` readings exist |
| build an interval | which bucket to draw from | unchanged: `Prediction.issueRegime`, which now may be `FALLING` |
| report a score | the regime at the target instant | unchanged: `Score.regime`, which now may be `FALLING` |
| dashboard | the early taxonomy disclosure | constant text, required by AC-F8 |

**Key invariants**

- The ladder is ordered and total. Every classifiable slot gets exactly one label, and every unclassifiable slot gets `null` rather than a guess.
- Rising and falling are mirror tests at mirror thresholds. If one is changed without the other, the classifier no longer means one thing.
- A prediction's bounds are written once and never recomputed. This change alters what future predictions get, never what past ones got (AC-F7).
- The hindcast remains the only caller of the loose knowability axis, unchanged by this decision.
- After the re seed, no bucket in use falls below `MIN_BUCKET_ERRORS`. Measured, not assumed.

**Configuration required**

None. `FALLING_FRACTION_OF_MEDIAN` is a source constant in `config.ts`, not an environment variable, exactly as the rising fraction is.

**Critical test scenarios**

- A slot inside the late August 2026 recession classifies `FALLING`, not `BASEFLOW`, verifies **AC-F1**, **AC-F9**.
- A slot high on the falling limb, above 1.5 times the median, still classifies `PEAK`, verifies **AC-F2**, **AC-F9**.
- A change of exactly minus ten percent of the median classifies `FALLING`, mirroring the existing exactly plus ten percent rising test, verifies **AC-F4**.
- A rising river still classifies `RISING` and a flat river still classifies `BASEFLOW`, so the change adds a branch without moving the existing ones, verifies **AC-F2**.
- Too little history still returns `null` rather than falling through to a label, verifies **AC-F1**.
- After the re seed, a bucket size report shows every regime and horizon combination at or above thirty for both baselines, verifies **AC-F5**.
- The public read helper returns no hindcast rows after the re seed, unchanged from AC-I14 and AC-H8, verifies **AC-F6**.

## Build plan

Tracer Bullet, matching the rest of 0010. The thin thread is one slot classifying `FALLING` end to end; the rest thickens it.

1. Add `FALLING` to the `Regime` enum, generated as its own migration against a throwaway. Satisfies **AC-F3**.
2. Add `FALLING_FRACTION_OF_MEDIAN` to `config.ts` and the falling branch to `classifyRegime`, placed after the peak test, with tests covering the ladder order, both boundaries, and the unchanged branches. Satisfies **AC-F1**, **AC-F2**, **AC-F4**, **AC-F9**.
3. Re measure the zero revision property against the live store before touching anything: count `validTime` values carrying more than one row. If it is not zero, halt and revisit the hindcast child's loose axis decision before re seeding, because the walk's soundness rests on that property. This is a gate, not a note. Satisfies **AC-F6**.
4. Re seed: delete hindcast scores, then hindcast predictions, then re run the hindcast against the live store, watched. Satisfies **AC-F6**.
5. Report bucket sizes per regime, model and horizon after the re seed, and record the numbers in this spec's follow up. Satisfies **AC-F5**.
6. Add the disclosure to the dashboard beside the existing interval footnotes. Satisfies **AC-F8**.
7. Confirm live predictions issued before the change are untouched and still scored, and that their `issueRegime` is unchanged. Satisfies **AC-F7**, **AC-F10**.

## Migration plan

**Strategy**: one schema migration plus a one time data rebuild.

**Phases**:

1. Ship the enum value and the classifier change together. The enum value is inert until something writes it; the classifier writes it from the first run after deploy.
2. Re seed by hand, before the next scheduled prediction if possible. Two ordered deletes (`hindcast` scores, then `hindcast` predictions), then re run the hindcast. Roughly thirty to sixty minutes of sequential round trips against a hosted database, watched rather than left.
3. Let the crons proceed. From the first scheduled run onward, a falling river draws on falling errors.

**Rollback**: the code reverts as one commit. The enum value cannot be removed from Postgres without recreating the type, so a revert leaves `FALLING` in the enum, unused and harmless. The re seeded rows revert the same way they were made: delete hindcast scores, delete hindcast predictions, re run the hindcast on the reverted classifier.

**Risks**:

- Re seeding while the crons are running risks the same collision the hindcast child names. The prediction unique key does not include `hindcast`, so a live run reaching the same issue slot wins and the walk's row disappears. The walk now counts and reports skipped rows, so this is visible, but sequencing still matters.
- Between the deploy and the re seed, live forecasts are classified `FALLING` while the buckets still hold no falling errors. Those predictions fall to the pooled fallback and are marked unseeded, which is correct behaviour but produces a visible stretch of wider intervals.
- The zero revision property that the hindcast's loose axis rests on must be re measured before this re run, per the follow up already recorded in the hindcast child. If revisions have accumulated, that decision needs revisiting before the walk, not after.

**On the evidence bar, and a contradiction worth naming.** During the design conversation two recommendations were given that do not agree: one said to hold the merge until a second recession confirms the finding, the other said to merge now and re seed at merge. Both were accepted. This spec is written on the reconciliation: merge and re seed now, so that the confirming recession is itself recorded under the correct taxonomy, and treat that second event as a documented validation checkpoint rather than a gate. The reasoning is that delaying the merge does not preserve optionality, it spends it: the next recession would be permanently recorded with intervals we already believe are wrong. If the second event disagrees with the first, the follow up below is the route back.

## Consequences

**Positive**

- A recession is priced from recessions. The eighty percent claim becomes true during the week after a storm, which is when a river forecast is most worth reading.
- The scorecard can report recessions apart from calm days, so the next finding of this kind is visible in the chart rather than only in the database.
- The peak bucket is untouched, so the regime the conditioning exists for keeps its full sample.
- The change is small: one enum value, one branch, one constant. Nothing about the interval maths, the bucket query, or the knowability axis moves.

**Negative and tradeoffs**

- `PEAK` now spans the crest and the steep early recession, which are not the same thing. The label is less honest than it was, and this is a real cost accepted for the sake of the sample size.
- The error history is split four ways rather than three, so every bucket is thinner than before. Measured, all still clear the minimum, but the margin is smaller.
- The forty eight live predictions issued during the first recession keep their too narrow intervals forever, and eight of them are already scored as misses. That stretch of the public record will always look bad, and it should.
- Those same forty eight rows also keep `issueRegime = BASEFLOW`, so recession errors stay inside the calm day bucket permanently. That is this spec's own failure mode surviving at small scale, and it is accepted deliberately. The size is why: forty eight predictions is eight issue slots, so roughly eight ratios per bucket against about 2,424 after the re seed, near a third of one percent. The alternative is rewriting `issueRegime` on live rows, which contradicts AC-F7 and edits a public record to make it look better, and that is a worse thing to do than carry a third of a percent of noise.
- A re seed is a rebuild of eighteen thousand rows. It is safe and idempotent, but it is not free and it must be watched.
- The finding rests on eight correlated observations. The mechanism is legible from the classifier's own rules, but the magnitude is not yet measured across more than one event.

## Follow-up

- [ ] After the re seed, record the measured bucket sizes per regime, model and horizon here, so a future reader can see the margin above the thirty minimum rather than trusting that it was checked.
- [ ] Validate against the second recession. If falling intervals cover at roughly the stated eighty percent, the finding is confirmed. If they do not, the threshold or the ordering needs revisiting before more of the public record accumulates.
- [ ] Consider whether `PEAK` should later split into a crest state and a steep fall state, once enough storms are on record to measure whether the two behave differently. This spec deliberately merged them to protect the sample.
- [ ] Re measure the zero revision property before the re run, per the follow up in [0010-hindcast-seeding.md](0010-hindcast-seeding.md). It was 0 of 86,509 on 2026-08-25.
- [ ] Reconcile the parent, which now contradicts AC-F3 in three places: **AC-12** names a regime of `BASEFLOW`, `RISING` or `PEAK`; the data model sketch lists `Regime` as those same three; and the **Value sourcing** row for `regime` states the three way ladder as the derived rule. The third matters most, because it is the rule itself rather than a mention of it.
- [ ] The parent's AC-21 says interval bounds are conditioned on regime without naming which regimes exist. Consider pointing it at this child now that the set has changed.
- [ ] The second recession should measure interval **coverage** (what share of outcomes land inside the stated eighty percent band), not just whether the finding reproduces. Coverage is the evidence the symmetric threshold actually needs, and the first measurement did not provide it.
