import 'reflect-metadata';
import {
  getMetadataStorage,
  validate,
  type ValidationError,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GradeGuessRequestDto } from './grade-guess-request.dto';

/** A valid public id, so guess-focused cases are not tripped by the id field. */
const PUBLIC_ID = '9f2c4ab1d0e37b58';

async function errorsFor(
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(
    plainToInstance(GradeGuessRequestDto, { publicId: PUBLIC_ID, ...payload }),
  );
}

function constraintsOn(errors: ValidationError[], property: string): string[] {
  const error = errors.find((e) => e.property === property);
  return Object.keys(error?.constraints ?? {});
}

describe('GradeGuessRequestDto (AC-8)', () => {
  it.each([0, 1, 4, 7, 8])('accepts the valid guess V%i', async (guess) => {
    expect(await errorsFor({ guess })).toHaveLength(0);
  });

  it('rejects a guess above the V8 ceiling', async () => {
    expect(constraintsOn(await errorsFor({ guess: 9 }), 'guess')).toContain(
      'max',
    );
  });

  it('rejects a negative guess', async () => {
    expect(constraintsOn(await errorsFor({ guess: -1 }), 'guess')).toContain(
      'min',
    );
  });

  it('rejects a grade written as text rather than an integer', async () => {
    // The global pipe does not enable implicit conversion, so "V5" arrives as
    // a string and must fail here rather than being coerced to a number.
    expect(constraintsOn(await errorsFor({ guess: 'V5' }), 'guess')).toContain(
      'isInt',
    );
  });

  it.each([3.5, NaN, Infinity, null, undefined, [], {}])(
    'rejects the non-integer guess %p',
    async (guess) => {
      expect(constraintsOn(await errorsFor({ guess }), 'guess')).toContain(
        'isInt',
      );
    },
  );

  it('rejects a missing guess', async () => {
    expect(constraintsOn(await errorsFor({}), 'guess')).toContain('isInt');
  });

  describe('the problem id (AC-23)', () => {
    it('accepts a fixed-length lowercase hex id', async () => {
      expect(constraintsOn(await errorsFor({ guess: 4 }), 'publicId')).toEqual(
        [],
      );
    });

    it('is required: a guess has to name the problem it is against', async () => {
      // Replaced the UTC date on 2026-08-22. The id is a stronger identity
      // than the date ever was — there is no "which photo is today" left to
      // get wrong, which is why the dropped AC-19 has no successor.
      const errors = await validate(
        plainToInstance(GradeGuessRequestDto, { guess: 4 }),
      );
      expect(constraintsOn(errors, 'publicId')).toContain('matches');
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
    ])('rejects %s', async (_label, publicId) => {
      expect(
        constraintsOn(await errorsFor({ guess: 4, publicId }), 'publicId'),
      ).toContain('matches');
    });
  });

  it('whitelists exactly two machine-shaped properties, and no free text', () => {
    // The whitelist is what forbidNonWhitelisted enforces against, so this is
    // the assertion that keeps the feature's input surface closed (AC-6).
    // `publicId` is not visitor prose: it is echoed back from /grade/problems,
    // pattern-constrained here, resolved against the photo table rather than
    // trusted, and never sent to a model. A genuine free-text field added here
    // would show up as a third name.
    const whitelisted = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(GradeGuessRequestDto, '', false, false)
        .map((meta) => meta.propertyName),
    );

    expect([...whitelisted].sort()).toEqual(['guess', 'publicId']);
  });
});
