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
 * practices, holds no current OT licence, and his C/NDT certification is
 * expired. skills/tony.md leads its never-claim list with this: it is the only
 * item there that misrepresents a real, regulated qualification.
 *
 * Built from three shared fragments rather than a flat list of alternatives.
 * Five rounds of adversarial review each found a bypass or a false positive,
 * and most came from one branch being written slightly differently from its
 * neighbours: an unanchored `ot` that matched inside "remote" and "robot", a
 * branch missing the clinical noun so it fired on "licensed under MIT", a
 * window that bridged "I have" to a licence across the word "not". Sharing the
 * fragments is what stops the branches drifting apart again.
 *
 * The words this rule keys on are ordinary engineering vocabulary — "practice",
 * "license" and "OT" appear constantly in honest answers — so proximity alone
 * means nothing. Every branch requires BOTH a present-tense self-attribution
 * and CLINICAL, and none may span NEG.
 *
 * KNOWN CEILING, read before extending this. Eight rounds of adversarial review
 * found real bugs in every round, and after the first, most were introduced by
 * the previous round's fix. The regressions land in the same two places every
 * time: this file's two open-ended enumerations — NEG's word list and the
 * identity branch's noun exclusion. Both are attempts to enumerate natural
 * language ("which words mean this is a denial", "which words mean this OT
 * is not a claim"), neither can be completed, and each addition is itself
 * either a new bypass or a new blind spot.
 *
 * NEG also does two incompatible jobs in one token: it is a hard sentence-scope
 * limiter (`[^.?!]`) AND a semantic denial test (the word list), reused across
 * every branch, so tuning one job moves the other.
 *
 * Concretely accepted, because a word list cannot have both: `no` stays in NEG
 * so "I have no OT license" passes, which means "I have, with no interruption,
 * held an OT license" escapes. A false positive on a sentence he would really
 * say is worse than a false negative on one nobody writes.
 *
 * So: adding another alternative here is very likely to break something else.
 * The real fix is a second layer that can read a sentence — a small structured
 * call answering one narrow question — with this regex demoted to a cheap first
 * filter. Until that exists, prefer tightening skills/tony.md over adding a
 * branch here, and never change this file without re-running the adversarial
 * pass in /predeploy-audit.
 */

/** A clinical credential noun. `ot` needs both boundaries: without the
 *  lookbehind it matches inside "remote", "note", "robot", "screenshot". */
const CLINICAL =
  '(?:occupational therap(?:y|ist)|occupational therapy practitioner|(?<![-\\w])otr(?:/l)?(?![-\\w])|(?<![-\\w])o[./]?t(?![-\\w])|c/ndt|nbcot)';

/** Characters a window may span, stopping at a sentence end or any marker that
 *  makes the sentence past tense or a denial. This is what keeps "I have not
 *  held an occupational therapy license since 2019" — the most natural true
 *  sentence about the lapsed licence — out of the hold/have branch. */
const NEG =
  '(?:(?!\\b(?:not|never|no|no longer|used to|former|was|were|expired|lapsed|inactive|dormant)\\b)[^.?!])';

/** A credential adjective. */
const HELD = '(?:licen[sc]ed|registered|certified|practi[cs]ing)';

const CURRENT_CLINICAL_CREDENTIAL = new RegExp(
  [
    // "I am a licensed occupational therapist", "I'm a registered OT".
    // CLINICAL is required: without it this fires on "I'm licensed under MIT".
    `\\bi(?:'m| am)(?:, in fact,)? (?:still |currently |also |now )*(?:an? )?(?:still |currently )*${HELD} ?${NEG}{0,15}${CLINICAL}`,
    // "Yes, I am still licensed." No noun follows, but "still"/"currently"
    // asserts continuity of a credential he does not hold. Excluded when the
    // licence is bound to something else ("currently licensed to drive").
    `\\bi(?:'m| am) (?:still|currently) licen[sc]ed\\b(?! (?:under|to|for|as a [a-z]+ (?:driver|operator|pilot)))`,
    // "I am an occupational therapist", "I'm still an OT". A following noun
    // means the OT qualifies it rather than naming him: "OT alum", "OT school".
    `\\bi(?:'m| am) (?:still |currently )?(?:an? )?(?:${HELD} )?${CLINICAL}(?! (?:(?:alum|alumni|school|program|programme|student|graduate|grad|curriculum|degree|background|training|turned)\\b|by (?:training|background|education|schooling|degree)\\b))`,
    // "I remain a licensed OT"
    `\\bi remain (?:an? )?(?:${HELD} )?${CLINICAL}`,
    // "I hold a current OT license", "I have an active NBCOT certification",
    // "I hold, and have held without interruption since 2011, an OT license".
    // The window is wide but cannot cross NEG, so the honest denial passes.
    `\\bi (?:still |currently )?(?:hold|have|keep|maintain|renew)s?\\b${NEG}{0,60}${CLINICAL}${NEG}{0,20}(?:licen[sc]e|certification|credential|registration)`,
    // "I work as an occupational therapist"
    `\\bi work as an? ${CLINICAL}`,
    // "I am board certified in occupational therapy". CLINICAL required, so
    // "I am board certified in Kubernetes" passes.
    `\\bi(?:'m| am) board[- ]certified(?: in)?${NEG}{0,20}${CLINICAL}`,
    // Clinical practice, including the MODAL forms a visitor's question invites
    // ("could you still treat patients?" -> "I could still treat patients").
    // "still"/"currently" is optional: "I treat patients on Fridays" has no
    // honest engineering reading, while bare "practice" is gated on a clinical
    // object so "I still practice code review discipline" passes.
    `\\bi (?:can |could |do |am able to |would be able to )?(?:still |currently )?(?:practi[cs]e (?:occupational therapy|clinically|as an? ot)|treat patients|see patients|take a caseload)`,
    // "I am an OT program graduate who still sees patients weekly" — the claim
    // sits in a relative clause with a third-person verb, so no first-person
    // branch reaches it. Bound to a self-identification, so it cannot fire on
    // "I work with a therapist who still sees patients".
    `\\bi(?:'m| am) (?:still |currently )?(?:an? )?(?:${HELD} )?${CLINICAL}${NEG}{0,25}who (?:still |currently )?(?:sees|treats|works with) patients`,
    // "As a licensed occupational therapist, I see patients weekly"
    `\\bas an? ${HELD} ${CLINICAL},? i (?:see|treat|work with) patients`,
    // "my OT licence is current", "my C/NDT remains valid". No first-person
    // subject, so CLINICAL carries the anchor: without it this fired on
    // "my AWS certification is still valid" and "my remote branch is up to date".
    `\\bmy ${NEG}{0,25}${CLINICAL}${NEG}{0,25}(?:licen[sc]e|certification|credential|registration)? (?:is|remains) (?:still )?(?:current|active|valid|up to date|in good standing)`,
    // "my OT licence has not lapsed", "my C/NDT never expired" — a denial in
    // form, a claim in substance.
    `\\bmy [^.]{0,25}${CLINICAL}[^.]{0,30}(?:has ?n't|has not|never) (?:lapsed|expired)`,
  ].join('|'),
);

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Shared so the call site's fallback choice cannot drift from the reason. */
export const CREDENTIAL_GUARD_REASON =
  'present-tense clinical credential Tony does not hold';

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

  // Normalised, not just lowercased. Every "I'm" branch below is written with
  // an ASCII apostrophe, but U+2019 is the default typography of the model
  // whose output this reads — so "I’m a licensed occupational therapist"
  // walked straight through a guard that blocked the ASCII spelling.
  const lower = text
    .toLowerCase()
    // Every branch below is written with an ASCII apostrophe and single ASCII
    // spaces. U+2019 is the model's default typography, and a double space is
    // an ordinary stream-join artefact — either one silently bypassed the whole
    // guard. Indices stay self-consistent because isRejectedFigure slices
    // `lower` too; PRODUCT_FORGE_NUMERIC_CLAIM reads raw `text` and is digits
    // only, so nothing else shifts.
    .replace(/[\u2018\u2019\u02bc\u00b4\u2032\uff07`]/g, "'")
    .replace(/\s+/g, ' ');

  // First, ahead of the commercial rules: it is the only check here guarding a
  // real regulated qualification, and whichever branch fires first supplies the
  // reason that reaches the log and the eval record. Ordering it last let a
  // "500 users" match mask a licensure claim in the same answer.
  if (CURRENT_CLINICAL_CREDENTIAL.test(lower)) {
    return {
      ok: false,
      reason: CREDENTIAL_GUARD_REASON,
    };
  }

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
/**
 * Substituted when the credential check fires. The generic fallback deflects,
 * and `requiredFraming` is an OWNERSHIP sentence — so a visitor who asked "are
 * you still licensed?" got a line about who built the editing layer. The true
 * answer is short and responsive, so say it rather than dodging.
 */
export const CREDENTIAL_GUARD_FALLBACK =
  "I was a licensed occupational therapist for six years, but I don't practice now — my licence isn't current and my C/NDT certification is expired. These days I'm a software engineer, and that's the work I can speak to.";

export const GENERIC_GUARD_FALLBACK =
  "That's not something I can speak to confidently, let's keep to what's verified in my work.";

// Splits already-decided text into small chunks so it still streams as multiple
// SSE token events (AC-3's contract), even though the guard requires the full
// response to be known before anything is shown.
export function splitIntoChunks(text: string): string[] {
  return text.split(/(?<=\s)/).filter((chunk) => chunk.length > 0);
}
