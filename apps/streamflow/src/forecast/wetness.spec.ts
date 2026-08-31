import { antecedentWetness } from './wetness';
import { regimeInputs } from './regime';
import type { StoredObservation } from '../types';

/**
 * The gauge publishes every quarter hour, so seven days is 672 readings and
 * the 224 minimum is a third of that. Fixtures are generated at that cadence
 * rather than written out, and a test that cares about the minimum says how
 * many readings it kept.
 */
const GAUGE = 'gauge-darby';
const T = new Date('2026-08-19T00:00:00.000Z');
const QUARTER_HOUR = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * HOUR;

/** `count` readings back from the issue instant, newest first, one per quarter hour. */
function history(count: number, valueCfs: number | ((i: number) => number) = 100) {
  return Array.from({ length: count }, (_, i) => reading(-(i + 1) * QUARTER_HOUR,
    typeof valueCfs === 'function' ? valueCfs(i) : valueCfs));
}

function reading(offsetMs: number, valueCfs: number): StoredObservation {
  return {
    gaugeId: GAUGE,
    validTime: new Date(T.getTime() + offsetMs),
    // Before the issue instant, so a correctly reconstructed history and a raw
    // one agree on these fixtures. The tests that care about the difference
    // build their own rows.
    recordedAt: new Date(T.getTime() + offsetMs),
    valueCfs,
    qualifier: 'APPROVED',
  };
}

/** Comfortably above the 224 minimum, and inside the seven day window. */
const FULL = 400;

describe('antecedentWetness', () => {
  it('is the median discharge over the prior seven days', () => {
    expect(antecedentWetness(history(FULL, 100), T, 100)).toBe(100);
  });

  // The reuse claim, stated as an equality rather than as a comment. If this
  // ever drifts, the wetness feature and the regime have started disagreeing
  // about what seven days of history means.
  it('is exactly the m that regimeInputs derives', () => {
    const rows = history(FULL, (i) => 50 + i);

    expect(antecedentWetness(rows, T, 120)).toBe(regimeInputs(rows, T, 120)?.m);
  });

  it('reads a real median, not the newest or the mean', () => {
    // 399 readings at 10 and one enormous one. The median is unmoved; a mean
    // would be dragged far above it, and the newest reading is the outlier.
    const rows = [reading(-QUARTER_HOUR, 100000), ...history(FULL, 10).slice(1)];

    expect(antecedentWetness(rows, T, 100000)).toBe(10);
  });

  describe('where it refuses', () => {
    it('is null below the 224 reading minimum', () => {
      expect(antecedentWetness(history(223), T, 100)).toBeNull();
      expect(antecedentWetness(history(224), T, 100)).toBe(100);
    });

    it('is null on a non positive median', () => {
      expect(antecedentWetness(history(FULL, 0), T, 0)).toBeNull();
      expect(antecedentWetness(history(FULL, -5), T, -5)).toBeNull();
    });

    /**
     * The third refusal, which AC-R11's prose does not list.
     *
     * `regimeInputs` also needs a reading within two hours of the twelve hour
     * mark, because it derives the twelve hour change alongside the median.
     * Wetness does not use that change and a median is perfectly well defined
     * without it, so inheriting the refusal makes this feature stricter than
     * the criterion reads. Recorded here rather than worked around: reusing the
     * function whole is what the criterion asks for, and refusing more often is
     * the safe direction, since it becomes a skip rather than a wrong number.
     */
    it('is null when no reading sits near the twelve hour mark, though the median is fine', () => {
      const rows = history(FULL, 100).filter((row) => {
        const back = T.getTime() - row.validTime.getTime();
        return back < 9 * HOUR || back > 15 * HOUR;
      });

      // Still far more than the minimum, and every value is 100, so the median
      // is not in doubt. The gap alone is what refuses.
      expect(rows.length).toBeGreaterThan(224);
      expect(antecedentWetness(rows, T, 100)).toBeNull();

      // The same rows with the gap closed do produce a median.
      expect(antecedentWetness(history(FULL, 100), T, 100)).toBe(100);
    });
  });

  describe('the window', () => {
    it('ignores readings at or after the issue instant', () => {
      const future = [
        reading(0, 99999),
        reading(HOUR, 99999),
        ...history(FULL, 100),
      ];

      expect(antecedentWetness(future, T, 100)).toBe(100);
    });

    it('ignores readings older than seven days', () => {
      const stale = Array.from({ length: 500 }, (_, i) =>
        reading(-SEVEN_DAYS - (i + 1) * QUARTER_HOUR, 99999),
      );

      expect(antecedentWetness([...stale, ...history(FULL, 100)], T, 100)).toBe(100);
    });

    it('counts only the readings inside the window towards the minimum', () => {
      // Plenty of rows overall, almost all of them too old to count.
      const stale = Array.from({ length: 500 }, (_, i) =>
        reading(-SEVEN_DAYS - (i + 1) * QUARTER_HOUR, 100),
      );

      expect(antecedentWetness([...stale, ...history(100, 100)], T, 100)).toBeNull();
    });
  });

  /**
   * `valueAtIssue` feeds `d` alone, and `m` and all three refusals are
   * properties of the history. It is passed through rather than faked so the
   * two stay coupled if a later refusal ever does read it.
   */
  it('does not depend on the value at issue', () => {
    const rows = history(FULL, (i) => 50 + i);

    expect(antecedentWetness(rows, T, 1)).toBe(antecedentWetness(rows, T, 10000));
  });

  /**
   * The leak this function cannot catch, pinned so the contract is visible.
   *
   * `regimeInputs` filters on `validTime`, so a reading that had already
   * happened but had not yet reached the pipeline is indistinguishable to it.
   * Keeping it out is the caller's job, done by reconstructing the history on
   * the slot's axis before it ever gets here. These two histories differ only
   * in rows the pipeline had not received at `T`, and this function answers
   * them differently, which is exactly why the reconstruction is not optional.
   */
  it('cannot see the difference a reconstruction makes, which is why callers must do it', () => {
    const reconstructed = history(FULL, 100);
    const raw = [
      ...reconstructed,
      // Valid a day before the issue instant, recorded a week after it.
      {
        ...reading(-24 * HOUR, 99999),
        recordedAt: new Date(T.getTime() + 7 * 24 * HOUR),
      },
    ];

    expect(antecedentWetness(reconstructed, T, 100)).toBe(100);
    expect(antecedentWetness(raw, T, 100)).not.toBeNull();
    expect(raw.length).toBe(reconstructed.length + 1);
  });
});
