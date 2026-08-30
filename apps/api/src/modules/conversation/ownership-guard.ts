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
const UNVERIFIED_USER_FIGURE = /\b(?:over |about |around )?500\+? users\b/g;

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
 * phrasings of the exact claim this guard exists to stop.
 *
 * NO comparative is listed, including "bigger than". "It was larger than 500
 * users" is grammatically identical to an assertion of at least 500; whether it
 * corrects or claims depends on the world, not the sentence, and a guard cannot
 * read the world. A model that must deny the figure should do so without
 * repeating it ("the reach was millions"), which is a prompt rule, not
 * something to buy here by widening the whitelist.
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
  return /(?:nowhere near|rather than|n't|\bnot\b(?! only)|\bnever\b)\s*$/.test(
    preceding,
  );
}

/**
 * Present-tense claims of clinical credentials Tony does not hold. He no longer
 * practices, his OT licence is not current, and his C/NDT certification is
 * expired. skills/tony.md leads its never-claim list with this: it is the only
 * item there that misrepresents a real, regulated qualification.
 *
 * A span check, not one regex. The regex version required the credential word
 * to sit immediately after "I am", so a single filler defeated it — "I'm still
 * a licensed OT", "I remain a licensed OT", "I hold a current OT license" all
 * walked through. Allowing filler in a regex instead re-imports the negation
 * problem, because "I am not a licensed OT any more" is honest and must pass.
 *
 * So: find a present-tense subject, read the short span after it, and block
 * only when that span names a credential AND carries no past-tense or negating
 * marker. The marker list is the load-bearing part — every honest phrasing of
 * "I used to be one" has to contain one of them.
 */
const CLINICAL_SUBJECT =
  /\bi(?:'m| am|\s+still|\s+currently|\s+remain|\s+hold)\b|\bas an? licen[sc]ed\b/g;

/** Naming one of these is what makes a span a credential claim. */
const CLINICAL_CREDENTIAL =
  /\b(?:licen[sc]ed|licen[sc]e|c\/ndt|practi[cs](?:e|ing)|occupational therapist|ot|(?:treat|treating|see|seeing) patients)\b/;

/**
 * Any of these in the span means it is not a claim of a CURRENT credential.
 * "occupational therapy" as a field of study is deliberately absent from the
 * credential list above for the same reason: the M.S. is real and held.
 */
const NOT_A_CURRENT_CLAIM =
  /\b(?:not|no longer|never|used to|formerly|was|were|until|before|prior|expired|lapsed|worked|spent|then|ex)\b/;

function claimsCurrentClinicalCredential(lower: string): boolean {
  for (const match of lower.matchAll(CLINICAL_SUBJECT)) {
    const span = lower.slice(match.index, match.index + 70);
    if (
      CLINICAL_CREDENTIAL.test(span) &&
      !NOT_A_CURRENT_CLAIM.test(span)
    ) {
      return true;
    }
  }
  // "my OT licence is current" has no first-person subject to anchor on.
  return /\bmy [^.]{0,40}(?:licen[sc]e|certification|c\/ndt) is (?:still )?(?:current|active|valid|up to date)\b/.test(
    lower,
  );
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

const BLANK_CHARACTERS =
  // \p{Cc} control characters (a truncated stream chunk, a stray byte),
  // \p{Cs} lone surrogates, \p{Co} private use, plus the named fillers that
  // belong to visible categories but render as nothing: Hangul fillers and the
  // blank Braille pattern. \p{Cn} cannot be expressed as a property escape in
  // JS, which is why the tail is enumerated.
  /[\s\p{Cf}\p{Mn}\p{Cc}\p{Cs}\p{Co}\u115F\u1160\u3164\u2800\uFFFC]/gu;

export function isBlankResponse(text: string): boolean {
  return text.replace(BLANK_CHARACTERS, '').length === 0;
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

  // EVERY occurrence, not just the first: "it wasn't 500 users at launch, we
  // hit over 500 users by week two" opens with a denial and then makes the
  // claim, and checking only the first match launders the second.
  const claimed = [...lower.matchAll(UNVERIFIED_USER_FIGURE)].find(
    (match) => !isRejectedFigure(lower, match.index),
  );
  if (claimed) {
    return {
      ok: false,
      reason: `never claim blocklist match: "${claimed[0]}"`,
    };
  }

  if (claimsCurrentClinicalCredential(lower)) {
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
