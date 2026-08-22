/**
 * Pure functions over a pool the caller has already read (spec 0006, AC-18
 * and AC-23).
 *
 * Nothing here touches the database, S3 or the filesystem. Until R2 this
 * module also owned a `photos.json` manifest, its loader and its validator;
 * the pool is a `GradePhoto` table now, so the reading lives in GradeService.
 *
 * What is left is two things worth testing directly: the licence gate, and
 * the mapping between a photo's storage key and the opaque id the public API
 * addresses it by. R6b removed the third — the daily cycle (`photoForDate`,
 * `daysSinceEpoch`, `utcDateKey`) — along with the cadence that needed it.
 */

import {
  OBJECT_KEY_PREFIX,
  STORED_EXTENSION,
} from '../grade-photos/grade-photos.constants';

/**
 * The fields the game needs from a `GradePhoto` row.
 *
 * Declared structurally rather than imported from the generated Prisma client
 * so these functions stay free of it, and so a test can build a pool from
 * object literals. Real rows satisfy it by shape.
 */
export type GradePhoto = {
  /** The owner-set slug. SERVER SIDE ONLY — never in a public response (AC-23). */
  id: string;
  /** The S3 key holding the bytes. Random, never derived from the slug. */
  objectKey: string;
  /** The media type the stored object was written with. */
  contentType: string;
  /** The owner's gym grade, 0 to 8 on the V scale. */
  trueGrade: number;
  source: GradePhotoSource;
  /** Location or credit line. Reveal content, never a grade hint. */
  note?: string | null;
};

export type GradePhotoSource =
  | 'own_photo'
  | 'permission_given'
  | 'licensed'
  | 'unlicensed_test';

/**
 * The source that may never reach a released game (AC-18).
 *
 * Photos borrowed to test the pipeline get marked with it, and the served set
 * refuses to carry one once the game is enabled — so a borrowed image cannot
 * go live by being forgotten, which is the failure the required `source`
 * column exists to make impossible.
 */
export const UNLICENSED_TEST: GradePhotoSource = 'unlicensed_test';

/**
 * How many hex characters an object key's random basename has.
 *
 * `newObjectKey` writes `OBJECT_KEY_RANDOM_BYTES` bytes as hex, so this is
 * that constant doubled. Kept as its own number rather than imported and
 * doubled at each use, because the DTO pattern needs a literal length and a
 * wrong one here would reject every real id.
 */
export { PUBLIC_ID_LENGTH } from '@portfolio/shared';

/** Exactly the shape `newObjectKey` produces: lowercase hex, fixed length. */
export { PUBLIC_ID_PATTERN } from '@portfolio/shared';

/**
 * The public id for a photo: the random hex basename of its object key
 * (AC-23).
 *
 * Derived rather than stored, and that is the whole point. `newObjectKey`
 * already produces `photos/<random hex>.<ext>` under a unique constraint, so
 * the value is already random, already opaque, already server generated,
 * already unique and already present on every existing row. A `publicId`
 * column would have needed a backfill and a collision policy on a table that
 * is not empty, to buy nothing.
 *
 * It exists because the row's own `id` is the owner's slug, and a slug like
 * `north-gym-blue` names the gym circuit colour, which encodes the grade
 * band. Handing that to the page before the guess would break AC-2.
 *
 * Strips any extension rather than assuming the current one, so a row written
 * before the pipeline settled on a single format still maps correctly.
 */
export function publicIdFor(objectKey: string): string {
  const basename = objectKey.startsWith(OBJECT_KEY_PREFIX)
    ? objectKey.slice(OBJECT_KEY_PREFIX.length)
    : objectKey;
  const dot = basename.lastIndexOf('.');
  return dot === -1 ? basename : basename.slice(0, dot);
}

/**
 * The object key a public id addresses: the inverse of `publicIdFor`.
 *
 * An exact value rather than a prefix match, which is what lets the lookup
 * ride the `GradePhoto_objectKey_key` unique index instead of scanning. It is
 * exact because `processUpload` re-encodes every upload to one format
 * (`STORED_EXTENSION`), so there is only ever one extension in play — the
 * spec left the choice between this and a constructed prefix match open, and
 * a single-valued extension makes the exact form strictly better.
 *
 * If a second stored format is ever added, this is the function that breaks,
 * and it breaks loudly as a 404 rather than quietly as a wrong photo.
 */
export function objectKeyFor(publicId: string): string {
  return `${OBJECT_KEY_PREFIX}${publicId}.${STORED_EXTENSION}`;
}

/**
 * Split an active pool into what the game may serve and what it may not
 * (AC-18).
 *
 * `gameEnabled` is a parameter rather than an env read so the rule is
 * testable both ways: while the game is hidden an unlicensed test photo is
 * exactly what the pool is expected to contain, and excluding it then would
 * leave nothing to develop against.
 *
 * Generic over anything carrying a `source`, so the pre-guess list can pass
 * rows selected without `trueGrade` at all. Not reading the answer on a path
 * that must never return it is a cheaper guarantee than remembering to strip
 * it (AC-2).
 */
export function partitionPool<T extends { source: GradePhotoSource }>(
  photos: T[],
  gameEnabled: boolean,
): { eligible: T[]; excluded: T[] } {
  if (!gameEnabled) return { eligible: photos, excluded: [] };

  const eligible: T[] = [];
  const excluded: T[] = [];
  for (const photo of photos) {
    (photo.source === UNLICENSED_TEST ? excluded : eligible).push(photo);
  }
  return { eligible, excluded };
}
