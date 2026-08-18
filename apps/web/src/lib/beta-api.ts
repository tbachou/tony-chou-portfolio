// Client for the Beta (return-to-climbing rehab planner) API, spec 0004.
// The enum value lists mirror apps/api/src/modules/beta/beta.constants.ts
// exactly — the server validates with IsIn against those arrays, so any
// drift here turns into 400s.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const INJURY_AREAS = [
  'finger_pulley',
  'elbow_tendinopathy',
  'shoulder_impingement',
] as const;
export type InjuryArea = (typeof INJURY_AREAS)[number];

export const SYMPTOMS = [
  // The first four are red flags — the screener hard-blocks on these (AC-2).
  'sudden_pop_with_swelling',
  'numbness_or_tingling',
  'cannot_bear_weight_or_grip',
  'night_pain',
  'pain_with_specific_holds_or_moves',
  'pain_at_session_start_that_warms_up',
  'morning_stiffness',
  'mild_swelling',
  'tenderness_to_touch',
  'weakness_or_early_fatigue',
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

export const RED_FLAG_SYMPTOMS: readonly Symptom[] = [
  'sudden_pop_with_swelling',
  'numbness_or_tingling',
  'cannot_bear_weight_or_grip',
  'night_pain',
];

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

export type BetaStatus = {
  available: boolean;
  reason: 'ok' | 'daily_cap';
};

export type BetaPlanPayload = {
  injuryArea: InjuryArea;
  onsetWeeksAgo: number;
  symptoms: Symptom[];
  painBehavior: PainBehavior;
  preInjuryGrade: string;
  discipline: Discipline;
  goals?: string;
  sessionsPerWeek?: number;
  equipmentAccess?: EquipmentAccess[];
};

export type BetaStage = 'screening' | 'drafting' | 'coaching';

export type BetaSseEvent =
  | { type: 'status'; stage: BetaStage }
  | { type: 'red_flag'; category: string | null; message: string }
  | { type: 'plan_delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Thrown when POST /beta/plan fails before the SSE stream opens. Carries
 * the HTTP status and the server's own message so the UI can show the
 * server's copy verbatim for 429 (per-IP daily limit / hourly throttle)
 * and 503 (demo budget spent), per AC-5.
 */
export class BetaRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BetaRequestError';
    this.status = status;
  }
}

export async function fetchBetaStatus(): Promise<BetaStatus> {
  const res = await fetch(`${API_URL}/beta/status`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch beta status: ${res.status}`);
  return res.json();
}

/** Pulls the human-readable message out of a NestJS error body. */
function extractServerMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.filter((m): m is string => typeof m === 'string').join(' ');
  }
  return null;
}

/**
 * Consumes POST /beta/plan's SSE stream as it arrives (same block parsing
 * as streamNextTurn in api.ts). Yields one event per `event:`/`data:`
 * block; the caller drives its pipeline chips and plan display off each
 * event rather than waiting for a single final response.
 */
export async function* streamBetaPlan(
  payload: BetaPlanPayload,
): AsyncGenerator<BetaSseEvent> {
  const res = await fetch(`${API_URL}/beta/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    let message: string | null = null;
    try {
      message = extractServerMessage(await res.json());
    } catch {
      // Non-JSON error body: fall through to the generic message.
    }
    throw new BetaRequestError(
      res.status,
      message ?? `The planner request failed (status ${res.status}).`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventName = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      if (!data) continue;
      yield { type: eventName, ...JSON.parse(data) } as BetaSseEvent;
    }
  }
}
