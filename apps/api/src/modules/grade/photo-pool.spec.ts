import {
  daysSinceEpoch,
  partitionPool,
  photoForDate,
  sortedPool,
  utcDateKey,
  type GradePhoto,
  type GradePhotoSource,
} from './photo-pool';

function photo(
  id: string,
  overrides: Partial<GradePhoto> = {},
): GradePhoto {
  return {
    id,
    objectKey: `photos/${id}`,
    contentType: 'image/webp',
    trueGrade: 4,
    source: 'own_photo',
    ...overrides,
  };
}

describe('the daily cycle (AC-1)', () => {
  const pool: GradePhoto[] = [
    photo('c', { trueGrade: 2 }),
    photo('a', { trueGrade: 5 }),
    photo('b', { trueGrade: 7 }),
  ];

  it('walks the pool in lexical id order, not insertion order', () => {
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

  it('picks the same photo on every instance for a given date and pool', () => {
    // The property the lexical sort exists for: two api instances holding the
    // same rows in different orders must still agree on the day's problem,
    // because nothing tells them what it is.
    const shuffled = [pool[2], pool[0], pool[1]];
    const day = new Date('2026-08-20T09:00:00.000Z');

    expect(photoForDate(day, shuffled)?.id).toBe(photoForDate(day, pool)?.id);
  });
});

describe('the licence gate (AC-18)', () => {
  const borrowed = photo('borrowed', { source: 'unlicensed_test' });
  const mine = photo('mine', { source: 'own_photo' });
  const permitted = photo('permitted', { source: 'permission_given' });

  it('excludes an unlicensed test photo once the game is enabled', () => {
    const { eligible, excluded } = partitionPool(
      [mine, borrowed, permitted],
      true,
    );

    expect(eligible.map((p) => p.id)).toEqual(['mine', 'permitted']);
    expect(excluded.map((p) => p.id)).toEqual(['borrowed']);
  });

  it('keeps an unlicensed test photo usable while the game is hidden', () => {
    // Not an oversight: a borrowed image is exactly what the pool holds while
    // the pipeline is being built, and excluding it then would leave nothing
    // to develop against. The gate is about release, not about testing.
    const { eligible, excluded } = partitionPool([mine, borrowed], false);

    expect(eligible.map((p) => p.id)).toEqual(['mine', 'borrowed']);
    expect(excluded).toEqual([]);
  });

  it.each<GradePhotoSource>(['own_photo', 'permission_given', 'licensed'])(
    'lets a %s photo through when the game is enabled',
    (source) => {
      const { eligible, excluded } = partitionPool([photo('p', { source })], true);

      expect(eligible).toHaveLength(1);
      expect(excluded).toEqual([]);
    },
  );

  it('can exclude the entire pool, which the cycle then reports as empty', () => {
    // The failure this gate is meant to force: a release whose whole pool is
    // borrowed serves 503 rather than serving a borrowed photo.
    const { eligible, excluded } = partitionPool([borrowed], true);

    expect(eligible).toEqual([]);
    expect(excluded).toHaveLength(1);
    expect(photoForDate(new Date(), eligible)).toBeNull();
  });

  it('never lets an unlicensed test photo win the cycle when enabled', () => {
    // Swept across a full cycle rather than one date, so the assertion does
    // not depend on which day the test happens to run on.
    const { eligible } = partitionPool([mine, borrowed, permitted], true);
    const start = Date.UTC(2026, 7, 20);

    const chosen = Array.from({ length: 10 }, (_, i) =>
      photoForDate(new Date(start + i * 86_400_000), eligible)?.source,
    );

    expect(chosen).not.toContain('unlicensed_test');
  });
});
