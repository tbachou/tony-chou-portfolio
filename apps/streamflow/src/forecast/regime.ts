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
 * FALLING was added after the fact, and the reason is worth keeping. The first
 * eight live forecasts to be scored all missed their stated eighty percent
 * interval, all in the same direction, because the river was receding from a
 * flood and a receding river matched none of the other three. It landed in
 * BASEFLOW by elimination, so a recession was priced from the errors of flat,
 * calm days. See the 0010 child spec on the falling regime.
 */
export type Regime = 'BASEFLOW' | 'RISING' | 'PEAK' | 'FALLING';

/** Spec 0010: rising when the 12 hour change is at least this share of the median. */
const RISING_FRACTION_OF_MEDIAN = 0.1;

/**
 * Spec 0010 child: falling when the 12 hour change is at least this share of
 * the median downward.
 *
 * Deliberately a separate constant holding the same number as the rising
 * fraction rather than a reuse of it. Ten percent either way is one idea
 * stated once, which is the honest place to start, but it is a starting
 * assumption and not a measured result: rivers rise fast and fall slowly, so
 * the magnitude that separates a real recession from a calm day may not be the
 * one that separates a real rise. Kept apart so the two can diverge on
 * evidence without a rename.
 */
const FALLING_FRACTION_OF_MEDIAN = 0.1;

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
 * The rule, exactly as spec 0010 and its falling regime child state it: let
 * `m` be the median of the prior seven days and `d` the change over the prior
 * twelve hours. It is RISING when `d` is at least ten percent of `m`; PEAK
 * when it is not rising but sits at least 1.5 times `m`; FALLING when it is
 * neither of those and `d` is at least ten percent of `m` downward; BASEFLOW
 * otherwise.
 *
 * The order of the ladder is the whole decision, and both placements were
 * settled by measurement rather than taste.
 *
 * Rising is tested first because a river climbing steeply through a high value
 * is on its way somewhere, and calling that PEAK would file the hardest moment
 * to forecast under the same label as the easy plateau after it.
 *
 * Falling is tested after peak, which reads worse on paper: a river that is
 * falling is falling, however high it sits. Run over the 3,879 issue slots in
 * the record, testing falling first moves 257 of the 304 peak slots into
 * falling and leaves peak with roughly 47 samples per bucket against a
 * thirty sample minimum. Regime conditioning exists so that storm intervals
 * are not set by calm day errors, and peak is the sharp end of that, so
 * buying a tidier taxonomy by starving the bucket it exists for is the wrong
 * trade. Tested after peak, peak keeps all 304 slots and falling still gets
 * 405. The cost is that PEAK now spans the crest and the steep early
 * recession together, which are not the same thing.
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

  // Ordered and total: every classifiable slot gets exactly one label. Rising
  // and falling are mirror tests at mirror thresholds, so changing one without
  // the other stops the classifier meaning one thing.
  if (change >= RISING_FRACTION_OF_MEDIAN * m) return 'RISING';
  if (valueAt >= PEAK_MULTIPLE_OF_MEDIAN * m) return 'PEAK';
  if (change <= -FALLING_FRACTION_OF_MEDIAN * m) return 'FALLING';
  return 'BASEFLOW';
}
