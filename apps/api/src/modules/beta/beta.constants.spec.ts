import {
  ANY_CRIMP_PATTERN,
  CONSTANT_REST_PAIN_MESSAGE,
  DOSE_MIN,
  FULL_CRIMP_PATTERN,
  INJECTION_BLOCKLIST,
  RED_FLAG_MESSAGES,
  REFUSAL_MESSAGE,
  namePrescribesCrimping,
  normalizeForMatch,
} from './beta.constants';

describe('normalizeForMatch', () => {
  it.each([
    ['Full-Crimp Hangs', 'full crimp hangs'],
    ['full_crimp', 'full crimp'],
    ['  Full   Crimp  ', 'full crimp'],
    ['HALF-CRIMP', 'half crimp'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });

  it('collapses every hyphenation of the crimp prohibitions onto one pattern', () => {
    for (const variant of ['full-crimp', 'Full Crimp', 'FULL_CRIMP']) {
      expect(normalizeForMatch(variant)).toContain(FULL_CRIMP_PATTERN);
    }
  });

  it('does not let the full-crimp pattern match half-crimp', () => {
    // drafter.md calls "gradual half-crimp reintroduction under load"
    // correct in later stages, so the prohibition must not swallow it.
    expect(normalizeForMatch('Half-crimp holds')).not.toContain(
      FULL_CRIMP_PATTERN,
    );
    // ...but the broader stage-1 pattern deliberately does catch it,
    // transcribing "No crimping of any kind".
    expect(normalizeForMatch('Half-crimp holds')).toContain(ANY_CRIMP_PATTERN);
  });
});

describe('namePrescribesCrimping', () => {
  const check = (name: string) => namePrescribesCrimping(normalizeForMatch(name));

  it.each([
    'Crimp repeaters',
    'Half-crimp isometric holds',
    'Full-crimp hangs',
    'Crimping on small edges',
    'Open-hand into half-crimp transition',
  ])('is true for %j, which programs crimping', (name) => {
    expect(check(name)).toBe(true);
  });

  it.each([
    'Open-hand tendon glides (no crimping)',
    'Non-crimp finger extensions',
    'Rice bucket work — avoid crimping',
    'Tendon glides, no crimping of any kind',
    'Putty squeezes without crimping',
    'Finger extensions, not crimped',
    'Open-hand hangs (never crimp)',
    'Wrist curls, avoids crimping',
    'Noncrimp putty work',
    'Open-hand putty squeezes',
  ])('is false for %j, which rules crimping out', (name) => {
    expect(check(name)).toBe(false);
  });

  it('is not blinded by a negation earlier in the same name', () => {
    expect(check('Open-hand glides (no crimping), then half-crimp holds')).toBe(
      true,
    );
  });
});

describe('layer 1 dose bounds', () => {
  it('is a positive-integer floor with no ceiling (calibration run not done)', () => {
    expect(DOSE_MIN).toBe(1);
    // A named maximum must not appear until the spec's calibration run has
    // observed the drafter's real range. Anything else is a guess hardened
    // into a permanent ceiling. This assertion is the tripwire.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constants = require('./beta.constants') as Record<string, unknown>;
    expect(
      Object.keys(constants).filter((key) => /^DOSE_.*MAX/.test(key)),
    ).toEqual([]);
  });
});

describe('injection blocklist', () => {
  it('is lowercase, so it can be matched against lowercased goals', () => {
    for (const phrase of INJECTION_BLOCKLIST) {
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });

  it('carries exactly the phrases the spec enumerates, and nothing invented', () => {
    expect([...INJECTION_BLOCKLIST]).toEqual([
      'ignore your instructions',
      'ignore the above',
      'disregard your',
      'you are now',
      'system prompt',
      'new instructions',
      'act as',
    ]);
  });
});

/**
 * AC-G14's "byte identical afterwards" half, for the safety copy that lives
 * on the api side. Generic educational framing must never displace or dilute
 * these; if one of them changes, that is a clinical copy decision and this
 * test is where it has to be made deliberately.
 */
describe('audited clinical safety copy is unchanged', () => {
  it('pins RED_FLAG_MESSAGES byte for byte', () => {
    expect(RED_FLAG_MESSAGES).toEqual({
      sudden_pop_with_swelling:
        'A sudden pop or snap at the moment of injury — with or without swelling — can mean a pulley or tendon has torn, and that deserves a proper look before any rehab plan. Please see a sports medicine doctor or a hand specialist soon. They can image it, grade it, and get you on the right track. This tool is not the right next step for that symptom.',
      numbness_or_tingling:
        'Numbness or tingling points at a nerve, and nerves need a real assessment, not a generic plan. Please see a doctor or a physical therapist trained in nerve evaluation before loading anything. Once a professional has cleared it, a staged return makes sense. This tool is not the right next step for that symptom.',
      cannot_bear_weight_or_grip:
        'Not being able to bear weight or use your hand suggests something structural that needs a professional exam first. Please see a doctor promptly, ideally sports medicine or orthopedics. A plan from a website is not the right next step until they have ruled out the serious stuff.',
      night_pain:
        'Pain that wakes you at night can point beyond a simple strain, and that is worth ruling out properly. Please see a physician before starting any loading program. Once they have cleared it, a staged return to climbing is a great goal. This tool is not the right next step for that symptom.',
    });
  });

  it('pins CONSTANT_REST_PAIN_MESSAGE byte for byte', () => {
    expect(CONSTANT_REST_PAIN_MESSAGE).toBe(
      'Pain that stays constant even at rest — this long after the injury, or together with swelling or weakness — can point beyond a simple strain, and that is worth ruling out properly. Please see a physician or physical therapist before starting any loading program. Once they have cleared it, a staged return to climbing is a great goal.',
    );
  });

  it('pins REFUSAL_MESSAGE byte for byte (the injection block reuses it)', () => {
    expect(REFUSAL_MESSAGE).toBe(
      'This tool only drafts educational return-to-climbing plans from the injury details in the form. It cannot help with that request. If you have a climbing injury, fill in the form fields and it will gladly draft a staged plan.',
    );
  });
});
