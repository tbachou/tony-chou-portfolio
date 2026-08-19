// Client for the anonymous feedback intake API, spec 0005 child:
// feedback-intake. Mirrors apps/api/src/modules/feedback/feedback.constants.ts
// exactly — the server validates with IsIn against those arrays, so any
// drift here turns into 400s (same convention as beta-api.ts).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_SOURCES = ['beta', 'portfolio'] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;

export type FeedbackPayload = {
  message: string;
  category?: FeedbackCategory;
  source: FeedbackSource;
};

/**
 * Thrown when POST /feedback fails. Carries the HTTP status and the
 * server's own message so the UI can show the server's copy verbatim for
 * 400 (validation) and 429 (rate limited), per the api contract.
 */
export class FeedbackRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FeedbackRequestError';
    this.status = status;
  }
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

export async function submitFeedback(payload: FeedbackPayload): Promise<{ id: string }> {
  const res = await fetch(`${API_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message: string | null = null;
    try {
      message = extractServerMessage(await res.json());
    } catch {
      // Non-JSON error body: fall through to the generic message.
    }
    throw new FeedbackRequestError(
      res.status,
      message ?? `The feedback request failed (status ${res.status}).`,
    );
  }

  return res.json();
}
