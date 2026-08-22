import {
  objectKeyFor,
  partitionPool,
  publicIdFor,
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_PATTERN,
  type GradePhoto,
  type GradePhotoSource,
} from './photo-pool';
import { newObjectKey } from '../grade-photos/photo-storage.service';

function photo(id: string, overrides: Partial<GradePhoto> = {}): GradePhoto {
  return {
    id,
    objectKey: `photos/${id}.webp`,
    contentType: 'image/webp',
    trueGrade: 4,
    source: 'own_photo',
    ...overrides,
  };
}

describe('the public problem id (AC-23)', () => {
  it('is the random hex basename of the object key', () => {
    expect(publicIdFor('photos/9f2c1ab4d70e5638.webp')).toBe(
      '9f2c1ab4d70e5638',
    );
  });

  it('round-trips against a real key from the upload pipeline', () => {
    // The property the whole "no new column" decision rests on: the value is
    // already unique, already opaque and already on every row, so deriving it
    // has to be exactly reversible or a guess resolves to the wrong photo.
    const key = newObjectKey('webp');

    expect(objectKeyFor(publicIdFor(key))).toBe(key);
  });

  it('produces an id matching the shape both DTOs validate', () => {
    const id = publicIdFor(newObjectKey('webp'));

    expect(id).toMatch(PUBLIC_ID_PATTERN);
    expect(id).toHaveLength(PUBLIC_ID_LENGTH);
  });

  it('never carries the slug, which encodes the grade band', () => {
    // The reason this indirection exists at all. A slug names the gym circuit
    // colour, and a circuit colour names a grade band, so a page holding the
    // slug before the guess would break AC-2 without any grade field present.
    const row = photo('north-gym-blue-prow', {
      objectKey: 'photos/a1b2c3d4e5f60789.webp',
    });

    expect(publicIdFor(row.objectKey)).toBe('a1b2c3d4e5f60789');
    expect(publicIdFor(row.objectKey)).not.toContain('blue');
  });

  it('strips any extension rather than assuming the current one', () => {
    // Guards a row written before the pipeline settled on a single format.
    expect(publicIdFor('photos/a1b2c3d4e5f60789.png')).toBe(
      'a1b2c3d4e5f60789',
    );
  });

  it('tolerates a key stored without the prefix', () => {
    expect(publicIdFor('a1b2c3d4e5f60789.webp')).toBe('a1b2c3d4e5f60789');
  });

  it('rejects anything that is not fixed-length lowercase hex', () => {
    // The pattern is what stops a crafted id reaching a lookup or a presign.
    for (const bad of [
      'north-gym-blue',
      'A1B2C3D4E5F60789',
      'a1b2c3d4e5f6078',
      'a1b2c3d4e5f607890',
      '../../etc/passwd',
      '',
    ]) {
      expect(bad).not.toMatch(PUBLIC_ID_PATTERN);
    }
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

  it('can exclude the entire set, which is then served as empty', () => {
    // The failure this gate is meant to force: a release whose whole pool is
    // borrowed serves an empty set rather than serving a borrowed photo.
    const { eligible, excluded } = partitionPool([borrowed], true);

    expect(eligible).toEqual([]);
    expect(excluded).toHaveLength(1);
  });

  it('preserves the order it was given, which is the served order', () => {
    // The caller orders by createdAt ascending so additions append rather than
    // reshuffle (AC-22); the gate must not disturb that.
    const { eligible } = partitionPool([mine, borrowed, permitted], true);

    expect(eligible.map((p) => p.id)).toEqual(['mine', 'permitted']);
  });

  it('keeps working on rows selected without the answer columns', () => {
    // The list path selects objectKey and source only, so trueGrade is never
    // read on a pre-guess path (AC-2). The gate has to accept that shape.
    const lean = [
      { objectKey: 'photos/aaaaaaaaaaaaaaaa.webp', source: 'own_photo' as const },
      {
        objectKey: 'photos/bbbbbbbbbbbbbbbb.webp',
        source: 'unlicensed_test' as const,
      },
    ];

    const { eligible, excluded } = partitionPool(lean, true);

    expect(eligible).toHaveLength(1);
    expect(excluded).toHaveLength(1);
  });
});
