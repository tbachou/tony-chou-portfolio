import { calibration, intervalSource } from './calibration';
import type { GradedInterval } from './calibration';

function row(overrides: Partial<GradedInterval> = {}): GradedInterval {
  return {
    modelName: 'persistence',
    horizonHours: 24,
    regime: 'BASEFLOW',
    withinInterval: true,
    intervalLevel: 0.8,
    source: 'conditioned',
    ...overrides,
  };
}

/** `count` rows, the first `hits` of which landed inside the published range. */
function rows(count: number, hits: number, overrides: Partial<GradedInterval> = {}) {
  return Array.from({ length: count }, (_, index) =>
    row({ ...overrides, withinInterval: index < hits }),
  );
}

describe('calibration', () => {
  it('reports the share that landed inside against what was claimed', () => {
    const report = calibration(rows(10, 8));

    expect(report.overall.total).toBe(10);
    expect(report.overall.inside).toBe(8);
    expect(report.overall.observed).toBeCloseTo(0.8);
    expect(report.overall.nominal).toBeCloseTo(0.8);
    // Exactly as advertised, so the gap is nothing.
    expect(report.overall.gap).toBeCloseTo(0);
  });

  it('signs the gap so overconfidence is negative', () => {
    // Half the truths escaped a range that claimed to hold four in five.
    const report = calibration(rows(10, 5));

    expect(report.overall.observed).toBeCloseTo(0.5);
    expect(report.overall.gap).toBeCloseTo(-0.3);
  });

  it('separates a badly calibrated river state from a well calibrated one', () => {
    // The failure the whole split exists to catch: pooled, these two are a
    // respectable 0.8, and the peak group's collapse is invisible.
    const report = calibration([
      ...rows(100, 90, { regime: 'BASEFLOW' }),
      ...rows(100, 70, { regime: 'PEAK' }),
    ]);

    expect(report.overall.observed).toBeCloseTo(0.8);

    const baseflow = report.byRegime.find((g) => g.label.endsWith('baseflow'));
    const peak = report.byRegime.find((g) => g.label.endsWith('peak'));
    expect(baseflow?.observed).toBeCloseTo(0.9);
    expect(peak?.observed).toBeCloseTo(0.7);
    expect(peak?.gap).toBeCloseTo(-0.1);
  });

  it('keeps the placeholder band apart from an earned range', () => {
    // A placeholder is a third of the guess to triple it, so nearly everything
    // lands inside one. Pooled with real ranges it manufactures a healthy
    // looking overall figure out of nothing.
    const report = calibration([
      ...rows(50, 30, { source: 'conditioned' }),
      ...rows(50, 50, { source: 'placeholder' }),
    ]);

    expect(report.overall.observed).toBeCloseTo(0.8);

    const conditioned = report.bySource.find((g) => g.label === 'conditioned');
    const placeholder = report.bySource.find((g) => g.label === 'placeholder');
    expect(conditioned?.observed).toBeCloseTo(0.6);
    expect(placeholder?.observed).toBeCloseTo(1);
  });

  it('splits horizons per forecaster rather than pooling them', () => {
    const report = calibration([
      ...rows(10, 9, { modelName: 'persistence', horizonHours: 24 }),
      ...rows(10, 5, { modelName: 'climatology', horizonHours: 24 }),
    ]);

    const labels = report.byHorizon.map((g) => g.label);
    expect(labels).toEqual(['climatology 24 h', 'persistence 24 h']);
    expect(report.byHorizon.find((g) => g.label.startsWith('persistence'))?.observed).toBeCloseTo(
      0.9,
    );
    expect(report.byHorizon.find((g) => g.label.startsWith('climatology'))?.observed).toBeCloseTo(
      0.5,
    );
  });

  it('orders horizons and river states rather than sorting them as text', () => {
    const report = calibration([
      ...rows(1, 1, { horizonHours: 72 }),
      ...rows(1, 1, { horizonHours: 24 }),
      ...rows(1, 1, { horizonHours: 48 }),
      ...rows(1, 1, { regime: 'FALLING' }),
      ...rows(1, 1, { regime: 'RISING' }),
    ]);

    // 24, 48, 72 rather than the "24, 48, 72" that text sorting happens to
    // give, which would break the moment a 6 or 120 hour horizon appeared.
    expect(report.byHorizon.map((g) => g.label)).toEqual([
      'persistence 24 h',
      'persistence 48 h',
      'persistence 72 h',
    ]);
    // Ladder order, not alphabetical: baseflow, rising, peak, falling.
    expect(report.byRegime.map((g) => g.label)).toEqual([
      'persistence baseflow',
      'persistence rising',
      'persistence falling',
    ]);
  });

  it('labels an unclassified river state rather than dropping it', () => {
    const report = calibration([...rows(3, 3, { regime: null })]);

    expect(report.byRegime.map((g) => g.label)).toEqual(['persistence unclassified']);
    expect(report.byRegime[0].total).toBe(3);
  });

  it('reports an empty population as unknown rather than as zero coverage', () => {
    const report = calibration([]);

    // No data and total failure are opposite findings. A zero here would
    // render as a forecaster whose every range missed.
    expect(report.overall.observed).toBeNull();
    expect(report.overall.gap).toBeNull();
    expect(report.overall.total).toBe(0);
    expect(report.byRegime).toEqual([]);
  });

  it('averages the claimed level rather than assuming it', () => {
    // Uniform at 0.80 today, but the level is stored per row precisely so a
    // later change of policy cannot silently reinterpret old predictions.
    const report = calibration([
      ...rows(1, 1, { intervalLevel: 0.8 }),
      ...rows(1, 1, { intervalLevel: 0.9 }),
    ]);

    expect(report.overall.nominal).toBeCloseTo(0.85);
  });
});

describe('intervalSource', () => {
  it('calls a regime conditioned range earned', () => {
    expect(intervalSource({ intervalSeeded: true, bucketSize: 835 })).toBe('conditioned');
  });

  it('calls a real but unconditioned sample pooled', () => {
    expect(intervalSource({ intervalSeeded: false, bucketSize: 56 })).toBe('pooled');
  });

  it('calls an empty bucket a placeholder', () => {
    expect(intervalSource({ intervalSeeded: false, bucketSize: 0 })).toBe('placeholder');
  });
});
