import { GRADE_MAX, GRADE_MIN } from '@portfolio/shared';
import type { ProviderName } from '../anthropic/ai-provider.interface';

/** The V scale, as far as this game goes. Both bounds are inclusive. */
// Bounds live in @portfolio/shared, next to the schemas that enforce them,
// and are re-exported here because this module's own code reads them too.
export { GRADE_MAX, GRADE_MIN };

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
 * call per problem, ever, makes quality the only axis worth optimising, so a
 * cheaper default set for another feature must not silently reach the one
 * read of the wall this game ever gets.
 */
export const GRADER_MODEL_ANTHROPIC = 'claude-sonnet-5';

/**
 * The Bedrock cross-region inference profile for the same model family.
 *
 * Sonnet 4.6 rather than Sonnet 5 DELIBERATELY, and stated carefully because
 * the reason is not what it looks like. Sonnet 5 is NOT usable on this account
 * today: the Bedrock model catalog lists it, but invocation returns 403 (spec
 * 0005's guardrails child, and the same child flags the provider-swap child as
 * stale for claiming it available). Whether that is a regional limit, an
 * account entitlement, or an incomplete marketplace subscription was NOT
 * determined — it was deliberately not chased on 2026-08-21.
 *
 * So this is the closest usable member of the same family, and it is the id
 * production is already observed serving, which makes it known good here.
 *
 * Not a placeholder — do not "fix" it to a Sonnet 5 id on the strength of the
 * catalog listing it. That is exactly the unrecognised-or-forbidden model
 * failure AC-16 exists to prevent, and it fails silently: the reveal simply
 * shows an empty model panel. Change it only after a Sonnet 5 call has
 * actually succeeded on this account.
 */
export const GRADER_MODEL_BEDROCK = 'us.anthropic.claude-sonnet-4-6';

/** The grader id for the provider actually in use (AC-16). */
export function resolveGraderModel(provider: ProviderName): string {
  return provider === 'bedrock'
    ? GRADER_MODEL_BEDROCK
    : GRADER_MODEL_ANTHROPIC;
}

/** Vision calls are slower than text; a problem's first guesser waits. */
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

