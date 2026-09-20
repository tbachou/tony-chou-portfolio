import {
  type BetaStage,
  type Discipline,
  type EquipmentAccess,
  type InjuryArea,
  type PainBehavior,
  type Symptom,
} from '@/lib/beta-api';

/**
 * Display copy for the planner form and its pipeline.
 *
 * Every `value` here must match the api enum in beta.constants.ts exactly:
 * the server re-validates with the shared `.strict()` contract, so a typo
 * surfaces as a 400 rather than as a wrong label.
 */

export const ACK_STORAGE_KEY = 'beta-disclaimer-acknowledged-v1';


export const INJURY_OPTIONS: { value: InjuryArea; label: string; hint: string }[] = [
  {
    value: 'finger_pulley',
    label: 'Finger pulley strain',
    hint: 'Pain at the base of a finger, often worst on crimps',
  },
  {
    value: 'elbow_tendinopathy',
    label: "Climber's elbow",
    hint: 'Tendon pain on the inside or outside of the elbow',
  },
  {
    value: 'shoulder_impingement',
    label: 'Shoulder impingement',
    hint: 'Pinching pain overhead or on cross-body moves',
  },
];

export const SYMPTOM_LABELS: Record<Symptom, string> = {
  sudden_pop_with_swelling: 'A sudden pop, snap, or tearing feeling when it happened',
  numbness_or_tingling: 'Numbness or tingling',
  cannot_bear_weight_or_grip: 'Can’t bear weight, or can’t grip at all',
  night_pain: 'Pain that wakes me at night',
  pain_with_specific_holds_or_moves: 'Pain on specific holds or moves',
  pain_at_session_start_that_warms_up: 'Hurts at the start of a session, then eases',
  morning_stiffness: 'Morning stiffness',
  mild_swelling: 'Mild swelling',
  tenderness_to_touch: 'Tender to the touch',
  weakness_or_early_fatigue: 'Weakness or early fatigue',
};

export const PAIN_BEHAVIOR_LABELS: Record<PainBehavior, string> = {
  none_at_rest_hurts_under_load: 'Fine at rest, hurts under load',
  warms_up_then_fine: 'Warms up, then feels fine',
  worsens_as_session_goes_on: 'Gets worse as a session goes on',
  constant_even_at_rest: 'Constant, even at rest',
};

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  bouldering: 'Bouldering',
  sport: 'Sport',
  trad: 'Trad',
  indoor_gym: 'Indoor gym',
};

export const EQUIPMENT_LABELS: Record<EquipmentAccess, string> = {
  climbing_gym: 'Climbing gym',
  home_wall: 'Home wall',
  hangboard: 'Hangboard',
  resistance_bands: 'Resistance bands',
  weights: 'Weights',
  none: 'None of these',
};

export const PIPELINE_STAGES: { id: BetaStage; label: string }[] = [
  { id: 'screening', label: 'Screening' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'coaching', label: 'Coaching' },
];

// Batched per stage transition, never per token (AC-4).
export const STAGE_ANNOUNCEMENTS: Record<BetaStage, string> = {
  screening: 'Screening your answers for warning signs.',
  drafting: 'Screening passed. Drafting your staged progression.',
  coaching: 'Turning the draft into plain language. Your plan is streaming in.',
};

export const CAP_NOTICE_DEFAULT =
  'Beta caps itself at 20 plans a day so a portfolio demo can’t run away with the AI bill. Today’s budget is spent — it resets at midnight UTC. The form below stays open if you want to look around.';

export const HOURLY_THROTTLE_MESSAGE =
  'You’ve hit the hourly attempt limit — Beta allows 3 attempts per hour per visitor. Take a breather and try again in a little while.';

export const NETWORK_ERROR_MESSAGE =
  'Couldn’t reach the planner service. It runs on a small demo server that sometimes naps between visitors — give it a few seconds and try again.';
