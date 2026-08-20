// Beta (return-to-climbing rehab planner) constants, spec 0004.
// The caps are product decisions from the spec, not deployment config,
// so they are constants rather than env vars ("Configuration required: none new").

export const INJURY_AREAS = [
  'finger_pulley',
  'elbow_tendinopathy',
  'shoulder_impingement',
] as const;
export type InjuryArea = (typeof INJURY_AREAS)[number];

export const SYMPTOMS = [
  // Red flag checkboxes (AC-2) — the screener hard-blocks on these.
  'sudden_pop_with_swelling',
  'numbness_or_tingling',
  'cannot_bear_weight_or_grip',
  'night_pain',
  // Common non-red-flag symptoms.
  'pain_with_specific_holds_or_moves',
  'pain_at_session_start_that_warms_up',
  'morning_stiffness',
  'mild_swelling',
  'tenderness_to_touch',
  'weakness_or_early_fatigue',
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

export const PAIN_BEHAVIORS = [
  'none_at_rest_hurts_under_load',
  'warms_up_then_fine',
  'worsens_as_session_goes_on',
  'constant_even_at_rest',
] as const;
export type PainBehavior = (typeof PAIN_BEHAVIORS)[number];

export const DISCIPLINES = ['bouldering', 'sport', 'trad', 'indoor_gym'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const EQUIPMENT_ACCESS = [
  'climbing_gym',
  'home_wall',
  'hangboard',
  'resistance_bands',
  'weights',
  'none',
] as const;
export type EquipmentAccess = (typeof EQUIPMENT_ACCESS)[number];

export const RED_FLAG_CATEGORIES = [
  'sudden_pop_with_swelling',
  'numbness_or_tingling',
  'cannot_bear_weight_or_grip',
  'night_pain',
] as const;
export type RedFlagCategory = (typeof RED_FLAG_CATEGORIES)[number];

// Fixed, human-written copy per category (AC-2): kind, plain language, names
// the symptom category and the kind of professional to see. Deliberately not
// model-written so the safety-critical wording is deterministic.
export const RED_FLAG_MESSAGES: Record<RedFlagCategory, string> = {
  sudden_pop_with_swelling:
    'A sudden pop or snap at the moment of injury — with or without swelling — can mean a pulley or tendon has torn, and that deserves a proper look before any rehab plan. Please see a sports medicine doctor or a hand specialist soon. They can image it, grade it, and get you on the right track. This tool is not the right next step for that symptom.',
  numbness_or_tingling:
    'Numbness or tingling points at a nerve, and nerves need a real assessment, not a generic plan. Please see a doctor or a physical therapist trained in nerve evaluation before loading anything. Once a professional has cleared it, a staged return makes sense. This tool is not the right next step for that symptom.',
  cannot_bear_weight_or_grip:
    'Not being able to bear weight or use your hand suggests something structural that needs a professional exam first. Please see a doctor promptly, ideally sports medicine or orthopedics. A plan from a website is not the right next step until they have ruled out the serious stuff.',
  night_pain:
    'Pain that wakes you at night can point beyond a simple strain, and that is worth ruling out properly. Please see a physician before starting any loading program. Once they have cleared it, a staged return to climbing is a great goal. This tool is not the right next step for that symptom.',
};

// Constant pain at rest, weeks after onset or alongside swelling/weakness,
// is one of the classic screening signs for something beyond a simple
// strain. Escalated in code (clinical audit), not left to the drafter.
/**
 * Substituted into a plan when the drafter omits the caution `drafter.md:27`
 * calls MANDATORY for `constant_even_at_rest`. Transcribes that line's own
 * wording, which is anchored to ONSET and matched to the api's own
 * escalation threshold: the constant-rest-pain hard block fires at
 * `onsetWeeksAgo >= 3`, so this sentence must not point a visitor past
 * the point the product itself stops planning. An earlier version said
 * "a couple of weeks" from reading time, which did exactly that.
 *
 * This is NOT the hard-block refusal — CONSTANT_REST_PAIN_MESSAGE below is
 * what a visitor sees when the escalation fires and no plan is drafted at
 * all. This one is woven into a plan that IS being delivered, for the
 * visitor who sits under the hard block's thresholds and still reported
 * pain at rest.
 */
export const MANDATORY_REST_PAIN_CAUTION =
  'Pain that stays constant even at rest, and has not clearly improved by about ' +
  'three weeks from when it started, deserves a professional assessment.';

export const CONSTANT_REST_PAIN_MESSAGE =
  'Pain that stays constant even at rest — this long after the injury, or together with swelling or weakness — can point beyond a simple strain, and that is worth ruling out properly. Please see a physician or physical therapist before starting any loading program. Once they have cleared it, a staged return to climbing is a great goal.';

export const RED_FLAG_FALLBACK_MESSAGE =
  'Something you described sounds like it needs a professional assessment before any rehab plan. Please see a sports medicine doctor or physical therapist first. This tool is not the right next step for that symptom.';

export const REFUSAL_MESSAGE =
  'This tool only drafts educational return-to-climbing plans from the injury details in the form. It cannot help with that request. If you have a climbing injury, fill in the form fields and it will gladly draft a staged plan.';

export const FRIENDLY_ERROR_MESSAGE =
  'Something went wrong on our side while drafting your plan. Nothing you entered was stored. This attempt did not count against your daily limit, so please try again in a moment.';

/**
 * Plans per day, globally.
 *
 * Sized so that THIS cap is the one that binds first, which is the only way
 * it is worth having. At a measured ~$0.05 a plan (the Sonnet 5 drafter's
 * ~2,500 output tokens dominate), 20 a day is about $30 a month, leaving
 * room under the account's $50 monthly Anthropic limit for the interview
 * simulator, the daily game, and development.
 *
 * The previous 40 was about $60 a month, ABOVE that limit, so the account
 * would have run out first. The difference matters: this cap fails
 * gracefully (DEMO_BUDGET_MESSAGE, the form stays browsable, resets at
 * midnight UTC), while the account limit fails as raw API errors behind the
 * generic friendly error and does not reset until the month does.
 *
 * Raising it is a spend decision, not a code one: raise the Anthropic
 * account limit first, or this simply stops being the constraint again.
 */
export const BETA_GLOBAL_DAILY_CAP = 20;
export const BETA_IP_DAILY_CAP = 6;

export const DEMO_BUDGET_MESSAGE =
  `Today's demo budget is used up. Beta caps itself at ${BETA_GLOBAL_DAILY_CAP} plans a day so a portfolio project never runs away with the AI bill. The cap resets at midnight UTC, so please come back then. You can still browse the page and see how it works.`;

export const IP_LIMIT_MESSAGE =
  'You have reached the daily limit of 6 plans. The cap keeps this free demo available for everyone. It resets at midnight UTC.';

// Per-agent models (spec 0004 Agent pipeline): Haiku screens and coaches,
// the current Sonnet drafts. Fixed at build time, not env-configurable.
export const SCREENER_MODEL = 'claude-haiku-4-5';
export const DRAFTER_MODEL = 'claude-sonnet-5';
export const COACH_MODEL = 'claude-haiku-4-5';

// Per call: 60 second hard timeout, one retry on 5xx or timeout (spec 0004).
export const AGENT_CALL_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Spec 0005 guardrails child — layer 1 (constrain the drafter) constants.
//
// EVERY constant below is a TRANSCRIPTION of a line that already ships in
// skills/drafter.md or skills/coach.md. None of them encodes a view about
// what is clinically valid: an allowlist would need to know everything that
// is valid (judgement, out of scope), a prohibition list needs only to read
// the file (transcription, in scope). If a skill file's prohibitions change,
// these must change with them — nothing in the repo will point at the cause.
// ---------------------------------------------------------------------------

/**
 * Normalizes text for substring matching: lowercase, hyphens and underscores
 * to spaces, whitespace collapsed. Shared by every layer 1 and layer 2 check
 * so "full-crimp", "Full Crimp" and "full  crimp" all match one pattern.
 */
/**
 * Contractions expanded before matching, so a blocklist can be written in
 * plain English and still catch the way a model actually writes.
 *
 * The recovery-promise list says "you will be back"; the coach, instructed to
 * write warmly, writes "you'll be back to V5 climbing soon" — and the rule
 * that exists for exactly that sentence never saw it. Warm English uses
 * contractions, so the rules were catching the stiff phrasing and missing the
 * natural one.
 *
 * A fixed list, deliberately never a generic `'s -> is` rule, which would
 * mangle every possessive ("the climber's finger" is not "the climber is
 * finger"). Anything not listed here is left exactly as written.
 *
 * Applied to MODEL OUTPUT, not to visitor input. The injection blocklist
 * opts out (`expandContractions: false`): it holds the phrase "you are now",
 * so expanding turned an ordinary sentence like "my gym changed hands and
 * you're now looking at a different wall set" into a refusal, the same false
 * refusal class as the old substring match on "act as" firing on "react as".
 * The coverage given up is negligible, since a real injection carries other
 * markers the blocklist still matches and the screener reads the language
 * itself, while a wrongly refused visitor loses the whole form they filled in.
 */
const CONTRACTIONS: Readonly<Record<string, string>> = {
  "you'll": 'you will',
  "you're": 'you are',
  "you've": 'you have',
  "you'd": 'you would',
  "we'll": 'we will',
  "we're": 'we are',
  "we've": 'we have',
  "we'd": 'we would',
  "they'll": 'they will',
  "they're": 'they are',
  "they've": 'they have',
  "i'll": 'i will',
  "i'm": 'i am',
  "i've": 'i have',
  "it'll": 'it will',
  "it's": 'it is',
  "that's": 'that is',
  "there's": 'there is',
  "here's": 'here is',
  "what's": 'what is',
  "let's": 'let us',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "won't": 'will not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "shouldn't": 'should not',
  "wouldn't": 'would not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "hadn't": 'had not',
};

const CONTRACTION_PATTERN = new RegExp(
  `\\b(?:${Object.keys(CONTRACTIONS)
    .map((c) => c.replace("'", "'"))
    .join('|')})\\b`,
  'g',
);

export function normalizeForMatch(
  text: string,
  { expandContractions = true }: { expandContractions?: boolean } = {},
): string {
  const folded = text
    .toLowerCase()
    // Curly and modifier apostrophes folded onto the straight one FIRST. A
    // model that emits "you\u2019ll" would otherwise slip past the expansion
    // below and silently defeat every rule that depends on it.
    .replace(/[\u2018\u2019\u02BC\u02B9]/g, "'");
  return (
    expandContractions
      ? folded.replace(CONTRACTION_PATTERN, (match) => CONTRACTIONS[match] ?? match)
      : folded
  )
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Transcribes drafter.md, finger_pulley section, last bullet:
 *   "Never program full-crimp training."
 * Applied to exercise names in EVERY stage of a `finger_pulley` plan.
 * Deliberately does NOT match "half crimp", which the same section calls
 * correct in later stages ("gradual half-crimp reintroduction under load").
 */
export const FULL_CRIMP_PATTERN = 'full crimp';

/**
 * Transcribes drafter.md, finger_pulley section, "Early:" bullet (line 38):
 *   "No crimping of any kind."
 * Applied to exercise names in STAGE 1 ONLY of a `finger_pulley` plan.
 * The skill file's three phases (early / middle / later) do not map onto
 * four or five stages without a judgement call, so only the part that
 * transcribes cleanly — the earliest stage — is enforced (spec: an earlier
 * draft's "stages 1 or 2" was narrowed for exactly this reason).
 *
 * The bare token. Do not test it with `includes()` — use
 * `namePrescribesCrimping()` below, which is what the prohibition means.
 */
export const ANY_CRIMP_PATTERN = 'crimp';

/**
 * The same drafter.md line 38 that this check transcribes is also the line
 * the drafter READS, which makes it likely to name a stage 1 exercise
 * defensively: "Open-hand tendon glides (no crimping)", "Non-crimp finger
 * extensions", "Rice bucket work — avoid crimping". A bare substring match
 * throws on all three, so the drafter obeying the safety instruction was the
 * thing that cost an A2-pulley visitor their plan.
 *
 * The prohibition is on PRESCRIBING crimping, not on the letters appearing.
 * So negated mentions are stripped before the token is looked for. What
 * survives stripping is an affirmative crimp instruction and still fires:
 * "Half-crimp isometric holds" in stage 1 throws exactly as before, and so
 * does a mixed name like "Open-hand glides (no crimping), then half-crimp".
 *
 * Note `open hand` is drafter.md's affirmative opposite (line 38's own
 * prescription, "gentle open-hand putty or rice-bucket work"), but it is
 * deliberately NOT treated as a blanket exemption: "Open-hand into half-crimp
 * transition" is a real stage 1 violation that such an exemption would miss.
 */
const CRIMP_NEGATION_PATTERN =
  /\b(?:no|non|not|never|without|avoid(?:s|ing)?|excluding|instead\s+of|rather\s+than|stop|limit(?:ing)?|minimi[sz]e|reduce|refrain\s+from)\s*(?:any\s+)?(?:kind\s+of\s+)?(?:full[\s-]+|half[\s-]+|open[\s-]+)?crimp\w*/g;

/**
 * True when a normalized exercise name programs crimping, as opposed to
 * merely mentioning it in order to rule it out. Input must already have been
 * through `normalizeForMatch`.
 */
/**
 * Full-crimp counterpart of `namePrescribesCrimping`. Same reason it exists:
 * `drafter.md:42` ("Never program full-crimp training") is the line the
 * drafter is most heavily primed on, so a defensively named exercise --
 * "Open-hand hangs (no full crimping)" -- is likely output, and a bare
 * substring test threw the whole plan away for obeying the instruction.
 */
export function namePrescribesFullCrimp(normalizedName: string): boolean {
  return normalizedName
    .replace(CRIMP_NEGATION_PATTERN, ' ')
    .includes(FULL_CRIMP_PATTERN);
}

export function namePrescribesCrimping(normalizedName: string): boolean {
  return normalizedName
    .replace(CRIMP_NEGATION_PATTERN, ' ')
    .includes(ANY_CRIMP_PATTERN);
}

/**
 * Dose field bounds for the drafter's structured `dose` object.
 *
 * DELIBERATELY NO UPPER BOUND. These are variance bounds, never clinical
 * dose limits. The spec derives an upper bound from a calibration run that
 * observes what the drafter actually produces; that run has NOT been done
 * (it needs repeated live Anthropic calls against the shared production
 * daily caps). The spec's own documented fallback for that case is
 * "positive integers with no upper bound", which keeps the anti-drift
 * benefit of the structured shape without anyone inventing a ceiling.
 * Adding a maximum here without the calibration run would convert a guess
 * into a permanent ceiling on what the product can prescribe.
 */
export const DOSE_MIN = 1;

/**
 * Length cap on the drafter's per-stage `rationale` string. A token budget,
 * not a constraint on content — `rationale` restricts nothing and encodes no
 * view about what is valid; it only asks the drafter to state its reasoning
 * before it prescribes.
 */
export const RATIONALE_MAX_LENGTH = 400;

/**
 * Pre-model prompt-attack check over the only untrusted free text in a Beta
 * request (`goals`, capped at 200 chars by the DTO). Not a general content
 * filter: every other field is an enum or a regex-constrained grade. Run
 * before any model call and before `reserveGlobalSlot()`, like the two
 * existing code-enforced hard blocks. A hit shows the existing
 * REFUSAL_MESSAGE — the same copy an `off_topic` screener verdict produces.
 *
 * This does not replace the screener's `off_topic` verdict, which stays as
 * the layer that understands language rather than matching strings.
 */
/**
 * Stored in the SINGULAR where a phrase has a plural, because the matcher
 * below allows an optional trailing "s". "system prompt" therefore covers
 * "system prompts", which `\b` anchoring alone missed: the boundary fails
 * when the next character is a word character, so the plural walked past a
 * rule written for exactly it.
 */
export const INJECTION_BLOCKLIST = [
  'ignore your instruction',
  'ignore the above',
  'disregard your',
  'you are now',
  'system prompt',
  'new instruction',
  'act as',
] as const;

/** Escapes every regex metacharacter so a blocklist phrase matches literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The blocklist compiled to whole-word matchers, built ONCE at module load
 * from the constant list above. Never built from request data: no regex in
 * this codebase is constructed from visitor text, and that must stay true
 * (security review), so this is module scope rather than per-request.
 *
 * Word boundaries, not `String.includes`. A substring match on `act as`
 * fires on ordinary English — "re|act as| it used to", "cont|act as| soon
 * as", "ex|act as| before" — and because a hit shows REFUSAL_MESSAGE it can
 * replace a red-flag warning with a generic refusal. `\b` requires the
 * phrase to start and end on a word boundary, so only the standalone phrase
 * matches. Every phrase begins and ends with a word character, which is what
 * makes `\b` the right anchor; a phrase added with leading or trailing
 * punctuation would need a different one.
 */
const INJECTION_PATTERNS: readonly RegExp[] = INJECTION_BLOCKLIST.map(
  // `s?` before the closing boundary, so a phrase stored in the singular
  // also matches its plural. Without it "system prompts" slipped past the
  // rule written for "system prompt": `\b` fails when the next character is
  // a word character, so the plural was not a near miss, it was invisible.
  (phrase) => new RegExp(`\\b${escapeRegExp(phrase)}s?\\b`),
);

/**
 * True when the already-normalized text contains a blocklist phrase as whole
 * words. Callers pass the output of `normalizeForMatch`. Matching only —
 * never logs or stores what matched.
 */
export function matchesInjectionBlocklist(normalized: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
