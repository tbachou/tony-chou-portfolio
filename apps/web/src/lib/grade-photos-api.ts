// Client for the Grade Guesser photo pool admin api (spec 0006 R3). Mirrors
// apps/api/src/modules/grade-photos' response types exactly — same convention
// as api.ts, beta-api.ts and grade-api.ts.
//
// Every call sends the better-auth session cookie, because these endpoints sit
// behind the global auth guard rather than being public like the game's own.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Kept in step with the api's MAX_UPLOAD_BYTES, so the form can say so up front. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const GRADE_PHOTO_SOURCES = [
  'own_photo',
  'permission_given',
  'licensed',
  'unlicensed_test'
] as const;

export type GradePhotoSource = (typeof GRADE_PHOTO_SOURCES)[number];

/** How each provenance value reads in the UI, and what it means for release. */
export const SOURCE_LABELS: Record<GradePhotoSource, string> = {
  own_photo: 'my own photo',
  permission_given: 'permission given',
  licensed: 'licensed',
  unlicensed_test: 'unlicensed test image'
};

export type GradePhoto = {
  id: string;
  trueGrade: number;
  source: GradePhotoSource;
  sourceNote: string | null;
  note: string | null;
  active: boolean;
  /** ISO string: the api's DateTime crosses JSON as text. */
  createdAt: string;
  /** Presigned, and good for one hour. A page left open past that shows a broken image. */
  imageUrl: string;
};

export type NewGradePhoto = {
  file: File;
  id: string;
  trueGrade: number;
  source: GradePhotoSource;
  sourceNote?: string;
  note?: string;
};

/** Thrown by every call below, carrying the api's own status and message. */
export class GradePhotoRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GradePhotoRequestError';
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

/**
 * Turn a failed response into an error worth reading.
 *
 * The status-specific copy exists because the api's own messages are accurate
 * but terse, and these four are the ones an upload actually hits.
 */
async function toError(res: Response): Promise<GradePhotoRequestError> {
  let message: string | null = null;
  try {
    message = extractServerMessage(await res.json());
  } catch {
    // Non-JSON body (a proxy's own 413 page, for instance): fall through.
  }

  const fallback =
    res.status === 401
      ? 'Your session has expired. Sign in again.'
      : res.status === 409
        ? 'A photo with that id already exists. Pick a different id.'
        : res.status === 413
          ? 'That image is larger than the 10 MB limit.'
          : res.status === 415
            ? "That file could not be read as an image."
            : `The request failed (status ${res.status}).`;

  return new GradePhotoRequestError(res.status, message ?? fallback);
}

export async function fetchGradePhotos(): Promise<GradePhoto[]> {
  const res = await fetch(`${API_URL}/internal/grade-photos`, {
    cache: 'no-store',
    credentials: 'include'
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Upload one photo.
 *
 * Multipart, so every field goes over as text and the api's DTO coerces. The
 * object key and the stored content type are deliberately absent: the server
 * produces both, so there is nothing here that could name where the bytes land
 * or claim a media type they are not.
 */
export async function uploadGradePhoto(photo: NewGradePhoto): Promise<GradePhoto> {
  const form = new FormData();
  form.append('file', photo.file);
  form.append('id', photo.id);
  form.append('trueGrade', String(photo.trueGrade));
  form.append('source', photo.source);
  if (photo.sourceNote) form.append('sourceNote', photo.sourceNote);
  if (photo.note) form.append('note', photo.note);

  const res = await fetch(`${API_URL}/internal/grade-photos`, {
    method: 'POST',
    credentials: 'include',
    // No Content-Type header on purpose: the browser has to set it itself so
    // the multipart boundary is included.
    body: form
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/** Deactivate or reactivate one photo. Rows are never deleted. */
export async function setGradePhotoActive(
  id: string,
  active: boolean
): Promise<GradePhoto> {
  const res = await fetch(
    `${API_URL}/internal/grade-photos/${encodeURIComponent(id)}/active`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    }
  );
  if (!res.ok) throw await toError(res);
  return res.json();
}
