import type {
  FeedbackCategoryValue as FeedbackCategory,
  FeedbackSourceValue as FeedbackSource,
} from '@portfolio/shared';
import { readServerMessage } from './http-error';

// Owned by @portfolio/shared, alongside the schema the api validates with.
export {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_SOURCES,
  type FeedbackCategoryValue as FeedbackCategory,
  type FeedbackSourceValue as FeedbackSource,
} from '@portfolio/shared';

// Client for the anonymous feedback intake API, spec 0005 child:
// feedback-intake. Mirrors apps/api/src/modules/feedback/feedback.constants.ts
// exactly — the server validates with IsIn against those arrays, so any
// drift here turns into 400s (same convention as beta-api.ts).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';



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

export async function submitFeedback(payload: FeedbackPayload): Promise<{ id: string }> {
  const res = await fetch(`${API_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const message = await readServerMessage(res);
    throw new FeedbackRequestError(
      res.status,
      message ?? `The feedback request failed (status ${res.status}).`,
    );
  }

  return res.json();
}
