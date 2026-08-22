// Client for the Grade Guesser api (spec 0006). Mirrors
// apps/api/src/modules/grade's response types exactly — same convention as
// beta-api.ts and feedback-api.ts.
//
// Rewritten for R7 when the daily cadence was dropped. The game serves a fixed
// SET of problems now: one call lists their opaque ids, a second presigns one
// problem's image at the moment it is shown (AC-25), and a guess names its
// problem by that id rather than by a date.

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
 * One problem in the set, as the pre-guess list names it.
 *
 * A public id and nothing else. Not the photo's slug — that would carry the
 * gym circuit colour, which encodes the grade band (AC-23) — and not an image
 * URL, which is minted per problem below.
 */
export type GradeProblemSummary = {
  publicId: string;
};

export type GradeProblemList = {
  problems: GradeProblemSummary[];
  count: number;
};

export type GradeProblemImage = {
  /** Presigned and good for one hour, minted when the problem is shown. */
  imageUrl: string;
};

export type GradeConfidence = 'low' | 'medium' | 'high';

export type GradeModelAnalysis = {
  grade: number;
  confidence: GradeConfidence;
  observations: string[];
  reasoning: string;
};

export type GradeReveal = {
  publicId: string;
  trueGrade: number;
  /** Null when this problem's vision call has not landed; the reveal still works. */
  model: GradeModelAnalysis | null;
  guessCounts: number[];
  plays: number;
  yourGuess: number;
  yourDistance: number;
  modelDistance: number | null;
  note?: string;
};

/** Thrown by every call below, carrying the api's own status and message. */
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

/**
 * The whole playable set, in a stable order.
 *
 * An empty array is a normal answer, not a failure: it means the owner has not
 * uploaded any problems yet, and the page says so in words rather than showing
 * an error (AC-22).
 */
export async function fetchProblems(): Promise<GradeProblemList> {
  const res = await fetch(`${API_URL}/grade/problems`, { cache: 'no-store' });
  if (!res.ok) {
    throw await toError(res, "Couldn't load the problem set. Please try again.");
  }
  return res.json();
}

/**
 * One problem's image, presigned on demand (AC-25).
 *
 * Fetched when the problem goes on screen rather than with the list, so a
 * visitor who reads two problems mints two URLs rather than ten, and so a one
 * hour presign cannot expire under someone sitting on the page.
 */
export async function fetchProblemImage(publicId: string): Promise<GradeProblemImage> {
  const res = await fetch(`${API_URL}/grade/problems/${publicId}/image`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    throw await toError(res, "Couldn't load this problem's photo.");
  }
  return res.json();
}

/**
 * Submit a guess and get the reveal.
 *
 * The body is one integer and one opaque id — no free-text field anywhere, and
 * nothing identifying the visitor is ever sent (AC-6). The id is echoed
 * straight back from fetchProblems, so the guess names its own problem and
 * there is no "which photo is this" question for the server to get wrong.
 */
export async function submitGuess(guess: number, publicId: string): Promise<GradeReveal> {
  const res = await fetch(`${API_URL}/grade/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess, publicId })
  });

  if (!res.ok) {
    throw await toError(res, `The guess could not be submitted (status ${res.status}).`);
  }
  return res.json();
}
