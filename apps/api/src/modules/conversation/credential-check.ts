import { z } from 'zod';

import { normalizeForMatch } from './ownership-guard.js';

export const CREDENTIAL_VERDICT_CATEGORIES = [
  'current_claim',
  'past_tense_ok',
  'no_credential_mentioned',
  'ambiguous',
] as const;

export type CredentialVerdictCategory =
  (typeof CREDENTIAL_VERDICT_CATEGORIES)[number];

export const CredentialVerdict = z.object({
  reasoning: z
    .string()
    .describe('One sentence: which part of the answer decided this, and why'),
  category: z
    .enum(CREDENTIAL_VERDICT_CATEGORIES)
    .describe('The single verdict category for this answer'),
});

const { $schema, ...schema } = z.toJSONSchema(CredentialVerdict);

export const CREDENTIAL_VERDICT_SCHEMA = schema;

export const CREDENTIAL_CHECK_MODEL = 'claude-haiku-4-5';

/**
 * Spec 0013's pinned prefilter list, plus `caseload`.
 *
 * DELIBERATELY OVER-INCLUSIVE, and the asymmetry is the whole design: several
 * of these fire on ordinary engineering talk ("practice", "certif",
 * "credential"), which costs one cheap model call. A miss costs the safety
 * check entirely, and silently. This is the opposite of the trade inside the
 * guard, and the difference is the point.
 *
 * `caseload` is not in the spec's pinned list and was added 2026-09-21 after
 * the corpus caught it: "I could take a caseload again tomorrow." is a claim,
 * names no other clinical word, and routed nowhere. Under Option 3 the
 * deterministic guard still blocks it, which is what kept the gap invisible —
 * under Option 4 nothing would have.
 */
const CLINICAL_TOPIC_WORDS = [
  'occupational',
  'therapist',
  'therapy',
  'licen',
  'credential',
  'certif',
  'ndt',
  'nbcot',
  'otr',
  'clinic',
  'patient',
  'rehab',
  'practi',
  'caseload',
] as const;

const CLINICAL_TOPIC = new RegExp(
  [...CLINICAL_TOPIC_WORDS, '(?<![-\\w])ot(?![-\\w])'].join('|'),
);

/**
 * Normalises internally rather than trusting the caller. The parameter used to
 * be named `lower` and the normalisation was the call site's job, which is a
 * footgun on this path specifically: the prefilter's failure mode is ASYMMETRIC
 * — a false positive costs one cheap model call, a false negative skips the
 * safety check entirely and silently. Passing raw text under the old contract
 * missed every capitalised "OT", which is most of them.
 */
export function needsCredentialCheck(text: string): boolean {
  return CLINICAL_TOPIC.test(normalizeForMatch(text));
}

/**
 * Substituted whenever this layer suppresses an answer — a positive verdict,
 * an ambiguous one, or a failure. The generic guard fallback deflects, and a
 * story's `requiredFraming` is an OWNERSHIP sentence, so a visitor who asked
 * "are you still licensed?" got a line about who built the editing layer. The
 * true answer is short and responsive, so say it rather than dodging.
 */
export const CREDENTIAL_GUARD_FALLBACK =
  "I was a licensed occupational therapist for six years, but I don't practice now — my licence isn't current and my C/NDT certification is expired. These days I'm a software engineer, and that's the work I can speak to.";

export type CredentialFailureCategory =
  'timeout' | 'provider_error' | 'unparsable';

export type CredentialVerifierResult = {
  /**
   *  True means replace the answer. Named for the ACTION, not the finding:
   * every failure category suppresses too
   */
  suppress: boolean;
  category: CredentialVerdictCategory | CredentialFailureCategory;
  reasoning?: string;
  inputTokens: number;
  outputTokens: number;
};
