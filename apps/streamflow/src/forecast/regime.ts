import type { StoredObservation } from '../types';

/**
 * What the river was doing at a given moment.
 *
 * This exists because an average over calm days and storm days describes
 * neither. Persistence is about 10 percent wrong when the river is flat and
 * about 30 percent wrong when it is rising, and a single headline number hides
 * exactly the case anyone cares about. Every score carries one of these so the
 * two can be reported apart.
 *
 * FALLING is the fourth class, added by spec 0010's falling regime child. A
 * recession is not a plateau: persistence is roughly unbiased on a crest that
 * is holding, and biased high on every single point of a drain, because the
 * river keeps dropping after the forecast is made. Pooling the two gave PEAK a
 * sample that was half unbiased and half one sided, and quantiles wrong for
 * both halves at once.
 */
export type Regime = 'BASEFLOW' | 'RISING' | 'PEAK' | 'FALLING';

/**
 * Every class, in the order a report should list them.
 *
 * Named here rather than rebuilt at each call site, so a fifth class would
 * show up in every count without anyone remembering to add it.
 */
export const REGIME_CLASSES: readonly Regime[] = [
  'BASEFLOW',
  'RISING',
  'PEAK',
  'FALLING',
];

/** Spec 0010: rising when the 12 hour change is at least this share of the median. */
const RISING_FRACTION_OF_MEDIAN = 0.1;

/**
 * Spec 0010 falling regime child: falling when the 12 hour change is at least
 * this share of `max(v, m)` downward.
 *
 * The same number as the rising fraction, and deliberately a separate constant
 * rather than the same one shared. The two multiply different things, so a
 * shared constant would read as a symmetry the rule does not have.
 */
const FALLING_FRACTION_OF_LEVEL = 0.1;

/** Spec 0010: a peak is at least this multiple of the median. */
const PEAK_MULTIPLE_OF_MEDIAN = 1.5;

const HOUR_MS = 60 * 60 * 1000;
const LOOKBACK_DAYS = 7;
const CHANGE_WINDOW_HOURS = 12;

/**
 * The minimum readings needed before a classification means anything. Seven
 * days at a quarter hour is 672; requiring a third of that tolerates the
 * gauge's real outages without letting a handful of readings decide a regime.
 */
const MIN_LOOKBACK_READINGS = 224;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Classifies the river at `at`, using only readings from before it.
 *
 * The rule, exactly as spec 0010 and its falling regime child state it. Let
 * `v` be the value being classified, `m` the median of the prior seven days
 * and `d` the change over the prior twelve hours. Tested in this order:
 *
 *   RISING   when `d >= 0.1 * m`
 *   FALLING  when `d <= -0.1 * max(v, m)`
 *   PEAK     when `v >= 1.5 * m`
 *   BASEFLOW otherwise
 *
 * The two thresholds deliberately measure against different things, and the
 * asymmetry is the decision rather than an oversight. A rise is driven by rain,
 * an absolute quantity of water arriving in the catchment, so an absolute
 * yardstick suits it and RISING keeps the plain median. A recession decays by a
 * roughly constant fraction, so its absolute rate of fall shrinks as the river
 * drops: measured against the median, a fall from ten times normal would clear
 * the bar for days, right through the flat tail where persistence is easy and
 * accurate again. Measured against `v` it stops when the decay does. The
 * `max(v, m)` floor is there for the other end: below the median a bare
 * fraction of a small number is smaller than ordinary summer drying down, so
 * the median holds the bar where slow predictable drawdown cannot reach it.
 *
 * Order decides everything, and both of the first two tests come before PEAK.
 * A river climbing steeply through a high value is on its way somewhere, and
 * calling that PEAK would file the hardest moment to forecast under the same
 * label as the easy plateau after it. Testing PEAK before FALLING would leave
 * everything above `1.5 * m` in PEAK and give FALLING only the late recession,
 * which is the part most like baseflow and least in need of its own bucket.
 * With FALLING first, PEAK narrows to what the name should always have meant,
 * the crest and the plateau, which is the one condition persistence is
 * unbiased on. The name is kept because renaming an enum value would cost a
 * rewrite of every stored row to buy a better word.
 *
 * Rising and falling can never both hold, because `d` cannot be at once at or
 * above `0.1 * m` and at or below `-0.1 * max(v, m)` while `m` is positive,
 * which the null checks below already guarantee.
 *
 * Returns null when there is not enough history to judge, which the caller
 * must handle rather than defaulting to BASEFLOW: guessing calm would quietly
 * file storm errors under the easy regime and flatter every summary built on
 * top.
 */
export function classifyRegime(
  history: readonly StoredObservation[],
  at: Date,
  valueAt: number,
): Regime | null {
  const instant = at.getTime();
  const windowStart = instant - LOOKBACK_DAYS * 24 * HOUR_MS;

  const prior = history
    .filter((row) => {
      const t = row.validTime.getTime();
      return t >= windowStart && t < instant;
    })
    .map((row) => row.valueCfs);

  if (prior.length < MIN_LOOKBACK_READINGS) return null;

  const m = median(prior);
  if (m <= 0) return null;

  // The reading closest to twelve hours back, so a gap near that instant
  // degrades the comparison rather than voiding the classification.
  const wanted = instant - CHANGE_WINDOW_HOURS * HOUR_MS;
  let earlier: StoredObservation | undefined;
  let bestDistance = Infinity;
  for (const row of history) {
    const t = row.validTime.getTime();
    if (t >= instant) continue;
    const distance = Math.abs(t - wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      earlier = row;
    }
  }

  // More than two hours off the mark is not a twelve hour change any more.
  if (!earlier || bestDistance > 2 * HOUR_MS) return null;

  const change = valueAt - earlier.valueCfs;

  if (change >= RISING_FRACTION_OF_MEDIAN * m) return 'RISING';
  if (change <= -FALLING_FRACTION_OF_LEVEL * Math.max(valueAt, m)) {
    return 'FALLING';
  }
  if (valueAt >= PEAK_MULTIPLE_OF_MEDIAN * m) return 'PEAK';
  return 'BASEFLOW';
}
