import {
  NUMERIC_ENV_DEFAULTS,
  readNumericEnv,
  validateEnv,
  type NumericEnvName,
} from './env.config.js';

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
      /DAILY_TOKEN_CAP must be a whole number between 1 and 2147483647/,
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
    ).toThrow(/DAILY_TURN_CAP must be a whole number between 1 and 2147483647/);
  });

  // The pre-deploy gate's HIGH finding. These are all Number.isInteger-true
  // and positive, so the first cut of this parser waved them through — and a
  // cap above what the int4 counter column can hold is unreachable, which is
  // the same fail-open as NaN by a different route. DAILY_TOKEN_CAP=1e21 is
  // unlikely; an extra run of zeros is not.
  it.each([
    ['one past the int4 ceiling', '2147483648'],
    ['a fat-fingered run of zeros', '99999999999999999999'],
    ['scientific notation', '1e21'],
    ['a smaller exponent that still exceeds int4', '1e10'],
    ['above MAX_SAFE_INTEGER, which would be enforced as a different number', '9007199254740993'],
  ])('throws for %s', (_label, raw) => {
    expect(() =>
      readNumericEnv('DAILY_TOKEN_CAP', { DAILY_TOKEN_CAP: raw }),
    ).toThrow(/DAILY_TOKEN_CAP/);
  });

  it('accepts the int4 ceiling itself, so the bound is exclusive on the right side only', () => {
    expect(
      readNumericEnv('DAILY_TOKEN_CAP', { DAILY_TOKEN_CAP: '2147483647' }),
    ).toBe(2_147_483_647);
  });

  // Number() accepts these and returns something other than what was typed:
  // '0b1010' is ten, not one thousand and ten. Nothing opens spend here, but
  // a cap silently ten times smaller than intended locks the feature off.
  it.each([
    ['hex', '0x2710'],
    ['binary', '0b1010'],
    ['octal', '0o17'],
    ['a leading plus', '+300'],
    ['a trailing decimal point', '300.'],
  ])('throws for %s rather than coercing it to a different number', (_label, raw) => {
    expect(() =>
      readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: raw }),
    ).toThrow(/TURN_PAIR_CAP/);
  });

  it('names the variable and shows the offending value', () => {
    expect(() =>
      readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: 'five' }),
    ).toThrow(
      'TURN_PAIR_CAP must be a whole number between 1 and 100, got "five"',
    );
  });

  // The ceiling is per variable, because the justification differs. For the
  // two daily counters it is the int4 width of the column they compare
  // against, so nothing below it is unreachable. TURN_PAIR_CAP has no such
  // column: it is the ONLY bound on conversation length, and formatHistory
  // concatenates every prior turn into the next prompt, so a large value
  // grows the prompt without limit. A second adversarial pass measured the
  // growth: ~10k prompt tokens at 100 turns, ~100k at 1000.
  it('holds TURN_PAIR_CAP to a conversation length, not the int4 ceiling', () => {
    expect(readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: '100' })).toBe(100);
    expect(() =>
      readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: '101' }),
    ).toThrow(/TURN_PAIR_CAP must be a whole number between 1 and 100/);
    expect(() =>
      readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: '5000000' }),
    ).toThrow(/TURN_PAIR_CAP/);
  });

  it('still allows the daily counters up to the int4 ceiling', () => {
    for (const name of ['DAILY_TURN_CAP', 'DAILY_TOKEN_CAP'] as const) {
      expect(readNumericEnv(name, { [name]: '2147483647' })).toBe(2_147_483_647);
    }
  });

  // A rejected value must not RENDER as a valid one. JSON.stringify leaves
  // zero-width and bidi characters invisible, so a value pasted from a doc
  // used to fail the boot with `got "300"` next to a message saying 300 is
  // not a whole number between 1 and 100 — which reads as a bug in the
  // validator rather than a bad paste.
  it('makes invisible characters visible in the rejection message', () => {
    let message = '';
    try {
      readNumericEnv('TURN_PAIR_CAP', { TURN_PAIR_CAP: '\u200b5\u200b' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('\\u200b');
    expect(message).not.toContain('\u200b');
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
