/** The V scale, as far as this game goes. Both bounds are inclusive. */
export const GRADE_MIN = 0;
export const GRADE_MAX = 8;

/** Histogram width: one slot per grade, index = grade (AC-6). */
export const GRADE_SLOTS = GRADE_MAX - GRADE_MIN + 1;

export const GRADE_CONFIDENCES = ['low', 'medium', 'high'] as const;
export type GradeConfidence = (typeof GRADE_CONFIDENCES)[number];

/**
 * The vision model. Pinned rather than read from ANTHROPIC_MODEL because one
 * call per UTC day makes quality the only axis worth optimising (spec 0006
 * rationale) — a cheaper default set for another feature must not silently
 * downgrade the game's single daily read of the wall.
 */
export const GRADER_MODEL = 'claude-sonnet-5';

/** Vision calls are slower than text; the first guesser of the day waits. */
export const GRADER_CALL_TIMEOUT_MS = 60_000;

export const GRADER_MAX_TOKENS = 1200;

/** Bounds on what the model is allowed to hand back, enforced on parse. */
export const MAX_OBSERVATIONS = 6;
export const MAX_OBSERVATION_LENGTH = 240;
export const MAX_REASONING_LENGTH = 1200;

/** Where the day's photo is served from, under the web origin. */
export const PHOTO_URL_PREFIX = '/grade/';

/**
 * The web origin the vision call and the page both resolve images against.
 * Reuses CORS_ORIGIN (which already holds the web origin on both
 * environments) rather than adding a variable, per spec 0006's configuration
 * decision. CORS_ORIGIN may be a comma-separated list; the first entry is
 * the canonical web origin.
 */
export function resolveWebOrigin(): string {
  const first = process.env.CORS_ORIGIN?.split(',')[0]?.trim();
  return (first && first.length > 0 ? first : 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
}
