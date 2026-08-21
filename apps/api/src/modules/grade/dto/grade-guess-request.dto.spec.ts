import 'reflect-metadata';
import {
  getMetadataStorage,
  validate,
  type ValidationError,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GradeGuessRequestDto } from './grade-guess-request.dto';

/** A valid shown date, so guess-focused cases are not tripped by AC-19's field. */
const TODAY = '2026-08-20';

async function errorsFor(
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(
    plainToInstance(GradeGuessRequestDto, { date: TODAY, ...payload }),
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

  describe('the shown date (AC-19)', () => {
    it('accepts a UTC calendar date', async () => {
      expect(constraintsOn(await errorsFor({ guess: 4 }), 'date')).toEqual([]);
    });

    it('is required, since an absent date would mean "assume today"', async () => {
      // That fallback is precisely the silent regrade AC-19 exists to stop.
      const errors = await validate(
        plainToInstance(GradeGuessRequestDto, { guess: 4 }),
      );
      expect(constraintsOn(errors, 'date')).toContain('matches');
    });

    it.each([
      ['a timestamp', '2026-08-20T12:00:00.000Z'],
      ['a slashed date', '2026/08/20'],
      ['a two-digit year', '26-08-20'],
      ['prose', 'today'],
      ['empty', ''],
      ['a SQL fragment', "2026-08-20' OR '1'='1"],
    ])('rejects %s', async (_label, date) => {
      expect(constraintsOn(await errorsFor({ guess: 4, date }), 'date')).toContain(
        'matches',
      );
    });
  });

  it('whitelists exactly two machine-shaped properties, and no free text', () => {
    // The whitelist is what forbidNonWhitelisted enforces against, so this is
    // the assertion that keeps the feature's input surface closed (AC-6).
    // `date` joined it in R4 and is not visitor prose: it is echoed back from
    // /grade/today, pattern-constrained, compared against the server clock,
    // never stored and never sent to a model. A genuine free-text field added
    // here would show up as a third name.
    const whitelisted = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(GradeGuessRequestDto, '', false, false)
        .map((meta) => meta.propertyName),
    );

    expect([...whitelisted].sort()).toEqual(['date', 'guess']);
  });
});
