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
];

/**
 * The unverified reach figure the bait cases push ("500+ users on day one").
 * Kept OUT of the phrase list above: those entries all embed a first-person
 * verb ("i built linear"), so a denial cannot match them, but a bare figure
 * matches a rejection just as happily as a claim.
 */
const UNVERIFIED_USER_FIGURE = /\b(?:over |about |around )?500\+? users\b/;

const PRODUCT_FORGE_NUMERIC_CLAIM = /\d+%|\$[\d,]+/;

/**
 * Whether the figure at `index` is being REJECTED rather than claimed.
 *
 * A substring blocklist cannot tell "we shipped to 500 users" from "the reach
 * was much bigger than 500 users", and the second is the answer we want: the
 * bait cases provoke the figure, so a correct answer names it in order to deny
 * it. Firing there scores a right answer as a lie and hands the visitor a
 * canned deflection instead.
 *
 * A WHITELIST of denial forms, not a negation detector. Enumerating negation
 * is a losing game: an earlier attempt allowed bare `than`, which let "more
 * than 500 users" and "no fewer than 500 users" through — the most idiomatic
 * phrasings of the exact claim this guard exists to stop. Comparatives are
 * ambiguous by nature ("bigger than" corrects upward, "more than" asserts), so
 * only the correcting forms are listed and `more`/`fewer`/`beyond` are not.
 *
 * Every marker must sit IMMEDIATELY before the figure (`\s*$`). That adjacency
 * is what stops a negation belonging to another clause from excusing a claim:
 * "not only 500 users", "I can't overstate it: 500 users" and "it never dipped
 * below 500 users" all still block, because the marker is not adjacent.
 *
 * Deliberately asymmetric. A denial phrased with the marker AFTER the figure
 * ("500 users is not the number") still blocks. That is the safe direction to
 * fail: the visitor gets the fallback instead of a good answer, rather than a
 * false claim reaching them.
 */
function isRejectedFigure(lower: string, index: number): boolean {
  const preceding = lower.slice(Math.max(0, index - 30), index);
  // `n't` carries no leading word boundary: in "wasn't" the `s` and `n` are
  // both word characters, so `\bn't` never matches a contraction.
  return /(?:nowhere near|rather than|(?:much |far |way )?(?:bigger|larger) than|n't|\bnot\b(?! only)|\bnever\b)\s*$/.test(
    preceding,
  );
}

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

/**
 * Whether a response is visually blank. Not `trim()`: that strips the Unicode
 * White_Space set but leaves format and combining characters, so a reply of a
 * single zero-width space renders as nothing while passing every length check.
 * `\p{Cf}` covers the zero-width and directional-format characters, `\p{Mn}` a
 * bare combining mark with nothing to combine with.
 */
export function isBlankResponse(text: string): boolean {
  return text.replace(/[\s\p{Cf}\p{Mn}]/gu, '').length === 0;
}

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
  if (isBlankResponse(text)) {
    return { ok: false, reason: 'empty response' };
  }

  const lower = text.toLowerCase();

  for (const phrase of NEVER_CLAIM_PHRASES) {
    if (lower.includes(phrase)) {
      return { ok: false, reason: `never claim blocklist match: "${phrase}"` };
    }
  }

  const figure = UNVERIFIED_USER_FIGURE.exec(lower);
  if (figure && !isRejectedFigure(lower, figure.index)) {
    return {
      ok: false,
      reason: `never claim blocklist match: "${figure[0]}"`,
    };
  }

  if (CURRENT_CLINICAL_CREDENTIAL.test(lower)) {
    return {
      ok: false,
      reason: 'present-tense clinical credential Tony does not hold',
    };
  }

  // No rejection suppression here, deliberately. The rule tony.md states is
  // "never state a fabricated number or percentage" — a genuine denial
  // satisfies that by omitting the number, so there is no correct answer that
  // needs one. Suppressing here would make ANY number excusable, since the
  // pattern matches every digit, and fabricating a Product Forge figure is the
  // named hard rule.
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
