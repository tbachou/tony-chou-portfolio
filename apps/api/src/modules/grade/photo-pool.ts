/**
 * The daily cycle, as pure functions over a pool the caller has already read
 * (spec 0006, AC-1 and AC-18).
 *
 * Nothing here touches the database or the filesystem. Until R2 this module
 * also owned a `photos.json` manifest, its loader and its validator; the pool
 * is a `GradePhoto` table now, so the reading lives in GradeService and what
 * is left is the arithmetic, which is the part worth testing directly.
 */

/**
 * The fields the cycle needs from a `GradePhoto` row.
 *
 * Declared structurally rather than imported from the generated Prisma client
 * so these functions stay free of it, and so a test can build a pool from
 * object literals. Real rows satisfy it by shape.
 */
export type GradePhoto = {
  /** The owner-set slug. Also the sort key the cycle runs over. */
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
 * Photos borrowed to test the pipeline get marked with it, and the cycle
 * refuses to serve one once the game is enabled — so a borrowed image cannot
 * go live by being forgotten, which is the failure the required `source`
 * column exists to make impossible.
 */
export const UNLICENSED_TEST: GradePhotoSource = 'unlicensed_test';

/**
 * The pool in the order the daily cycle walks it: lexical by id.
 *
 * Sorting by id rather than by insertion order is what makes the choice
 * identical on every instance, which matters because there is no scheduler
 * telling them what today's photo is. It does NOT make the schedule stable as
 * the pool grows: changing the pool size reshuffles which photo every future
 * date lands on. That is harmless because nobody sees the schedule, and the
 * current day is protected by AC-20 instead (the GradeDay row pins it).
 */
export function sortedPool(photos: GradePhoto[]): GradePhoto[] {
  return [...photos].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Split an active pool into what the cycle may serve and what it may not
 * (AC-18).
 *
 * `gameEnabled` is a parameter rather than an env read so the rule is
 * testable both ways: while the game is hidden an unlicensed test photo is
 * exactly what the pool is expected to contain, and excluding it then would
 * leave nothing to develop against.
 */
export function partitionPool(
  photos: GradePhoto[],
  gameEnabled: boolean,
): { eligible: GradePhoto[]; excluded: GradePhoto[] } {
  if (!gameEnabled) return { eligible: photos, excluded: [] };

  const eligible: GradePhoto[] = [];
  const excluded: GradePhoto[] = [];
  for (const photo of photos) {
    (photo.source === UNLICENSED_TEST ? excluded : eligible).push(photo);
  }
  return { eligible, excluded };
}

/** Whole days elapsed since the Unix epoch, in UTC. */
export function daysSinceEpoch(now: Date): number {
  return Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) /
      86_400_000,
  );
}

/** The UTC calendar date as `YYYY-MM-DD` — the GradeDay primary key. */
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The problem every visitor sees on the given UTC day (AC-1): day index
 * modulo pool size, so the choice is a pure function of the date and needs
 * no scheduler — which matters because Render's free dyno sleeps.
 *
 * This decides only which photo a date gets when it has no GradeDay row yet.
 * Once that row exists it is the authority, and this is not consulted again
 * for that date (AC-20).
 */
export function photoForDate(
  now: Date,
  photos: GradePhoto[],
): GradePhoto | null {
  const pool = sortedPool(photos);
  if (pool.length === 0) return null;
  return pool[daysSinceEpoch(now) % pool.length];
}
