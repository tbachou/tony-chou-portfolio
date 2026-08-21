import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  daysSinceEpoch,
  photoForDate,
  sortedPool,
  utcDateKey,
  validatePhotoManifest,
  type GradePhoto,
} from './photo-pool';

// The real image directory lives in the other workspace: the api owns the
// grades, apps/web serves the pixels. This test is the only thing that spans
// both, and it is exactly what AC-9 asks for.
const IMAGE_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'web',
  'public',
  'grade',
);
const MANIFEST_PATH = join(__dirname, 'photos.json');

const realManifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const realFileExists = (file: string) => existsSync(join(IMAGE_DIR, file));

function entry(overrides: Partial<GradePhoto> = {}): GradePhoto {
  return { id: 'a', file: 'a.png', trueGrade: 4, ...overrides };
}

// Every file named by the fixtures below "exists" unless a case says otherwise.
const allPresent = () => true;

describe('grade photo manifest (AC-9)', () => {
  describe('the checked-in manifest', () => {
    // The pool is deliberately EMPTY while the game is unreleased.
    //
    // The two seed placeholders were removed from apps/web/public/grade/ on
    // 2026-08-21. GRADE_GAME_ENABLED gates the route and the api module, but
    // it does not gate static assets: everything under the web app's public
    // directory is served at the site root on every deploy. A placeholder no
    // visitor can reach through the game is still a file the whole internet
    // can fetch, and the same would be true of any borrowed photo dropped in
    // for local testing.
    //
    // Real photos land here when the pool is sourced (spec 0006 follow-up).
    it('names no image the repo does not contain', () => {
      // The consistency guarantee AC-9 exists for. An empty manifest against
      // an empty directory satisfies it; a dangling filename never does.
      const problems = validatePhotoManifest(realManifest, realFileExists);
      expect(problems.filter((p) => p.includes('missing'))).toEqual([]);
    });

    it('is empty, and reports that as its own problem', () => {
      // Reported separately from the file check so that shipping a release
      // with no pool cannot pass silently once the route is turned on.
      expect(realManifest).toEqual([]);
      expect(validatePhotoManifest(realManifest, realFileExists)).toContain(
        'manifest is empty; the game has no pool to draw from',
      );
    });
  });

  describe('validatePhotoManifest', () => {
    it('rejects an entry pointing at a missing image file', () => {
      const problems = validatePhotoManifest(
        [entry({ id: 'ghost', file: 'not-shot-yet.png' })],
        () => false,
      );

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('not-shot-yet.png');
      expect(problems[0]).toContain('missing');
    });

    it('rejects duplicate ids', () => {
      const problems = validatePhotoManifest(
        [entry({ id: 'twin' }), entry({ id: 'twin', file: 'b.png' })],
        allPresent,
      );

      expect(problems).toEqual([expect.stringContaining('duplicate id "twin"')]);
    });

    it.each([-1, 9, 3.5, 'V5', null, undefined])(
      'rejects trueGrade %p as out of the 0-8 integer range',
      (trueGrade) => {
        const problems = validatePhotoManifest(
          [entry({ trueGrade: trueGrade as number })],
          allPresent,
        );

        expect(problems).toEqual([expect.stringContaining('trueGrade')]);
      },
    );

    it.each([0, 8])('accepts the boundary grade V%i', (trueGrade) => {
      expect(validatePhotoManifest([entry({ trueGrade })], allPresent)).toEqual(
        [],
      );
    });

    it('rejects a missing or blank id', () => {
      expect(
        validatePhotoManifest([entry({ id: '  ' })], allPresent),
      ).toEqual([expect.stringContaining('id must be a non-empty string')]);
    });

    it('rejects a non-string note', () => {
      const problems = validatePhotoManifest(
        [entry({ note: 42 as unknown as string })],
        allPresent,
      );

      expect(problems).toEqual([expect.stringContaining('note must be')]);
    });

    it('rejects a manifest that is not an array, and an empty one', () => {
      expect(validatePhotoManifest({ id: 'a' }, allPresent)).toEqual([
        'manifest must be a JSON array',
      ]);
      expect(validatePhotoManifest([], allPresent)).toEqual([
        expect.stringContaining('empty'),
      ]);
    });

    it('reports every problem at once rather than stopping at the first', () => {
      const problems = validatePhotoManifest(
        [entry({ id: 'x', trueGrade: 99, file: 'gone.png' })],
        () => false,
      );

      expect(problems).toHaveLength(2);
    });
  });
});

describe('the daily cycle (AC-1)', () => {
  const pool: GradePhoto[] = [
    { id: 'c', file: 'c.png', trueGrade: 2 },
    { id: 'a', file: 'a.png', trueGrade: 5 },
    { id: 'b', file: 'b.png', trueGrade: 7 },
  ];

  it('walks the pool in lexical id order, not manifest order', () => {
    expect(sortedPool(pool).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives every visitor on the same UTC day the same photo', () => {
    const earlyUtc = new Date('2026-08-20T00:00:01.000Z');
    const lateUtc = new Date('2026-08-20T23:59:59.000Z');

    expect(photoForDate(earlyUtc, pool)).toEqual(photoForDate(lateUtc, pool));
    expect(utcDateKey(earlyUtc)).toBe(utcDateKey(lateUtc));
  });

  it('changes the photo at midnight UTC', () => {
    const lastMoment = new Date('2026-08-20T23:59:59.999Z');
    const firstMoment = new Date('2026-08-21T00:00:00.000Z');

    expect(photoForDate(lastMoment, pool)?.id).not.toBe(
      photoForDate(firstMoment, pool)?.id,
    );
    expect(daysSinceEpoch(firstMoment)).toBe(daysSinceEpoch(lastMoment) + 1);
  });

  it('cycles through the whole pool and repeats every poolSize days', () => {
    const start = Date.UTC(2026, 7, 20);
    const ids = Array.from({ length: 6 }, (_, i) =>
      photoForDate(new Date(start + i * 86_400_000), pool)?.id,
    );

    expect(new Set(ids.slice(0, 3)).size).toBe(3);
    expect(ids.slice(3)).toEqual(ids.slice(0, 3));
  });

  it('returns null for an empty pool rather than throwing', () => {
    expect(photoForDate(new Date(), [])).toBeNull();
  });

  it('returns null from the checked-in manifest while the pool is empty', () => {
    // Not a regression, and deliberately kept rather than deleted: the pool
    // was emptied when the seed placeholders were removed (see the AC-9 block
    // above). GradeService turns this null into the 503 the spec specifies
    // for "no photos in manifest", and the module is not registered at all
    // while GRADE_GAME_ENABLED is off. Flip this back to `not.toBeNull()`
    // when real photos land — a failure here then means the wiring broke.
    expect(photoForDate(new Date())).toBeNull();
  });
});
