# Finding: the median floor holds recession like scores in baseflow

**Observed**: 2026-08-28, against the production pipeline store, after the first falling regime migration had been applied.
**Status**: measurement, not a decision. It is the evidence [0010-falling-denominator.md](../0010-falling-denominator.md) rests on.

## Why this exists

[2026-08-27-falling-threshold-misses-tail.md](2026-08-27-falling-threshold-misses-tail.md) showed the shipped falling rule catches none of the four issue slots that produced the eight observed misses. That finding covers 32 slots from one recession and says so itself: "a sweep over eight days of one event, so it is a direction to investigate and not a recommendation."

This closes that gap. It asks two questions over the whole record rather than one event. First, how much of the record each candidate threshold would call falling. Second, and decisively, whether the slots the median floor holds back actually behave like recessions or like calm days.

## Method

Run against the live pipeline database, read only, on 2026-08-28.

1. Every distinct `(issuedAt, hindcast)` prediction slot was read from `predictions`, and the gauge's whole observation record from `observations`.
2. For each slot, history was reconstructed with `asOfWalk` bound at that slot's `issuedAt`, on the `validTime` axis for hindcast slots and `recordedAt` otherwise, which is the same reconstruction `backfill-regime.ts` performs.
3. From that history, three numbers were derived exactly as `classifyRegime` derives them: `v` from `persistenceForecast`, `m` as the median of the prior seven days, and `d` as `v` minus the reading nearest twelve hours back. Slots failing any of the three null conditions were dropped.
4. That left **3,644 classifiable slots**. Each candidate rule was then evaluated over those same three numbers, so every rule sees identical inputs.
5. For the bias measurement, each prediction was labelled under both the shipped rule and `-0.1 * v`, then joined to its scores. Ratios are `actualCfs / centralCfs` for the persistence baseline only, because climatology's errors are dominated by the fact that it ignores current conditions and would swamp the signal. Groups under 25 scores were dropped.

These numbers are a point in time reading of a store that keeps growing. Re running the sweep after another pipeline or scoring pass returns figures a slot or a few scores different, and that is the store moving rather than the method disagreeing. The shape is what matters, and the shape is stable.

It is committed as `apps/streamflow/scripts/sweep-falling-threshold.ts` and takes no arguments: `npx tsx apps/streamflow/scripts/sweep-falling-threshold.ts`, read only.

## Bucket share by candidate threshold

Over 3,644 classifiable slots. `RISING` is identical in every row because the rising test is untouched.

| rule | RISING | FALLING | PEAK | BASEFLOW |
|---|---|---|---|---|
| `-0.10 * max(v, m)`, shipped | 522 (14%) | 607 (17%) | 89 (2%) | 2,426 (67%) |
| `-0.10 * v` | 522 (14%) | 872 (24%) | 89 (2%) | 2,161 (59%) |
| `-0.15 * v` | 522 (14%) | 515 (14%) | 128 (4%) | 2,479 (68%) |
| `-0.20 * v` | 522 (14%) | 351 (10%) | 164 (5%) | 2,607 (72%) |
| `-0.25 * v` | 522 (14%) | 259 (7%) | 186 (5%) | 2,677 (73%) |

Two things worth reading off this table.

**`PEAK` is bit for bit identical between the shipped rule and `-0.10 * v`**, at 89 slots. That is not a coincidence and not an artifact. `PEAK` requires `v >= 1.5 * m`, which forces `v > m`, which makes `max(v, m)` resolve to `v`. The two rules are the same function everywhere above the median. The floor's entire effect is confined to slots below it.

**The floor moves exactly 265 slots**, all of them from `FALLING` into `BASEFLOW` (872 minus 607, matching 2,426 minus 2,161). That is the whole of what it does.

The one week sweep in the earlier finding suggested `-0.10 * v` would label 26 of 32 slots falling, which read as though the class would swallow the record. Over two and a half years it is 24 percent, not 81. The earlier figure was measured during a recession week, where nearly every slot genuinely is falling.

## The decisive measurement: are those 265 slots calm?

The floor exists to keep ordinary drying out of the falling class. So the question is whether the slots it excludes are ordinary. Persistence forecasts the current reading, so on an unbiased population the ratio of actual to forecast sits near 1.0 with about half the forecasts high; on a recession it sits below 1.0 with most forecasts high, because the river keeps dropping after the forecast is made.

| group | scores | median ratio | forecasts too high |
|---|---|---|---|
| stays `BASEFLOW` | 6,246 | 0.970 | 56% |
| **`BASEFLOW` to `FALLING`** | **742** | **0.816** | **80%** |
| stays `FALLING` | 1,741 | 0.727 | 81% |
| stays `PEAK` | 247 | 0.831 | 74% |
| stays `RISING` | 1,538 | 0.910 | 57% |

The 742 scores the floor holds in `BASEFLOW` are one sided. At 0.816 and eighty percent high they sit beside the 0.727 and eighty one percent of rows already called falling, and nowhere near genuine baseflow at 0.970 and fifty six percent, which is close to the unbiased shape you would expect.

So the floor is not protecting the class from calm days. It is holding 742 recession like scores inside a bucket of 6,988, where their bias is averaged into a population that does not share it.

## The low flow guard

Measured separately, because `-0.1 * v` has no lower bound: as `v` shrinks the threshold shrinks with it, and at the limit any decline whatsoever qualifies.

On this gauge that is currently theoretical. The minimum observation in 86,833 readings is 11.1 cubic feet per second, there are no zeros and nothing under 5. The frozen `flowFloorCfs` on the gauge, the 5th percentile of the record, is 18.9.

| | |
|---|---|
| slots where `max(v, flowFloorCfs)` differs from plain `v` | **3** of 3,644 |
| slots with `v` below the floor | 190 |
| lowest `v` at any slot | 11.4 |
| of those 190, labelled falling under plain `v` | 6 |

Three slots. The guard is not justified by what it changes today; it is justified by bounding a threshold that otherwise vanishes. It is worth distinguishing from the floor this finding argues against: `flowFloorCfs` is frozen once from the whole record and cannot be moved by an event, while the seven day median is a rolling window that a flood inflates to forty times the floor's value, which is the exact mechanism that broke it.

## What this does not establish

- **One gauge, one climate, roughly two and a half years.** Big Darby Creek is unregulated and flashy. A gauge with a flatter regime may not show the same separation.
- **The marginal group is still biased.** At 0.816 rather than 0.970, the population `-0.1 * v` adds is not merely borderline, which hints a looser threshold would catch more real recession. Thresholds below 0.10 were not swept.
- **`PEAK` at 0.831 is unexplained.** After the split it should be close to unbiased and it is not, over 247 scores. Either a crest is genuinely hard to forecast, or `PEAK` still mixes the crest with the first hours of the drop. Not investigated here.
- **Climatology was excluded** from the bias measurement. Nothing here says the split is equally useful for a forecaster that ignores current conditions by design.
