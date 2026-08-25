import { INTERVAL_LEVEL, MIN_BUCKET_ERRORS } from '../config';
import { intervalFromErrors, quantile } from './interval';

/** A bucket of `count` ratios, all the same, for testing the ladder's rungs. */
function flatBucket(count: number, ratio: number): number[] {
  return Array.from({ length: count }, () => ratio);
}

/**
 * Thirty ratios spread from 0.1 to 3.0. Chosen so the type 7 positions land
 * on values that can be worked out by hand: the 0.10 quantile sits at
 * position 3.9, nine tenths of the way from 0.3 to 0.4, and the 0.90 quantile
 * at position 27.1, a tenth of the way from 2.7 to 2.8.
 */
const SPREAD_BUCKET = Array.from({ length: 30 }, (_, i) => (i + 1) / 10);
const SPREAD_Q10 = 0.39;
const SPREAD_Q90 = 2.71;

describe('quantile', () => {
  it('returns the order statistic exactly when the position is a whole number', () => {
    // Eleven values put the 0.10 quantile at position 2 and the 0.90 at
    // position 10, so no interpolation is involved and the answer is exact.
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    expect(quantile(sample, 0.1)).toBe(2);
    expect(quantile(sample, 0.9)).toBe(10);
  });

  it('interpolates linearly between neighbours, as R type 7 and numpy do', () => {
    expect(quantile(SPREAD_BUCKET, 0.1)).toBeCloseTo(SPREAD_Q10, 10);
    expect(quantile(SPREAD_BUCKET, 0.9)).toBeCloseTo(SPREAD_Q90, 10);
  });

  it('does not depend on the order it is given the sample in', () => {
    const shuffled = [...SPREAD_BUCKET].reverse();

    expect(quantile(shuffled, 0.1)).toBeCloseTo(SPREAD_Q10, 10);
  });

  it('returns the only value it has when the sample holds one', () => {
    expect(quantile([1.4], 0.1)).toBe(1.4);
    expect(quantile([1.4], 0.9)).toBe(1.4);
  });

  it('refuses an empty sample rather than inventing a number', () => {
    expect(() => quantile([], 0.1)).toThrow('quantile of an empty sample');
  });
});

describe('intervalFromErrors', () => {
  it('uses the regime conditioned bucket when it reaches the minimum', () => {
    const result = intervalFromErrors(100, SPREAD_BUCKET, SPREAD_BUCKET);

    expect(result.lowerCfs).toBeCloseTo(100 * SPREAD_Q10, 8);
    expect(result.upperCfs).toBeCloseTo(100 * SPREAD_Q90, 8);
    expect(result.q10Used).toBeCloseTo(SPREAD_Q10, 10);
    expect(result.q90Used).toBeCloseTo(SPREAD_Q90, 10);
    expect(result.bucketSize).toBe(30);
    expect(result.intervalSeeded).toBe(true);
    expect(result.intervalClamped).toBe(false);
  });

  it('always states the nominal level it claims', () => {
    expect(intervalFromErrors(100, SPREAD_BUCKET, []).intervalLevel).toBe(
      INTERVAL_LEVEL,
    );
    expect(intervalFromErrors(100, [], []).intervalLevel).toBe(INTERVAL_LEVEL);
  });

  it('falls back to pooled quantiles one error short of the minimum', () => {
    const thin = flatBucket(MIN_BUCKET_ERRORS - 1, 0.5);
    const pooled = flatBucket(MIN_BUCKET_ERRORS, 0.8);

    const result = intervalFromErrors(100, thin, pooled);

    // 0.8 rather than 0.5: the thin bucket was not used at all.
    expect(result.lowerCfs).toBeCloseTo(80, 8);
    expect(result.q10Used).toBeCloseTo(0.8, 10);
    expect(result.bucketSize).toBe(MIN_BUCKET_ERRORS);
    // Pooled quantiles are real data, but they are not conditioned.
    expect(result.intervalSeeded).toBe(false);
  });

  it('uses pooled quantiles when the issue regime could not be classified', () => {
    // An unclassifiable regime has no bucket to condition on, which reaches
    // the same rung as a thin one without needing its own branch.
    const result = intervalFromErrors(100, [], SPREAD_BUCKET);

    expect(result.lowerCfs).toBeCloseTo(100 * SPREAD_Q10, 8);
    expect(result.bucketSize).toBe(30);
    expect(result.intervalSeeded).toBe(false);
  });

  it('falls to the placeholder band when neither bucket reaches the minimum', () => {
    const thin = flatBucket(MIN_BUCKET_ERRORS - 1, 0.9);

    const result = intervalFromErrors(120, thin, thin);

    expect(result.lowerCfs).toBe(40);
    expect(result.upperCfs).toBe(360);
    // No quantiles were computed, so there are none to record.
    expect(result.q10Used).toBeNull();
    expect(result.q90Used).toBeNull();
    expect(result.bucketSize).toBe(0);
    expect(result.intervalSeeded).toBe(false);
    expect(result.intervalClamped).toBe(false);
  });

  it('clamps a lower bound that would sit above the central estimate', () => {
    // Every past outcome twice the forecast means this forecaster is
    // systematically under predicting. The clamp keeps the ordering and the
    // flag keeps the finding.
    const result = intervalFromErrors(100, flatBucket(30, 2), []);

    expect(result.lowerCfs).toBe(100);
    expect(result.upperCfs).toBeCloseTo(200, 8);
    expect(result.intervalClamped).toBe(true);
    // The raw ratio is still recorded, so the clamp can be explained.
    expect(result.q10Used).toBeCloseTo(2, 10);
  });

  it('clamps an upper bound that would sit below the central estimate', () => {
    const result = intervalFromErrors(100, flatBucket(30, 0.5), []);

    expect(result.lowerCfs).toBeCloseTo(50, 8);
    expect(result.upperCfs).toBe(100);
    expect(result.intervalClamped).toBe(true);
  });

  it('holds the ordering invariant on every rung of the ladder', () => {
    const buckets: Array<[readonly number[], readonly number[]]> = [
      [SPREAD_BUCKET, SPREAD_BUCKET],
      [[], SPREAD_BUCKET],
      [[], []],
      [flatBucket(30, 2), []],
      [flatBucket(30, 0.5), []],
    ];

    for (const [conditioned, pooled] of buckets) {
      const result = intervalFromErrors(250, conditioned, pooled);

      expect(result.lowerCfs).toBeLessThanOrEqual(250);
      expect(result.upperCfs).toBeGreaterThanOrEqual(250);
    }
  });
});
