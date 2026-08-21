/**
 * The admin side of Grade Guesser's photo pool (spec 0006 R3).
 *
 * This module is registered unconditionally, unlike the game itself: the pool
 * has to be fillable while the game is still hidden, which is the whole point
 * of the build order.
 */

/**
 * The upload ceiling (AC-17).
 *
 * Load bearing rather than decorative: the api runs on a free Render instance
 * where memory is genuinely scarce, and decoding an image costs far more than
 * the file it came from. Enforced by multer as the stream arrives, so an
 * oversized upload is aborted rather than buffered and then rejected.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The longest edge a stored photo may have (AC-17).
 *
 * 1568 is the size above which Anthropic's vision API scales images down
 * anyway, so anything larger costs upload time and storage to send detail the
 * model will discard.
 */
export const MAX_LONG_EDGE = 1568;

/**
 * Everything is re-encoded to one format, so the stored media type is the
 * pipeline's own output and never a client supplied claim (AC-17).
 *
 * WebP rather than preserving the input format: it keeps `contentType`
 * single valued, it is the smallest of the three the schema permits, and it
 * is accepted by the vision API under both providers. A photo that arrives as
 * a 12 megapixel HEIC-ish JPEG leaves here as a bounded WebP with no metadata.
 */
export const STORED_CONTENT_TYPE = 'image/webp';
export const STORED_EXTENSION = 'webp';

/** Quality for the re-encode. High enough that grade-relevant texture survives. */
export const STORED_QUALITY = 82;

/** Object keys are `photos/` plus 16 random hex characters plus the extension. */
export const OBJECT_KEY_PREFIX = 'photos/';
export const OBJECT_KEY_RANDOM_BYTES = 8;

/**
 * How long a presigned URL stays good (AC-14).
 *
 * Short enough that a copied link stops working the same day, long enough
 * that nobody playing normally sees a broken image.
 */
export const PRESIGN_TTL_SECONDS = 3600;

/**
 * Slug rules (spec 0006, interfaces settled).
 *
 * Lowercase and hyphens only, 3 to 64 characters, never leading with a
 * hyphen. AC-1's deterministic ordering sorts on these, so they have to be
 * lexically comparable across instances.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const GRADE_PHOTO_SOURCES = [
  'own_photo',
  'permission_given',
  'licensed',
  'unlicensed_test',
] as const;

export type GradePhotoSourceValue = (typeof GRADE_PHOTO_SOURCES)[number];
