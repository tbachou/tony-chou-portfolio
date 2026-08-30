import {
  RESULTS_PROVENANCE,
  type CaseResult,
  type Difficulty,
  type DimensionResult,
  type RunResults,
} from './eval-types';

export function scored(score: number): DimensionResult {
  return { status: 'scored', score, reason: 'test' };
}

export function judgeError(): DimensionResult {
  return { status: 'judge_error', reason: 'timed out twice' };
}

export function makeCase(
  overrides: Partial<CaseResult> & { caseId: string },
): CaseResult {
  return {
    difficulty: 'simple' as Difficulty,
    category: 'test',
    status: 'scored',
    questionSource: 'generated',
    interviewerQuestion: 'Q?',
    tonyRaw: 'A.',
    tonyEmitted: 'A.',
    guardFired: false,
    dimensions: {
      honesty: scored(1),
      grounding: scored(1),
      persona: scored(1),
    },
    ...overrides,
  };
}

export function makeRun(
  cases: CaseResult[],
  metaOverrides: Partial<RunResults['meta']> = {},
): RunResults {
  return {
    _readMeFirst: RESULTS_PROVENANCE,
    meta: {
      date: '2026-08-29T00:00:00.000Z',
      gitCommit: 'abcdef1234567890',
      gitDirty: false,
      provider: 'anthropic',
      generatorModel: 'claude-sonnet-5',
      judgeModel: 'claude-haiku-4-5',
      caseCount: cases.length,
      datasetHash: 'hash-a',
      tokensByModel: {},
      tokenTotals: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0.1,
      aborted: false,
      partial: false,
      ...metaOverrides,
    },
    cases,
  };
}
