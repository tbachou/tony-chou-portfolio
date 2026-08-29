/**
 * Shared types for the interview simulator eval suite (spec 0011).
 *
 * Everything in this directory is pure logic (aggregation, hashing, baseline
 * math, scoreboard rendering) so it can be unit tested by Jest, whose rootDir
 * is `src`. The harness that makes real model calls lives in
 * `scripts/interview-eval/` and imports from here.
 */

export type Difficulty = 'simple' | 'medium' | 'hard' | 'edge';

export const DIMENSIONS = ['honesty', 'grounding', 'persona'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIFFICULTIES: Difficulty[] = ['simple', 'medium', 'hard', 'edge'];

/** A judge's verdict on one dimension, on the discrete 0 / 0.5 / 1 scale. */
export type JudgeVerdict = {
  score: 0 | 0.5 | 1;
  reason: string;
};

/**
 * One dimension's outcome for one case. A `judge_error` (judge errored twice,
 * timed out, or returned an unparseable verdict, AC-7) excludes this dimension
 * from that dimension's aggregate; the case's other dimensions still count.
 */
export type DimensionResult =
  | { status: 'scored'; score: number; reason: string }
  | { status: 'judge_error'; reason: string };

export type CaseResult = {
  caseId: string;
  difficulty: Difficulty;
  category: string;
  /** `generation_error`: the turn pair itself failed twice (AC-7). */
  status: 'scored' | 'generation_error';
  /** How the interviewer question was produced (AC-2 bait mechanism). */
  questionSource: 'generated' | 'injected';
  interviewerQuestion: string | null;
  /** The raw model output for the Tony turn, before the ownership guard. */
  tonyRaw: string | null;
  /** What a visitor would have seen (guard fallback when the guard fired). */
  tonyEmitted: string | null;
  guardFired: boolean;
  dimensions: Partial<Record<Dimension, DimensionResult>>;
  /**
   * Honesty is two layered (AC-3): the code guard and the LLM judge. Kept so
   * a 0 in `dimensions.honesty` names which layer produced it.
   */
  honestyLayers?: {
    guard: { ok: boolean; reason: string | null };
    judge: DimensionResult;
  };
  generationError?: string;
  /** Wall time for the case: generation, retry, and judge calls. */
  durationMs?: number;
};

export type TokenTotals = { inputTokens: number; outputTokens: number };

export type RunMeta = {
  date: string;
  gitCommit: string;
  gitDirty: boolean;
  provider: string;
  generatorModel: string;
  judgeModel: string;
  caseCount: number;
  datasetHash: string;
  /** Tokens summed per model id, so cost can be priced per model. */
  tokensByModel: Record<string, TokenTotals>;
  tokenTotals: TokenTotals;
  /** Null when any used model is missing from the price table (AC-6). */
  estimatedCostUsd: number | null;
  /** True when --max-cost aborted the run; results are partial (AC-7). */
  aborted: boolean;
  /**
   * True when the run covered less than the full golden dataset (a --cases
   * cap or an abort). A partial run's delta against the full-set baseline is
   * composition biased, so significance is never asserted for it, and a
   * partial run can never become the baseline.
   */
  partial: boolean;
};

export type RunResults = {
  meta: RunMeta;
  cases: CaseResult[];
};

/**
 * The committed baseline (AC-9): one accepted run plus the noise band
 * observed between the two identical runs that established it. Moves only by
 * a deliberate local run and a human commit; CI never writes it.
 */
export type BaselineFile = {
  noiseBand: Record<Dimension, number> | null;
  run: RunResults;
};

export type DimensionAggregate = {
  /** Unweighted mean over scored cases, null when none scored. */
  mean: number | null;
  scoredCases: number;
  judgeErrors: number;
};

export type Aggregates = {
  perDimension: Record<Dimension, DimensionAggregate>;
  perDifficulty: Record<Difficulty, Record<Dimension, DimensionAggregate>>;
  generationErrors: string[];
  /** caseId → dimensions that hit judge_error, for the AC-7 error listing. */
  judgeErrorCases: Record<string, Dimension[]>;
};

export type DimensionDelta = {
  delta: number | null;
  /** False when the dataset hash differs from the baseline's (AC-6). */
  comparable: boolean;
  /** Null when no noise band is published; deltas inside the band are not significant (AC-9). */
  significant: boolean | null;
};

export type BaselineComparison = {
  hasBaseline: boolean;
  comparable: boolean;
  perDimension: Record<Dimension, DimensionDelta>;
};
