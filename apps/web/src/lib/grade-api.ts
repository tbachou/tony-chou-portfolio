// Client for the Grade Guesser daily game api (spec 0006). Mirrors
// apps/api/src/modules/grade's response types exactly — same convention as
// beta-api.ts and feedback-api.ts.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const GRADE_MIN = 0;
export const GRADE_MAX = 8;

/** Every guessable grade, V0 through V8, in display order. */
export const GRADES: number[] = Array.from(
  { length: GRADE_MAX - GRADE_MIN + 1 },
  (_, i) => GRADE_MIN + i
);

export function formatGrade(grade: number): string {
  return `V${grade}`;
}

/**
 * The pre-guess payload. Deliberately carries no grade — the api will not
 * send one until a guess is submitted (AC-2), so there is nothing here for a
 * curious visitor to read out of the network tab or the page source.
 */
export type GradeToday = {
  date: string;
  imageUrl: string;
  note?: string;
  poolSize: number;
};

export type GradeConfidence = 'low' | 'medium' | 'high';

export type GradeModelAnalysis = {
  grade: number;
  confidence: GradeConfidence;
  observations: string[];
  reasoning: string;
};

export type GradeReveal = {
  date: string;
  trueGrade: number;
  /** Null when the day's vision call has not landed; the reveal still works. */
  model: GradeModelAnalysis | null;
  guessCounts: number[];
  plays: number;
  yourGuess: number;
  yourDistance: number;
  modelDistance: number | null;
  note?: string;
};

/** Thrown by both calls below, carrying the api's own status and message. */
export class GradeRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GradeRequestError';
    this.status = status;
  }
}

function extractServerMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.filter((m): m is string => typeof m === 'string').join(' ');
  }
  return null;
}

async function toError(res: Response, fallback: string): Promise<GradeRequestError> {
  let message: string | null = null;
  try {
    message = extractServerMessage(await res.json());
  } catch {
    // Non-JSON error body: fall through to the generic message.
  }
  return new GradeRequestError(res.status, message ?? fallback);
}

export async function fetchToday(): Promise<GradeToday> {
  const res = await fetch(`${API_URL}/grade/today`, { cache: 'no-store' });
  if (!res.ok) {
    throw await toError(res, "Couldn't load today's problem. Please try again.");
  }
  return res.json();
}

/**
 * Submit a guess and get the reveal. The request body is a single integer —
 * the feature has no free-text field anywhere, and nothing identifying the
 * visitor is ever sent (AC-6, AC-7).
 */
export async function submitGuess(guess: number): Promise<GradeReveal> {
  const res = await fetch(`${API_URL}/grade/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess })
  });

  if (!res.ok) {
    throw await toError(res, `The guess could not be submitted (status ${res.status}).`);
  }
  return res.json();
}
