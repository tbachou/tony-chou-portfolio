import { readFileSync } from 'fs';
import { join } from 'path';
import { GRADE_MAX, GRADE_MIN } from './grade.constants';

/**
 * One curated boulder problem in the Grade Guesser pool (spec 0006).
 *
 * The manifest is an api-side repo file rather than a table or a web asset
 * precisely because it carries `trueGrade`: keeping it here means the day's
 * answer is never in the client bundle and is only obtainable by submitting
 * a guess (AC-2).
 */
export type GradePhoto = {
  /** Unique, stable. Also the sort key the daily cycle runs over. */
  id: string;
  /** Filename under apps/web/public/grade/. */
  file: string;
  /** The owner's gym grade, 0 to 8 on the V scale. */
  trueGrade: number;
  /** Location or credit line. Reveal content, never a grade hint. */
  note?: string;
};

// Same resolution strategy as Beta's skill loader: process.cwd() is apps/api
// in dev and on Render, with a repo-root fallback for running the compiled
// server by hand from the monorepo root.
//
// The manifest is read at runtime rather than `import`ed so this module can
// keep the basename `photo-pool`: Jest's moduleFileExtensions resolve `json`
// ahead of `ts`, so a `photos.ts` beside `photos.json` would have every
// `./photos` import silently land on the data file.
const MANIFEST_CANDIDATES = [
  join(process.cwd(), 'src', 'modules', 'grade', 'photos.json'),
  join(process.cwd(), 'apps', 'api', 'src', 'modules', 'grade', 'photos.json'),
];

let cached: GradePhoto[] | null = null;

export function loadPhotoManifest(): GradePhoto[] {
  if (cached) return cached;

  for (const path of MANIFEST_CANDIDATES) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      cached = parsed as GradePhoto[];
      return cached;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Grade photo manifest not found in: ${MANIFEST_CANDIDATES.join(', ')}`,
  );
}

/**
 * The pool in the order the daily cycle walks it: lexical by id.
 *
 * Sorting by id rather than by array position is what keeps the cycle stable
 * as the pool grows — appending a photo to the JSON file does not reshuffle
 * which problem every future day lands on the way a positional index would
 * (spec 0006, value sourcing).
 */
export function sortedPool(photos: GradePhoto[] = loadPhotoManifest()) {
  return [...photos].sort((a, b) => a.id.localeCompare(b.id));
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
 */
export function photoForDate(
  now: Date,
  photos: GradePhoto[] = loadPhotoManifest(),
): GradePhoto | null {
  const pool = sortedPool(photos);
  if (pool.length === 0) return null;
  return pool[daysSinceEpoch(now) % pool.length];
}

export type ManifestProblem = string;

/**
 * The AC-9 manifest contract, as a pure function so both the repo check and
 * its own negative test can drive it without touching disk.
 *
 * `fileExists` is injected rather than called directly here for the same
 * reason: the "entry points at a missing file" scenario the spec asks for is
 * then a plain unit test rather than a fixture directory.
 */
export function validatePhotoManifest(
  photos: unknown,
  fileExists: (file: string) => boolean,
): ManifestProblem[] {
  const problems: ManifestProblem[] = [];

  if (!Array.isArray(photos)) {
    return ['manifest must be a JSON array'];
  }
  if (photos.length === 0) {
    problems.push('manifest is empty; the game has no pool to draw from');
  }

  const seen = new Set<string>();
  photos.forEach((entry, index) => {
    const where = `entry ${index}`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${where}: must be an object`);
      return;
    }
    const { id, file, trueGrade, note } = entry as Record<string, unknown>;

    if (typeof id !== 'string' || id.trim() === '') {
      problems.push(`${where}: id must be a non-empty string`);
    } else if (seen.has(id)) {
      problems.push(`${where}: duplicate id "${id}"`);
    } else {
      seen.add(id);
    }

    if (typeof file !== 'string' || file.trim() === '') {
      problems.push(`${where}: file must be a non-empty string`);
    } else if (!fileExists(file)) {
      problems.push(
        `${where} ("${String(id)}"): image file "${file}" is missing from apps/web/public/grade/`,
      );
    }

    if (
      typeof trueGrade !== 'number' ||
      !Number.isInteger(trueGrade) ||
      trueGrade < GRADE_MIN ||
      trueGrade > GRADE_MAX
    ) {
      problems.push(
        `${where} ("${String(id)}"): trueGrade must be an integer ${GRADE_MIN} to ${GRADE_MAX}, got ${String(trueGrade)}`,
      );
    }

    if (note !== undefined && typeof note !== 'string') {
      problems.push(`${where} ("${String(id)}"): note must be a string`);
    }
  });

  return problems;
}
