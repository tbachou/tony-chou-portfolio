# Finding: a falling river has no regime of its own

**Observed**: 2026-08-27, from the live scorecard, two days after forecasting was switched on.
**Status**: observation, not a decision. It is written down so the evidence survives; what to do about it is for `/architect`.

## What was seen

Of the first 8 live predictions to be scored, **8 fell outside their interval**. The interval is stated at the 80 percent level, so roughly 20 percent should miss. All 8 missed, and every persistence miss was in the same direction: the forecast was too high.

| issued | forecaster | central | interval | actual | error |
|---|---|---|---|---|---|
| 08-25 12:00 | persistence 24h | 642 | 514 to 786 | 462 | 39.0% |
| 08-25 18:00 | persistence 24h | 614 | 492 to 752 | 425 | 44.5% |
| 08-26 00:00 | persistence 24h | 581 | 465 to 711 | 420 | 38.3% |
| 08-26 06:00 | persistence 24h | 507 | 406 to 621 | 381 | 33.1% |
| 08-25 12:00 | climatology 24h | 26 | 6 to 105 | 462 | 94.3% |
| 08-25 18:00 | climatology 24h | 26 | 6 to 105 | 425 | 93.8% |
| 08-26 00:00 | climatology 24h | 26 | 6 to 105 | 420 | 93.8% |
| 08-26 06:00 | climatology 24h | 26 | 6 to 105 | 381 | 93.1% |

## The context that explains it

A flood crested at **7,470 cfs on 2026-08-20**. The river has been receding since:

```
Aug 20  7147      Aug 24   826
Aug 21  5197      Aug 25   607
Aug 22  2414      Aug 26   456
Aug 23  1206      Aug 27   392
```

Every one of the 48 live predictions issued during that recession carries `issueRegime = BASEFLOW`.

## Climatology is not at fault

A central estimate of 26 cfs against an actual of 420 looks like a defect. It is not. Late August, by year, across the record:

| year | mean | range |
|---|---|---|
| 2024 | 18 cfs | 15 to 22 |
| 2025 | 46 cfs | 41 to 61 |
| 2026 | **2,068 cfs** | 367 to 7,470 |

So 26 cfs is the correct seasonal answer and 2026 is roughly a hundredfold anomaly. Climatology ignores current conditions by design, which is the whole reason it is on the chart. Its error here is honest and it needs no change.

## The actual gap

`classifyRegime` has three states, and a falling limb matches none of them:

- not `RISING`, because the twelve hour change is negative
- not `PEAK`, because that needs at least 1.5 times the seven day median, and the median is falling with the river
- therefore `BASEFLOW`, by elimination

So a recession is filed in the bucket that describes it least. The seeded persistence bucket at 24 hours holds **2,715 ratio samples**, overwhelmingly from genuinely flat days where persistence is around 10 percent wrong. Its quantiles produce a band of roughly plus or minus 20 percent. On a recession limb the river falls 30 to 40 percent in 24 hours, so persistence over predicts every time and the band is far too narrow to contain the outcome.

The hindcast classified past recessions the same way, so the flaw is already inside the seeded quantiles rather than only in live classification. A bucket mixing flat days with recessions has quantiles set by the flat majority.

## What this is not

- Not a bug in scoring, the interval maths, or the seeding. Every one of those did exactly what it is specified to do.
- Not a calibration failure of the 80 percent level in general. It is a failure of the regime taxonomy to separate two populations with different error behaviour.

## Confidence

**Directionally clear, statistically thin.** Eight samples, and they are not independent: four consecutive persistence forecasts through a single recession event, plus four climatology forecasts of the same event. One more recession would settle it. The mechanism is nonetheless legible from the classifier's own rules and does not depend on the sample.

## Questions for `/architect`

1. Does the taxonomy gain a fourth state (a falling or recession regime), or does the rising test become signed so that a steep fall is caught by the same rule?
2. If a state is added, the seeded buckets were built under the old taxonomy. Does the hindcast re run, and does the re measure of the zero revision property that the seeding child asks for happen first?
3. `PEAK` is defined against the seven day median, which tracks a recession downward. Is that definition doing what was intended during a multi day fall?
4. Is the 80 percent interval level still the right claim to publish while a known population is mis bucketed?
