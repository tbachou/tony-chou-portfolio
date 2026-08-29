import { aggregate } from './aggregate';
import {
  DIMENSIONS,
  type BaselineComparison,
  type BaselineFile,
  type Dimension,
  type DimensionDelta,
  type RunResults,
} from './eval-types';

/**
 * The noise band (AC-9): the per dimension absolute spread observed between
 * two identical full runs. A later delta whose magnitude sits within the band
 * is reported as not significant.
 */
export function computeNoiseBand(
  runA: RunResults,
  runB: RunResults,
): Record<Dimension, number> {
  const aggA = aggregate(runA.cases).perDimension;
  const aggB = aggregate(runB.cases).perDimension;
  const band = {} as Record<Dimension, number>;
  for (const dimension of DIMENSIONS) {
    const meanA = aggA[dimension].mean;
    const meanB = aggB[dimension].mean;
    band[dimension] =
      meanA === null || meanB === null ? 0 : Math.abs(meanA - meanB);
  }
  return band;
}

/**
 * Delta of the current run against the committed baseline. Marked not
 * comparable when the dataset hash differs (AC-6); significance is judged
 * against the baseline's published noise band (AC-9), and left null when no
 * band is published.
 */
export function compareToBaseline(
  current: RunResults,
  baseline: BaselineFile | null,
): BaselineComparison {
  const empty: DimensionDelta = {
    delta: null,
    comparable: false,
    significant: null,
  };
  if (!baseline) {
    return {
      hasBaseline: false,
      comparable: false,
      perDimension: {
        honesty: empty,
        grounding: empty,
        persona: empty,
      },
    };
  }

  const comparable =
    current.meta.datasetHash === baseline.run.meta.datasetHash;
  const currentAgg = aggregate(current.cases).perDimension;
  const baselineAgg = aggregate(baseline.run.cases).perDimension;

  const perDimension = {} as Record<Dimension, DimensionDelta>;
  for (const dimension of DIMENSIONS) {
    const currentMean = currentAgg[dimension].mean;
    const baselineMean = baselineAgg[dimension].mean;
    if (!comparable || currentMean === null || baselineMean === null) {
      perDimension[dimension] = { delta: null, comparable, significant: null };
      continue;
    }
    const delta = currentMean - baselineMean;
    const band = baseline.noiseBand?.[dimension];
    // A partial run's mean is composition biased against the full-set
    // baseline (e.g. a capped CI run scoring only the easy tiers), so the
    // delta is shown but significance is never asserted.
    perDimension[dimension] = {
      delta,
      comparable,
      significant:
        band === undefined || current.meta.partial
          ? null
          : Math.abs(delta) > band,
    };
  }

  return { hasBaseline: true, comparable, perDimension };
}
