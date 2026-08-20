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
export const CONSTANT_REST_PAIN_MESSAGE =
  'Pain that stays constant even at rest — this long after the injury, or together with swelling or weakness — can point beyond a simple strain, and that is worth ruling out properly. Please see a physician or physical therapist before starting any loading program. Once they have cleared it, a staged return to climbing is a great goal.';

export const RED_FLAG_FALLBACK_MESSAGE =
  'Something you described sounds like it needs a professional assessment before any rehab plan. Please see a sports medicine doctor or physical therapist first. This tool is not the right next step for that symptom.';

export const REFUSAL_MESSAGE =
  'This tool only drafts educational return-to-climbing plans from the injury details in the form. It cannot help with that request. If you have a climbing injury, fill in the form fields and it will gladly draft a staged plan.';

export const FRIENDLY_ERROR_MESSAGE =
  'Something went wrong on our side while drafting your plan. Nothing you entered was stored. This attempt did not count against your daily limit, so please try again in a moment.';

export const BETA_GLOBAL_DAILY_CAP = 40;
export const BETA_IP_DAILY_CAP = 6;

export const DEMO_BUDGET_MESSAGE =
  "Today's demo budget is used up. Beta caps itself at 40 plans a day so a portfolio project never runs away with the AI bill. The cap resets at midnight UTC, so please come back then. You can still browse the page and see how it works.";

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
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
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
  /\b(?:no|non|not|never|without|avoid(?:s|ing)?|excluding)\s*(?:any\s+)?(?:kind\s+of\s+)?crimp\w*/g;

/**
 * True when a normalized exercise name programs crimping, as opposed to
 * merely mentioning it in order to rule it out. Input must already have been
 * through `normalizeForMatch`.
 */
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
export const INJECTION_BLOCKLIST = [
  'ignore your instructions',
  'ignore the above',
  'disregard your',
  'you are now',
  'system prompt',
  'new instructions',
  'act as',
] as const;
