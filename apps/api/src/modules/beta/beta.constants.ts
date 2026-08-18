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
    'A sudden pop followed by swelling can mean a pulley or tendon has torn, and that deserves a proper look before any rehab plan. Please see a sports medicine doctor or a hand specialist soon. They can image it, grade it, and get you on the right track. This tool is not the right next step for that symptom.',
  numbness_or_tingling:
    'Numbness or tingling points at a nerve, and nerves need a real assessment, not a generic plan. Please see a doctor or a physical therapist trained in nerve evaluation before loading anything. Once a professional has cleared it, a staged return makes sense. This tool is not the right next step for that symptom.',
  cannot_bear_weight_or_grip:
    'Not being able to bear weight or use your hand suggests something structural that needs a professional exam first. Please see a doctor promptly, ideally sports medicine or orthopedics. A plan from a website is not the right next step until they have ruled out the serious stuff.',
  night_pain:
    'Pain that wakes you at night can point beyond a simple strain, and that is worth ruling out properly. Please see a physician before starting any loading program. Once they have cleared it, a staged return to climbing is a great goal. This tool is not the right next step for that symptom.',
};

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
