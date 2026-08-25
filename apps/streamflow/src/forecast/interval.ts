import {
  INTERVAL_LEVEL,
  INTERVAL_QUANTILE_HIGH,
  INTERVAL_QUANTILE_LOW,
  MIN_BUCKET_ERRORS,
  PLACEHOLDER_BAND_FACTOR,
} from '../config';

/**
 * How wide a forecast's range should be, drawn from how wrong the same
 * forecaster has been before in similar conditions.
 *
 * Everything here is pure. It takes a central estimate and the ratios of past
 * outcomes to past predictions, and returns the bounds plus the provenance of
 * how they were reached. Fetching those ratios is somebody else's job, which
 * is what lets the whole fallback ladder, the interpolation rule and the
 * ordering clamp be tested without a database.
 *
 * Bounds are multiplicative because this creek runs from about 11 to 13,200
 * cubic feet per second. A band expressed in cubic feet per second is absurd
 * at baseflow and meaningless at a peak, and conditioning on regime narrows
 * that range without closing it: the peak regime alone spans an order of
 * magnitude. Ratios travel across the whole range.
 */

/** What was decided, and how it was reached. Field names match the columns. */
export interface Interval {
  lowerCfs: number;
  upperCfs: number;
  intervalLevel: number;
  /**
   * True only when the bounds came from the regime conditioned bucket. This
   * is deliberately not "at least 30 errors existed": pooled quantiles are
   * real data, so calling them unseeded on a sample size basis would be
   * wrong, but calling them seeded would claim a conditioning that did not
   * happen. The flag answers "do these bounds meet the conditioning
   * requirement", which is the thing a reader needs.
   */
  intervalSeeded: boolean;
  /** True when a raw bound would have broken the ordering invariant. */
  intervalClamped: boolean;
  /** The ratios used. Null on the placeholder path, where none were. */
  q10Used: number | null;
  q90Used: number | null;
  /** How many errors the quantiles were drawn from. Zero on the placeholder. */
  bucketSize: number;
}

/**
 * The quantile of a sample by linear interpolation between order statistics.
 *
 * This is the R type 7 definition, which is also numpy's default: for `n`
 * sorted values the position is `1 + p * (n - 1)`, counting from one, and a
 * fractional position interpolates between its two neighbours. Pinning the
 * definition matters because the seven common ones disagree by a few percent
 * on small samples, and a bucket at the 30 error minimum is a small sample.
 */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new Error('quantile of an empty sample');
  }

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];

  const position = 1 + p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;

  return (
    sorted[lower - 1] + fraction * (sorted[upper - 1] - sorted[lower - 1])
  );
}

/**
 * Applies the ordering invariant, recording it when it fires.
 *
 * A forecaster whose 10th percentile ratio exceeds 1.0 is systematically
 * under predicting, and that is a finding rather than an inconvenience.
 * Enforcing the invariant silently would throw the signal away at the moment
 * it first appears, so a clamp is recorded, not hidden.
 */
function clampToOrdering(
  centralCfs: number,
  rawLower: number,
  rawUpper: number,
): { lowerCfs: number; upperCfs: number; intervalClamped: boolean } {
  let lowerCfs = rawLower;
  let upperCfs = rawUpper;
  let intervalClamped = false;

  if (lowerCfs > centralCfs) {
    lowerCfs = centralCfs;
    intervalClamped = true;
  }
  if (upperCfs < centralCfs) {
    upperCfs = centralCfs;
    intervalClamped = true;
  }

  return { lowerCfs, upperCfs, intervalClamped };
}

function fromBucket(
  centralCfs: number,
  ratios: readonly number[],
  intervalSeeded: boolean,
): Interval {
  const q10Used = quantile(ratios, INTERVAL_QUANTILE_LOW);
  const q90Used = quantile(ratios, INTERVAL_QUANTILE_HIGH);

  return {
    ...clampToOrdering(centralCfs, centralCfs * q10Used, centralCfs * q90Used),
    intervalLevel: INTERVAL_LEVEL,
    intervalSeeded,
    q10Used,
    q90Used,
    bucketSize: ratios.length,
  };
}

/**
 * Chooses an interval for one prediction.
 *
 * The ladder, in order: the regime conditioned bucket when it holds at least
 * 30 errors, then the pooled bucket on the same minimum, then the fixed
 * placeholder band. Only the first rung counts as seeded.
 *
 * `conditionedRatios` is empty when the regime at issue time could not be
 * classified. That needs no special case: an empty bucket cannot reach the
 * minimum, so the ladder falls to pooled on its own and marks the result
 * unseeded, which is what an unclassifiable issue regime should produce.
 *
 * Every ratio is `actualCfs / centralCfs` from a past score of the same
 * model, gauge, horizon and issue regime. Dividing by the prediction rather
 * than by the outcome is why no low flow floor is needed here: a prediction
 * is a real reading or a mean of real readings, and neither approaches zero.
 */
export function intervalFromErrors(
  centralCfs: number,
  conditionedRatios: readonly number[],
  pooledRatios: readonly number[],
): Interval {
  if (conditionedRatios.length >= MIN_BUCKET_ERRORS) {
    return fromBucket(centralCfs, conditionedRatios, true);
  }

  if (pooledRatios.length >= MIN_BUCKET_ERRORS) {
    return fromBucket(centralCfs, pooledRatios, false);
  }

  // The placeholder. Clamped like any other path so the ordering invariant
  // holds without exception, though for a positive central estimate, which
  // every prediction has, the clamp cannot fire here.
  return {
    ...clampToOrdering(
      centralCfs,
      centralCfs / PLACEHOLDER_BAND_FACTOR,
      centralCfs * PLACEHOLDER_BAND_FACTOR,
    ),
    intervalLevel: INTERVAL_LEVEL,
    intervalSeeded: false,
    q10Used: null,
    q90Used: null,
    bucketSize: 0,
  };
}
