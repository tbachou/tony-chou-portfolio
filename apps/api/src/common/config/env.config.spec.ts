import {
  NUMERIC_ENV_DEFAULTS,
  readNumericEnv,
  validateEnv,
  type NumericEnvName,
} from './env.config';

const NAMES = Object.keys(NUMERIC_ENV_DEFAULTS) as NumericEnvName[];

describe('readNumericEnv', () => {
  it('falls back to the default when the variable is unset', () => {
    for (const name of NAMES) {
      expect(readNumericEnv(name, {})).toBe(NUMERIC_ENV_DEFAULTS[name]);
    }
  });

  it('returns the configured value when it is a positive integer', () => {
    expect(readNumericEnv('DAILY_TURN_CAP', { DAILY_TURN_CAP: '42' })).toBe(42);
  });

  it('tolerates surrounding whitespace, which a dashboard paste adds', () => {
    expect(readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: ' 7 ' })).toBe(7);
  });

  // The regression this file exists for. Every one of these used to become
  // NaN, and every `count >= NaN` is false, so the cap disappeared silently
  // and the spend path it bounded ran unbounded.
  it.each([
    ['a typo', '30O'],
    ['a stray unit', '300 turns'],
    ['an empty value', ''],
    ['whitespace only', '   '],
    ['a bare minus', '-'],
    ['not a number at all', 'true'],
  ])('throws rather than return NaN for %s', (_label, raw) => {
    expect(() => readNumericEnv('DAILY_TOKEN_CAP', { DAILY_TOKEN_CAP: raw })).toThrow(
      /DAILY_TOKEN_CAP must be a positive integer/,
    );
  });

  // Not NaN, but not a cap either: each of these would be enforced literally
  // and lock the feature off, which is worth refusing at boot rather than
  // debugging from a 429 in production.
  it.each([
    ['zero', '0'],
    ['a negative', '-5'],
    ['a fraction', '2.5'],
  ])('throws for %s', (_label, raw) => {
    expect(() =>
      readNumericEnv('DAILY_TURN_CAP', { DAILY_TURN_CAP: raw }),
    ).toThrow(/DAILY_TURN_CAP must be a positive integer/);
  });

  it('names the variable and shows the offending value', () => {
    expect(() =>
      readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: 'five' }),
    ).toThrow('TURN_PAIR_CAP must be a positive integer, got "five"');
  });
});

describe('validateEnv', () => {
  it('passes when everything is unset, so defaults alone boot cleanly', () => {
    expect(() => validateEnv({})).not.toThrow();
  });

  it('passes when every variable is a valid positive integer', () => {
    expect(() =>
      validateEnv({
        DAILY_TURN_CAP: '300',
        DAILY_TOKEN_CAP: '150000',
        TURN_PAIR_CAP: '5',
      }),
    ).not.toThrow();
  });

  it('reports every bad variable at once, not just the first', () => {
    let message = '';
    try {
      validateEnv({ DAILY_TURN_CAP: 'x', DAILY_TOKEN_CAP: '', TURN_PAIR_CAP: '0' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('DAILY_TURN_CAP');
    expect(message).toContain('DAILY_TOKEN_CAP');
    expect(message).toContain('TURN_PAIR_CAP');
  });

  it('covers every registered variable, so a new one cannot be added without boot coverage', () => {
    for (const name of NAMES) {
      expect(() => validateEnv({ [name]: 'not-a-number' })).toThrow(
        new RegExp(name),
      );
    }
  });
});
