import { compareToBaseline, computeNoiseBand } from './baseline';
import { makeCase, makeRun, scored } from './test-fixtures';
import type { BaselineFile } from './eval-types';

function runWithHonesty(scores: number[], datasetHash = 'hash-a') {
  return makeRun(
    scores.map((s, i) =>
      makeCase({
        caseId: `c${i}`,
        dimensions: { honesty: scored(s), grounding: scored(1), persona: scored(1) },
      }),
    ),
    { datasetHash },
  );
}

describe('computeNoiseBand', () => {
  it('is the absolute per dimension spread between two runs', () => {
    const band = computeNoiseBand(
      runWithHonesty([1, 1]),
      runWithHonesty([1, 0.5]),
    );
    expect(band.honesty).toBeCloseTo(0.25);
    expect(band.grounding).toBe(0);
    expect(band.persona).toBe(0);
  });
});

describe('compareToBaseline', () => {
  const baseline: BaselineFile = {
    noiseBand: { honesty: 0.1, grounding: 0.1, persona: 0.1 },
    run: runWithHonesty([1, 1]),
  };

  it('reports no baseline when none exists', () => {
    const comparison = compareToBaseline(runWithHonesty([1, 1]), null);
    expect(comparison.hasBaseline).toBe(false);
    expect(comparison.perDimension.honesty.delta).toBeNull();
  });

  it('computes the delta and flags a drop outside the noise band as significant', () => {
    const comparison = compareToBaseline(runWithHonesty([0.5, 0.5]), baseline);
    expect(comparison.comparable).toBe(true);
    expect(comparison.perDimension.honesty.delta).toBeCloseTo(-0.5);
    expect(comparison.perDimension.honesty.significant).toBe(true);
  });

  it('marks a delta within the noise band as not significant', () => {
    const comparison = compareToBaseline(runWithHonesty([1, 0.9]), baseline);
    expect(comparison.perDimension.honesty.delta).toBeCloseTo(-0.05);
    expect(comparison.perDimension.honesty.significant).toBe(false);
  });

  it('marks the comparison not comparable when the dataset hash differs', () => {
    const comparison = compareToBaseline(
      runWithHonesty([1, 1], 'hash-b'),
      baseline,
    );
    expect(comparison.comparable).toBe(false);
    expect(comparison.perDimension.honesty.delta).toBeNull();
    expect(comparison.perDimension.honesty.significant).toBeNull();
  });

  it('leaves significance null when the baseline has no noise band', () => {
    const comparison = compareToBaseline(runWithHonesty([0, 0]), {
      ...baseline,
      noiseBand: null,
    });
    expect(comparison.perDimension.honesty.delta).toBeCloseTo(-1);
    expect(comparison.perDimension.honesty.significant).toBeNull();
  });
});
