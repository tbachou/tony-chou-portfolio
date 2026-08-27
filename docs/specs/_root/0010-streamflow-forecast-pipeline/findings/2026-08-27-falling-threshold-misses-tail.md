# Finding: the falling threshold does not reach the part of the recession that failed

**Observed**: 2026-08-27, while building the falling regime child, from the real USGS record for gauge 03230500.
**Status**: observation, not a decision. The falling regime was built exactly as the child spec decided it. What to do about the threshold is for `/architect`.

## What was checked

The child spec's Rationale says the chosen rule fixes the case actually observed:

> the eight misses occurred at 642 down to 400 cubic feet per second against a
> seven day median near 1,200, comfortably below the 1.5 multiple, so they
> classify falling under this rule.

That claim was tested against the real record rather than assumed. Every six hourly issue slot from 2026-08-20 to 2026-08-27 was classified under the new ladder, using the gauge's own fifteen minute readings pulled from the USGS instantaneous values service, with a complete seven day lookback for every slot.

## What it shows

The rule does not reclassify the slots that failed. It catches the steep early limb and then hands the rest of the recession back to `BASEFLOW`, which is where the misses happened.

| issue slot | value | 7 day median | 12 h change | falling threshold | label |
|---|---|---|---|---|---|
| 08-21 12:00 | 5330 | 3020 | -1150 | -302 | `PEAK` |
| 08-22 00:00 | 4260 | 3320 | -1070 | -332 | `FALLING` |
| 08-22 12:00 | 2000 | 3470 | -2260 | -347 | `FALLING` |
| 08-23 00:00 | 1470 | 3470 | -530 | -347 | `FALLING` |
| 08-23 06:00 | 1320 | 3470 | -320 | -347 | `BASEFLOW` |
| **08-25 12:00** | 614 | 1720 | -92 | -172 | **`BASEFLOW`** |
| **08-25 18:00** | 575 | 1595 | -67 | -160 | **`BASEFLOW`** |
| **08-26 00:00** | 525 | 1500 | -89 | -150 | **`BASEFLOW`** |
| **08-26 06:00** | 479 | 1410 | -96 | -141 | **`BASEFLOW`** |

The four rows in bold are the exact issue slots that produced the eight scored misses in [2026-08-27-recession-regime.md](2026-08-27-recession-regime.md). All four stay `BASEFLOW`.

`FALLING` covers five slots, roughly thirty hours, out of a recession that ran for a week.

## Why the claim came apart

Being below the peak multiple only settles that a slot is not `PEAK`. It does not make it `FALLING`, because the falling test has a threshold of its own, and the observed slots never reach it.

The reason they never reach it is the denominator. The seven day median stays inflated by the flood long after the river has left it behind, so a percentage of the median is an enormous number compared to where the river now sits. Late in the recession the creek is falling hard in its own terms and barely moving in the median's terms:

| issue slot | fall as share of the median | fall as share of the current value |
|---|---|---|
| 08-25 12:00 | 5.3% | 15.0% |
| 08-25 18:00 | 4.2% | 11.7% |
| 08-26 00:00 | 5.9% | 17.0% |
| 08-26 06:00 | 6.8% | 20.0% |

A river shedding a fifth of itself every twelve hours is a recession by any reading. Measured against a median still carrying a 7,470 crest, it looks like a flat day.

The spec's own figures point the same way once they are checked. It puts the median at those slots near 1,200; the real medians are 1,720, 1,595, 1,500 and 1,410. The 1,200 median arrives on 08-27, after the last of the eight misses was issued.

## What a different threshold would do

Swept over these thirty two real slots. The first two columns are the rule as specced, with only the number changed.

| threshold | slots labelled falling | observed miss slots caught |
|---|---|---|
| -20% of the median | 4 of 32 | 0 of 4 |
| **-10% of the median (chosen)** | **8 of 32** | **0 of 4** |
| -7.5% of the median | 11 of 32 | 0 of 4 |
| -5% of the median | 20 of 32 | 3 of 4 |
| -3% of the median | 26 of 32 | 4 of 4 |

This matters for the option the spec already rejected. It weighed -5% and set it aside because it swallowed 1,212 slots across the full record and would start eating genuinely calm days. That judgement stands, and this adds to it: -5% would still have missed one of the four, so the rejected option would not have fixed the observed failure either. No threshold on this axis both catches the event and leaves calm days alone.

Changing the axis rather than the number behaves differently. Measuring the fall against the current value instead of the seven day median:

| threshold | slots labelled falling | observed miss slots caught |
|---|---|---|
| -20% of the current value | 15 of 32 | 1 of 4 |
| -15% of the current value | 18 of 32 | 2 of 4 |
| -10% of the current value | 26 of 32 | 4 of 4 |

This is a sweep over eight days of one event, so it is a direction to investigate and not a recommendation. What it does establish is that the median is the part of the rule doing the damage, not the magnitude.

## What this is not

- Not a defect in the build. The classifier implements the child spec's decision exactly: the ladder order, the symmetric magnitude, and the separate constant are all as specified, and the tests prove them.
- Not a reason the change is worthless. `FALLING` still separates the steep limb from calm days, which is a real population split that did not exist before, and the peak bucket is still protected.
- Not a contradiction of the original finding. A recession is still mis bucketed. This says the fix reaches a shorter stretch of it than the spec believed.

## Confidence

**High on the mechanism and on these numbers, thin on generality.** Every figure here is measured from the gauge's own record with complete lookback windows, and the classifications are reproduced as assertions in `regime.spec.ts`, including the four slots that stay `BASEFLOW`. It is still one event. Whether the median denominator fails this way after every flood, or only after one this large, needs the second recession.

## Questions for `/architect`

1. Should the falling test measure the twelve hour change against the current value rather than the seven day median? The median is what makes a real recession look flat once the flood has left the window.
2. If the threshold or the axis is going to move, is it worth re seeding twice, or should the re seed wait until that question is settled? The child spec's reasoning for re seeding now is that the next recession should be recorded under the correct taxonomy, and that reasoning gets weaker if the taxonomy is about to change again.
3. The child spec's Rationale states as measured fact that the eight misses classify falling under this rule. It does not. Does that change the merge and re seed now decision it was used to justify?
4. Does the dashboard disclosure need to say that the fix reaches only the steep part of a recession? It currently states the historical flaw, which is true, and stops short of claiming the tail is solved.
