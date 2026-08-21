/** The V scale, as far as this game goes. Both bounds are inclusive. */
export const GRADE_MIN = 0;
export const GRADE_MAX = 8;

/** Histogram width: one slot per grade, index = grade (AC-6). */
export const GRADE_SLOTS = GRADE_MAX - GRADE_MIN + 1;

export const GRADE_CONFIDENCES = ['low', 'medium', 'high'] as const;
export type GradeConfidence = (typeof GRADE_CONFIDENCES)[number];

/**
 * The vision model. Pinned rather than read from ANTHROPIC_MODEL because one
 * call per UTC day makes quality the only axis worth optimising (spec 0006
 * rationale) — a cheaper default set for another feature must not silently
 * downgrade the game's single daily read of the wall.
 */
export const GRADER_MODEL = 'claude-sonnet-5';

/** Vision calls are slower than text; the first guesser of the day waits. */
export const GRADER_CALL_TIMEOUT_MS = 60_000;

export const GRADER_MAX_TOKENS = 1200;

/** Bounds on what the model is allowed to hand back, enforced on parse. */
export const MAX_OBSERVATIONS = 6;
export const MAX_OBSERVATION_LENGTH = 240;
export const MAX_REASONING_LENGTH = 1200;

/**
 * Whether the game is released.
 *
 * Read here rather than passed in because the same variable already decides
 * whether GradeModule is registered at all (app.module.ts). It matters inside
 * the module for one reason: the licence gate (AC-18) only applies once the
 * game is live, so that a photo borrowed to test the pipeline is usable while
 * the game is hidden and refused the moment it is not.
 */
export function gradeGameEnabled(): boolean {
  return process.env.GRADE_GAME_ENABLED === 'true';
}

/**
 * The private bucket holding the photo objects (spec 0006 R1).
 *
 * No default: an unset bucket is a deployment mistake, and guessing a name
 * would turn it into a confusing 404 from S3 instead of a clear failure here.
 */
export function resolvePhotoBucket(): string {
  const bucket = process.env.GRADE_PHOTO_BUCKET?.trim();
  if (!bucket) {
    throw new Error('GRADE_PHOTO_BUCKET is not set');
  }
  return bucket;
}

/** The region the bucket lives in. Shares the variable Bedrock already uses. */
export function resolvePhotoRegion(): string {
  const region = process.env.AWS_REGION?.trim();
  if (!region) {
    throw new Error('AWS_REGION is not set');
  }
  return region;
}

/**
 * Where an object lives, as a URL.
 *
 * UNSIGNED, and therefore not yet usable by a browser: the bucket blocks all
 * public access, so this address returns 403 until R4 signs it. That is the
 * intended state between R2 and R4 rather than an oversight — the shape and
 * the location are already right, and R4 adds the signature and the one hour
 * lifetime (AC-14). Nothing reaches this code path in the meantime: the pool
 * is empty until R3 builds the upload, and the module is not registered while
 * GRADE_GAME_ENABLED is false.
 */
export function photoObjectUrl(objectKey: string): string {
  return `https://${resolvePhotoBucket()}.s3.${resolvePhotoRegion()}.amazonaws.com/${objectKey}`;
}
