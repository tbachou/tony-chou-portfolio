import type { ProviderName } from '../anthropic/ai-provider.interface';

/** The V scale, as far as this game goes. Both bounds are inclusive. */
export const GRADE_MIN = 0;
export const GRADE_MAX = 8;

/** Histogram width: one slot per grade, index = grade (AC-6). */
export const GRADE_SLOTS = GRADE_MAX - GRADE_MIN + 1;

export const GRADE_CONFIDENCES = ['low', 'medium', 'high'] as const;
export type GradeConfidence = (typeof GRADE_CONFIDENCES)[number];

/**
 * The vision model, pinned per provider (AC-16).
 *
 * Two ids for the same job, because the two providers do not share a
 * namespace: a first party id is meaningless to Bedrock, which is the second
 * of the two independent failures the 2026-08-21 revision found on this path.
 * Resolving by provider is what makes it impossible to send the wrong one.
 *
 * Pinned rather than read from ANTHROPIC_MODEL or BEDROCK_MODEL_ID, and the
 * Bedrock side deliberately does NOT fall back to BEDROCK_MODEL_ID: that
 * variable is the env driven downgrade this pinning exists to prevent. One
 * call per UTC day makes quality the only axis worth optimising, so a cheaper
 * default set for another feature must not silently reach the game's single
 * daily read of the wall.
 */
export const GRADER_MODEL_ANTHROPIC = 'claude-sonnet-5';

/**
 * The Bedrock cross-region inference profile for the same model family.
 *
 * Sonnet 4.6 rather than Sonnet 5 DELIBERATELY, and checked rather than
 * assumed: Sonnet 5 is not offered on Bedrock (confirmed 2026-08-21), so the
 * two providers necessarily run different models here. This is the closest
 * available member of the same family, and it is the id production is already
 * observed serving, so it is known valid in this account.
 *
 * Not a placeholder — do not "fix" it to a Sonnet 5 id, which Bedrock would
 * reject, reintroducing exactly the unrecognised-model failure AC-16 exists
 * to prevent. Revisit only when Bedrock actually lists a Sonnet 5 profile.
 */
export const GRADER_MODEL_BEDROCK = 'us.anthropic.claude-sonnet-4-6';

/** The grader id for the provider actually in use (AC-16). */
export function resolveGraderModel(provider: ProviderName): string {
  return provider === 'bedrock'
    ? GRADER_MODEL_BEDROCK
    : GRADER_MODEL_ANTHROPIC;
}

/** Vision calls are slower than text; the first guesser of the day waits. */
export const GRADER_CALL_TIMEOUT_MS = 60_000;

export const GRADER_MAX_TOKENS = 1200;

/** Bounds on what the model is allowed to hand back, enforced on parse. */
export const MAX_OBSERVATIONS = 6;
export const MAX_OBSERVATION_LENGTH = 240;
export const MAX_REASONING_LENGTH = 1200;

/**
 * Whether the game is released.
 *
 * Read here rather than passed in because the same variable already decides
 * whether GradeModule is registered at all (app.module.ts). It matters inside
 * the module for one reason: the licence gate (AC-18) only applies once the
 * game is live, so that a photo borrowed to test the pipeline is usable while
 * the game is hidden and refused the moment it is not.
 */
export function gradeGameEnabled(): boolean {
  return process.env.GRADE_GAME_ENABLED === 'true';
}

