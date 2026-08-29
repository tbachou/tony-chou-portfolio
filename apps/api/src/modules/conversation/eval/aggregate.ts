import {
  DIFFICULTIES,
  DIMENSIONS,
  type Aggregates,
  type CaseResult,
  type Difficulty,
  type Dimension,
  type DimensionAggregate,
} from './eval-types';

/**
 * Aggregation rules (AC-6, AC-7):
 * - a dimension's mean is the unweighted mean over cases where that dimension
 *   was scored;
 * - a `judge_error` excludes only that dimension of that case; the case's
 *   other dimensions still count;
 * - a `generation_error` case contributes to no aggregate and is listed;
 * - every errored case is listed so the report can surface it.
 */
export function aggregate(cases: CaseResult[]): Aggregates {
  const generationErrors = cases
    .filter((c) => c.status === 'generation_error')
    .map((c) => c.caseId);

  const judgeErrorCases: Record<string, Dimension[]> = {};
  for (const c of cases) {
    const errored = DIMENSIONS.filter(
      (d) => c.dimensions[d]?.status === 'judge_error',
    );
    if (errored.length > 0) judgeErrorCases[c.caseId] = errored;
  }

  const perDimension = {} as Record<Dimension, DimensionAggregate>;
  for (const dimension of DIMENSIONS) {
    perDimension[dimension] = aggregateDimension(cases, dimension);
  }

  const perDifficulty = {} as Record<
    Difficulty,
    Record<Dimension, DimensionAggregate>
  >;
  for (const difficulty of DIFFICULTIES) {
    const subset = cases.filter((c) => c.difficulty === difficulty);
    const byDimension = {} as Record<Dimension, DimensionAggregate>;
    for (const dimension of DIMENSIONS) {
      byDimension[dimension] = aggregateDimension(subset, dimension);
    }
    perDifficulty[difficulty] = byDimension;
  }

  return { perDimension, perDifficulty, generationErrors, judgeErrorCases };
}

function aggregateDimension(
  cases: CaseResult[],
  dimension: Dimension,
): DimensionAggregate {
  const results = cases
    .filter((c) => c.status === 'scored')
    .map((c) => c.dimensions[dimension])
    .filter((r) => r !== undefined);
  const scored = results.filter((r) => r.status === 'scored');
  const judgeErrors = results.length - scored.length;
  const mean =
    scored.length === 0
      ? null
      : scored.reduce((sum, r) => sum + r.score, 0) / scored.length;
  return { mean, scoredCases: scored.length, judgeErrors };
}
