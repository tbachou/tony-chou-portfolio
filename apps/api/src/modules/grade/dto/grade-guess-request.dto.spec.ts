import 'reflect-metadata';
import {
  getMetadataStorage,
  validate,
  type ValidationError,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GradeGuessRequestDto } from './grade-guess-request.dto';

async function errorsFor(
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(GradeGuessRequestDto, payload));
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

  it('whitelists exactly one property, so the DTO carries no free text', () => {
    // The whitelist is what forbidNonWhitelisted enforces against, so this is
    // the assertion that keeps the feature's input surface a single integer
    // (AC-6). A free-text field added here would show up as a second name.
    const whitelisted = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(GradeGuessRequestDto, '', false, false)
        .map((meta) => meta.propertyName),
    );

    expect([...whitelisted]).toEqual(['guess']);
  });
});
