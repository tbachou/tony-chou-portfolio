import { createGradePhotoSchema, setPhotoActiveSchema } from '@portfolio/shared';

/**
 * The request boundary for the photo pool admin (spec 0006, AC-17).
 *
 * Was create-grade-photo.dto.spec.ts against class-validator decorators.
 */

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'north-gym-blue-prow',
    trueGrade: 4,
    source: 'own_photo',
    ...overrides,
  };
}

function badFields(payload: unknown): string[] {
  const result = createGradePhotoSchema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.') || '(root)');
}

describe('createGradePhotoSchema (AC-17)', () => {
  it('accepts a well formed upload', () => {
    expect(badFields(valid())).toHaveLength(0);
  });

  describe('the slug', () => {
    // AC-1's deterministic ordering sorts on these, so they have to be
    // lexically comparable rather than free-form.
    it.each(['abc', 'north-gym-blue-prow', 'v8-project-2026', 'a'.repeat(64)])(
      'accepts %s',
      (id) => {
        expect(badFields(valid({ id }))).toHaveLength(0);
      },
    );

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(65)],
      ['uppercase', 'North-Gym'],
      ['leading hyphen', '-leading'],
      ['underscores', 'north_gym'],
      ['spaces', 'north gym'],
      ['a slash that would reshape the object key', 'north/../gym'],
      ['empty', ''],
    ])('rejects %s', (_label, id) => {
      expect(badFields(valid({ id }))).toContain('id');
    });
  });

  describe('the grade', () => {
    it.each(['0', '4', '8'])('accepts V%s from a multipart field', (trueGrade) => {
      // Multipart sends everything as a string, so the schema coerces this
      // one field where the JSON body parser would otherwise have handed
      // over a number.
      expect(badFields(valid({ trueGrade }))).toHaveLength(0);
    });

    it('rejects a grade above the V8 ceiling', () => {
      expect(badFields(valid({ trueGrade: '9' }))).toContain('trueGrade');
    });

    it('rejects a negative grade', () => {
      expect(badFields(valid({ trueGrade: '-1' }))).toContain('trueGrade');
    });

    it('rejects a fractional grade', () => {
      expect(badFields(valid({ trueGrade: '4.5' }))).toContain('trueGrade');
    });

    it('rejects a grade written as text', () => {
      expect(badFields(valid({ trueGrade: 'V4' }))).toContain('trueGrade');
    });
  });

  describe('the source', () => {
    it.each(['own_photo', 'permission_given', 'licensed', 'unlicensed_test'])(
      'accepts %s',
      (source) => {
        expect(badFields(valid({ source }))).toHaveLength(0);
      },
    );

    it('is required, so provenance can never be omitted', () => {
      // The whole point of the column: copyright provenance is data rather
      // than something remembered, so an upload cannot skip it (AC-18).
      const payload = valid();
      delete payload.source;
      expect(badFields(payload)).toContain('source');
    });

    it('rejects a source outside the enum', () => {
      expect(badFields(valid({ source: 'found_online' }))).toContain('source');
    });
  });

  describe('the notes', () => {
    it('accepts an upload with neither note', () => {
      expect(badFields(valid())).toHaveLength(0);
    });

    it('accepts both notes', () => {
      expect(
        badFields(valid({ sourceNote: 'shot on my phone', note: 'North wall' })),
      ).toHaveLength(0);
    });

    it('caps note length', () => {
      expect(badFields(valid({ note: 'x'.repeat(201) }))).toContain('note');
    });

    it('caps sourceNote length', () => {
      expect(badFields(valid({ sourceNote: 'x'.repeat(501) }))).toContain(
        'sourceNote',
      );
    });
  });

  it('has no field for the object key or the content type', () => {
    // Both are produced by the server: a random key, and the image pipeline's
    // own output. There is deliberately no field through which a client could
    // name where its bytes land or claim a media type the bytes are not — and
    // because the schema is .strict(), sending one is a 400 rather than a
    // silently ignored property.
    const shape = Object.keys(createGradePhotoSchema.shape);

    expect(shape).not.toContain('objectKey');
    expect(shape).not.toContain('contentType');
    expect(badFields(valid({ objectKey: 'photos/mine.webp' }))).toContain(
      '(root)',
    );
  });
});

describe('setPhotoActiveSchema', () => {
  function activeIsValid(payload: Record<string, unknown>): boolean {
    return setPhotoActiveSchema.safeParse(payload).success;
  }

  it.each([true, false])('accepts the boolean %p', (active) => {
    expect(activeIsValid({ active })).toBe(true);
  });

  it.each(['true', 'false'])('accepts the form string %p', (active) => {
    expect(activeIsValid({ active })).toBe(true);
  });

  it('rejects anything that is not a boolean', () => {
    expect(activeIsValid({ active: 'yes' })).toBe(false);
    expect(activeIsValid({})).toBe(false);
  });
});
