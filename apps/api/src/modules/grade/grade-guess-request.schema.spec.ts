import { gradeGuessRequestSchema } from '@portfolio/shared';

/**
 * The request boundary for POST /grade/guess (spec 0006, AC-8, AC-23).
 *
 * Was grade-guess-request.dto.spec.ts against class-validator decorators.
 */

const VALID_PUBLIC_ID = '9f2c4ab1d0e37b58';

function badFields(payload: unknown): string[] {
  const result = gradeGuessRequestSchema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.') || '(root)');
}

describe('gradeGuessRequestSchema (AC-8)', () => {
  it.each([0, 1, 4, 7, 8])('accepts the valid guess V%i', (guess) => {
    expect(badFields({ guess, publicId: VALID_PUBLIC_ID })).toHaveLength(0);
  });

  it('rejects a guess above the V8 ceiling', () => {
    expect(badFields({ guess: 9, publicId: VALID_PUBLIC_ID })).toContain(
      'guess',
    );
  });

  it('rejects a negative guess', () => {
    expect(badFields({ guess: -1, publicId: VALID_PUBLIC_ID })).toContain(
      'guess',
    );
  });

  it('rejects a grade written as text rather than an integer', () => {
    // Nothing coerces: "V5" arrives as a string and must fail here rather
    // than being converted to a number, exactly as under the old pipe, which
    // did not enable implicit conversion.
    expect(badFields({ guess: 'V5', publicId: VALID_PUBLIC_ID })).toContain(
      'guess',
    );
  });

  it.each([3.5, NaN, Infinity, null, undefined, [], {}])(
    'rejects the non-integer guess %p',
    (guess) => {
      expect(badFields({ guess, publicId: VALID_PUBLIC_ID })).toContain(
        'guess',
      );
    },
  );

  it('rejects a missing guess', () => {
    expect(badFields({ publicId: VALID_PUBLIC_ID })).toContain('guess');
  });

  describe('the problem id (AC-23)', () => {
    it('accepts a fixed-length lowercase hex id', () => {
      expect(badFields({ guess: 4, publicId: VALID_PUBLIC_ID })).toHaveLength(
        0,
      );
    });

    it('is required: a guess has to name the problem it is against', () => {
      // Replaced the UTC date on 2026-08-22. The id is a stronger identity
      // than the date ever was — there is no "which photo is today" left to
      // get wrong, which is why the dropped AC-19 has no successor.
      expect(badFields({ guess: 4 })).toContain('publicId');
    });

    it.each([
      ['a slug, which would encode the grade band', 'north-gym-blue-prow'],
      ['uppercase hex', '9F2C4AB1D0E37B58'],
      ['one character short', '9f2c4ab1d0e37b5'],
      ['one character long', '9f2c4ab1d0e37b58a'],
      ['non-hex characters', '9f2c4ab1d0e37bzz'],
      ['a path traversal', '../../etc/passwd'],
      ['an object key rather than its basename', 'photos/9f2c4ab1d0e37b58.webp'],
      ['a UTC date, the field this replaced', '2026-08-20'],
      ['empty', ''],
      ['a SQL fragment', "9f2c4ab1d0e37b58' OR '1'='1"],
    ])('rejects %s', (_label, publicId) => {
      expect(badFields({ guess: 4, publicId })).toContain('publicId');
    });
  });

  it('accepts exactly two machine-shaped properties, and no free text', () => {
    // The schema is .strict(), so this is the assertion that keeps the
    // feature's input surface closed (AC-6). `publicId` is not visitor prose:
    // it is echoed back from /grade/problems, pattern-constrained here,
    // resolved against the photo table rather than trusted, and never sent to
    // a model. A genuine free-text field added here would show up as a third
    // key in the schema's shape.
    expect(Object.keys(gradeGuessRequestSchema.shape).sort()).toEqual([
      'guess',
      'publicId',
    ]);

    const withExtra = gradeGuessRequestSchema.safeParse({
      guess: 4,
      publicId: VALID_PUBLIC_ID,
      notes: 'free text',
    });
    expect(withExtra.success).toBe(false);
  });
});
