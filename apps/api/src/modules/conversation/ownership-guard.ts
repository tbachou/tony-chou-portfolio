import { StoryOwnership } from '../../generated/prisma/enums';
import type { StoryModel } from '../../generated/prisma/models';

export const HEDGE_PHRASES = [
  'contributed to',
  'co-led',
  'helped',
  'worked on',
  'part of a team that',
];

export const SOLE_CREDIT_VERBS = [
  'i built',
  'i created',
  'i designed the whole',
  'i solely',
];

// Derived from KNOWLEDGE_BASE.md's "Explicitly NOT verified" section (AC-9).
// A blocklist, not full language understanding: catches the obvious phrasing of
// each item, not every way a model could imply the same false claim.
const NEVER_CLAIM_PHRASES = [
  'i built the linear integration',
  'i built linear',
  'my linear integration',
  'i integrated linear',
  'i created the linear integration',
  'i implemented the linear integration',
  'i developed the linear integration',
  'i built the google docs integration',
  'i integrated google docs',
  'my google docs integration',
  'i created the google docs integration',
  'i implemented the google docs integration',
  '500+ users',
  'over 500 users',
  '500 users',
];

const PRODUCT_FORGE_NUMERIC_CLAIM = /\d+%|\$[\d,]+/;

/**
 * Present-tense claims of clinical credentials Tony does not hold. He no
 * longer practices, his OT licence is not current, and his C/NDT certification
 * is expired (the never-claim list in skills/tony.md leads with this; it is the
 * only item there that misrepresents a real regulated qualification).
 *
 * Anchored on TENSE, not on the credential words. "I was a licensed
 * occupational therapist for six years" is true and must pass; blocklisting
 * "licensed occupational therapist" outright would suppress the honest answer
 * and teach the guard to fire on the truth. Every pattern therefore requires a
 * present-tense subject ("I am", "I'm", "I still") or a present-tense copula
 * ("is current"), so a past-tense or negated sentence never matches.
 */
const CURRENT_CLINICAL_CREDENTIAL = new RegExp(
  [
    // "I am a licensed occupational therapist", "I'm currently licenced"
    "\\bi(?:'m| am) (?:an? )?(?:currently )?licen[sc]ed\\b",
    // "I am an occupational therapist", "I'm an OT"
    "\\bi(?:'m| am) (?:an? )?(?:occupational therapist|ot)\\b",
    // "I still practice", "I currently treat patients"
    "\\bi (?:still|currently) (?:practi[cs]e|treat|see patients)\\b",
    // "my OT licence is current", "my C/NDT is still valid"
    "\\bmy [^.]{0,40}(?:licen[sc]e|certification|c/ndt) is (?:still )?(?:current|active|valid|up to date)\\b",
  ].join("|"),
);

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function evaluateTonyResponse(
  text: string,
  story: StoryModel,
): GuardResult {
  // An empty answer is a failed answer, not a safe one. Without this the guard
  // returns ok for '', the blank text persists as Tony's turn, and
  // loadConversation later drops it from the transcript — leaving the next
  // prompt holding a question with no answer under it. Failing here routes it
  // to the same fallback every other guard failure uses, so a persisted Tony
  // row is always non-empty and a blank row means one thing only: a slot
  // reserved but never generated.
  if (text.trim().length === 0) {
    return { ok: false, reason: 'empty response' };
  }

  const lower = text.toLowerCase();

  for (const phrase of NEVER_CLAIM_PHRASES) {
    if (lower.includes(phrase)) {
      return { ok: false, reason: `never claim blocklist match: "${phrase}"` };
    }
  }

  if (CURRENT_CLINICAL_CREDENTIAL.test(lower)) {
    return {
      ok: false,
      reason: 'present-tense clinical credential Tony does not hold',
    };
  }

  if (
    story.engagement.includes('Product Forge') &&
    PRODUCT_FORGE_NUMERIC_CLAIM.test(text)
  ) {
    return {
      ok: false,
      reason: 'unverified numeric business outcome for Product Forge',
    };
  }

  if (story.ownership !== StoryOwnership.SOLO) {
    const hasHedge = HEDGE_PHRASES.some((phrase) => lower.includes(phrase));
    const hasSoleCreditVerb = SOLE_CREDIT_VERBS.some((verb) =>
      lower.includes(verb),
    );
    if (hasSoleCreditVerb && !hasHedge) {
      return {
        ok: false,
        reason: 'unhedged sole credit verb with no hedge phrase present',
      };
    }
  }

  return { ok: true };
}

// Used only when the never-claim blocklist fires on a SOLO story, which has no
// requiredFraming (that field is scripted specifically for non-SOLO stories).
export const GENERIC_GUARD_FALLBACK =
  "That's not something I can speak to confidently, let's keep to what's verified in my work.";

// Splits already-decided text into small chunks so it still streams as multiple
// SSE token events (AC-3's contract), even though the guard requires the full
// response to be known before anything is shown.
export function splitIntoChunks(text: string): string[] {
  return text.split(/(?<=\s)/).filter((chunk) => chunk.length > 0);
}
