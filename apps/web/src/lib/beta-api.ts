import type {
  BetaPlanRequest as BetaPlanPayload,
  Symptom,
} from '@portfolio/shared';

// The request enums and the plan payload are the contract, and it is owned
// by @portfolio/shared — the same schema the api validates with. Re-exported
// so this module stays the one import site for anything Beta-shaped.
export {
  DISCIPLINES,
  RED_FLAG_SYMPTOMS,
  EQUIPMENT_ACCESS,
  INJURY_AREAS,
  PAIN_BEHAVIORS,
  SYMPTOMS,
  type BetaPlanRequest as BetaPlanPayload,
  type Discipline,
  type EquipmentAccess,
  type InjuryArea,
  type PainBehavior,
  type Symptom,
} from '@portfolio/shared';

// Client for the Beta (return-to-climbing rehab planner) API, spec 0004.
// The enum value lists mirror apps/api/src/modules/beta/beta.constants.ts
// exactly — the server validates with IsIn against those arrays, so any
// drift here turns into 400s.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';








export type BetaStatus = {
  available: boolean;
  reason: 'ok' | 'daily_cap';
};


export type BetaStage = 'screening' | 'drafting' | 'coaching';

export type BetaSseEvent =
  | { type: 'status'; stage: BetaStage }
  | { type: 'red_flag'; category: string | null; message: string }
  | { type: 'plan_delta'; text: string }
  // Clears the plan area so the deltas that follow replace what is shown.
  // Sent once, when the guard has passed the coach's prose and it upgrades
  // the deterministic rendering the api emitted as soon as the plan was
  // validated. Both renderings are the same plan: the guard's numeric and
  // structural rules have already proven the coach changed no number, dose,
  // stage, or ordering, so this swaps wording, never facts.
  | { type: 'plan_replace' }
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
