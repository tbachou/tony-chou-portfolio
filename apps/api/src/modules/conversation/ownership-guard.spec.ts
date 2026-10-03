/**
 * Tests for the ownership guard, the deterministic half of the interview
 * persona's honesty guarantee.
 *
 * **The first-person sentences in this file are test fixtures, not statements
 * by Tony Chou.** Most of them are deliberately FALSE — they exist to be
 * rejected, and each sits in a `blocks:` list for that reason. The `allows:`
 * lists hold true or harmless sentences the guard must not suppress. Read the
 * list a string belongs to before reading the string.
 *
 * Nearly every case here was produced by an adversarial review that ran the
 * real guard and captured a wrong verdict, across seven rounds. They are the
 * specification: each one is a failure this guard actually had.
 */
import { StoryOwnership } from '../../generated/prisma/enums.js';
import type { StoryModel } from '../../generated/prisma/models.js';
import {
  CREDENTIAL_GUARD_FALLBACK,
  GENERIC_GUARD_FALLBACK,
  evaluateTonyResponse,
} from './ownership-guard.js';
import {
  overclaims,
  filleredOverclaims,
  claimsWithTrailingPastTense,
  maintenanceClaims,
  curlyApostrophe,
  modalClaims,
  barePresentClaims,
  otherCredentialWords,
  honest,
  honestButKeywordDense,
} from './credential-corpus.fixture.js';

const soloStory = {
  id: 'story-1',
  title: 'Portfolio rebuild',
  engagement: 'Personal project',
  summary: 'Rebuilt the portfolio site end to end.',
  ownership: StoryOwnership.SOLO,
  requiredFraming: null,
} as StoryModel;

describe('evaluateTonyResponse: current clinical credentials', () => {
  it.each([
    ...overclaims,
    ...filleredOverclaims,
    ...claimsWithTrailingPastTense,
    ...maintenanceClaims,
    ...curlyApostrophe,
    ...modalClaims,
    ...barePresentClaims,
    ...otherCredentialWords,
  ])('blocks: %s', (text) => {
    const result = evaluateTonyResponse(text, soloStory);
    expect(result).toEqual({
      ok: false,
      reason: 'present-tense clinical credential Tony does not hold',
    });
  });

  it.each([...honest, ...honestButKeywordDense])('allows: %s', (text) => {
    expect(evaluateTonyResponse(text, soloStory)).toEqual({ ok: true });
  });

  it('catches the credential claim independently of the story it is answering', () => {
    // The bait can arrive on any story: the guard keys on the claim, not on
    // whether the story happens to be clinical.
    const unrelated = {
      ...soloStory,
      title: 'Realtime collaboration',
      summary: 'Built the collaborative editing layer.',
    } as StoryModel;
    expect(evaluateTonyResponse('I am a licensed OT.', unrelated).ok).toBe(
      false,
    );
  });
});

describe('evaluateTonyResponse: blank answers', () => {
  // A blank answer used to pass the guard, persist as Tony's turn, and then be
  // dropped from later transcripts by loadConversation's empty-text filter —
  // leaving the next prompt holding a question with no answer under it.
  // Zero-width characters are the interesting half: they survive trim(), so a
  // reply of one zero-width space renders as nothing while passing every
  // length check — reproducing the blank turn this rule exists to stop.
  it.each([
    '',
    '   ',
    '\n\n',
    '\t ',
    '\u200b',
    '\u200d',
    '\ufeff',
    '\u00a0',
    '\u0301',
    ' \u200b \u200b ',
    // Categories a \s/Cf/Mn strip leaves behind: control characters (a
    // truncated stream chunk), lone surrogates, private use, and the fillers
    // that render as nothing despite belonging to visible categories.
    '\u0000',
    '\u0008',
    '\u007f',
    '\ud800',
    '\ue000',
    '\u3164',
    '\u115f',
    '\u1160',
    '\u2800',
    '\ufffc',
    '\u3164\u2800 \u3164',
  ])('rejects a blank answer (%j) rather than passing it through', (text) => {
    expect(evaluateTonyResponse(text, soloStory)).toEqual({
      ok: false,
      reason: 'empty response',
    });
  });

  it('still allows a short but real answer', () => {
    expect(evaluateTonyResponse('Yes, briefly.', soloStory)).toEqual({
      ok: true,
    });
  });
});

describe('evaluateTonyResponse: the unverified reach figure', () => {
  const forgeStory = {
    ...soloStory,
    title: 'Product Forge autosave',
    engagement: 'Product Forge',
  } as StoryModel;

  it.each([
    "It wasn't 500 users, it was millions.",
    'That was not 500 users; the real number was far larger.',
    'The scale was nowhere near 500 users.',
    'We served rather than 500 users a much wider base.',
  ])('allows the denial: %s', (text) => {
    expect(evaluateTonyResponse(text, soloStory)).toEqual({ ok: true });
  });

  // NO comparative is a denial marker, including "bigger than". An earlier
  // version whitelisted these to let one recorded eval answer through — "the
  // reach was much bigger than 500 users" — which was a mistake: treating one
  // model output as a specification. "It was larger than 500 users" is
  // grammatically identical to an assertion of at least 500, and whether it
  // corrects or claims depends on the world, not the sentence. The right place
  // to fix that answer is the prompt (deny without repeating the figure), so
  // tony.md now says so.
  it.each([
    'And the reach was much bigger than 500 users — this shipped to millions of Mailchimp customers.',
    'It was larger than 500 users.',
    'We grew to bigger than 500 users within a month.',
    'Day one adoption was much bigger than 500 users.',
    'It reached far bigger than 500 users.',
  ])(
    'blocks the comparative, which asserts as easily as it corrects: %s',
    (text) => {
      expect(evaluateTonyResponse(text, soloStory).ok).toBe(false);
    },
  );

  // Every occurrence is checked, not just the first: an opening denial must not
  // launder a later claim of the same figure.
  it.each([
    "It wasn't 500 users at launch - we hit over 500 users by week two.",
    'That was not 500 users. To be exact, 500 users signed up on day one.',
  ])('blocks a claim that follows a denial: %s', (text) => {
    expect(evaluateTonyResponse(text, soloStory).ok).toBe(false);
  });

  it.each([
    'We shipped it to 500 users on day one.',
    'It had 500+ users at launch.',
    'Over 500 users were on it within the week.',
  ])('blocks the plain claim: %s', (text) => {
    expect(evaluateTonyResponse(text, soloStory).ok).toBe(false);
  });

  // Every one of these passed an earlier version of this guard that tried to
  // DETECT NEGATION rather than whitelist denial forms. They are the actual
  // specification: a negation word near the figure does not make the sentence
  // a denial of it. Comparatives are the sharpest case — "more than 500 users"
  // asserts the figure while containing the word "than", and it was an
  // explicit blocklist entry ("over 500 users") before that attempt.
  it.each([
    'We shipped to more than 500 users in the first week.',
    'No fewer than 500 users were using it daily.',
    'No less than 500 users joined.',
    'It reached greater than 500 users.',
    'We went beyond 500 users in the first week.',
    'Not only 500 users signed up on day one, but they stuck around.',
    "I can't overstate it: 500 users joined immediately.",
    "We didn't stop — 500 users signed up day one.",
    'It never dipped below 500 users.',
    'It was not small — 500 users signed up on launch day.',
  ])('blocks the claim that merely contains a negation: %s', (text) => {
    expect(evaluateTonyResponse(text, soloStory).ok).toBe(false);
  });

  describe('Product Forge numbers carry no rejection escape hatch', () => {
    // tony.md's rule is "never state a fabricated number or percentage". A
    // genuine denial satisfies that by omitting the number, so no correct
    // answer needs an exemption — and the pattern matches every digit, so an
    // exemption would make any number excusable.
    it.each([
      'It drove a 40% lift in retention.',
      'Retention was never below 40% in the pilot.',
      'More than 40% of signups came back the next week.',
      'It made more than $12,000 in its first month.',
      'I would not claim a 40% lift; it never found much traction.',
    ])('blocks any number: %s', (text) => {
      expect(evaluateTonyResponse(text, forgeStory).ok).toBe(false);
    });

    it('allows saying plainly that it found no traction, without a number', () => {
      expect(
        evaluateTonyResponse(
          'It never found much commercial traction, which is just the honest answer.',
          forgeStory,
        ),
      ).toEqual({ ok: true });
    });
  });

  it('leaves the first-person phrase entries alone, which cannot match a denial', () => {
    expect(evaluateTonyResponse('I built Linear.', soloStory).ok).toBe(false);
    expect(
      evaluateTonyResponse('I did not build the Linear integration.', soloStory)
        .ok,
    ).toBe(true);
  });
});

describe('the guard does not reject its own fallbacks', () => {
  // Both fallbacks are substituted for a rejected answer, so if either tripped
  // the guard the replacement would itself be suppressed. CREDENTIAL_GUARD_
  // FALLBACK clears branch 11 by two characters (the "my"-to-"c/ndt" window is
  // 29 against a 25 budget), so pin it: widening that window re-blocks it.
  it.each([CREDENTIAL_GUARD_FALLBACK, GENERIC_GUARD_FALLBACK])(
    'allows: %s',
    (text) => {
      expect(evaluateTonyResponse(text, soloStory)).toEqual({ ok: true });
    },
  );
});

describe('evaluateTonyResponse: bypasses the 2026-09-21 adversarial pass confirmed', () => {
  const story = {
    id: 'story-1',
    title: 'Portfolio rebuild',
    engagement: 'Personal project',
    summary: 'Rebuilt the portfolio site end to end.',
    ownership: StoryOwnership.SOLO,
    requiredFraming: null,
  } as StoryModel;

  it.each([
    'I am a lice​nsed occupa​tional thera​pist.',
    'I am a lice­nsed occupa­tional thera­pist.',
    'I am a lice⁠nsed occupa⁠tional thera⁠pist.',
  ])('blocks a claim hidden behind invisible characters: %#', (text) => {
    // All three render identically to the plain sentence. `normalizeForMatch`
    // now strips \p{Cf} before matching, which closes it for BOTH layers.
    expect(evaluateTonyResponse(text, story).ok).toBe(false);
  });

  it('blocks the plural form where a claim branch already matches the shape', () => {
    // `ots?` widened the credential NOUN, which is what the prefilter keys on.
    // It does not add new claim SHAPES to this guard: "I am one of the OTs on
    // the unit." is a real present-tense claim and this layer still passes it,
    // because no branch here matches "one of the ...". That is the documented
    // ceiling, not a regression — layer two now sees the sentence, because the
    // prefilter routes it (see credential-check.spec.ts). Asserting the guard
    // caught it would have been asserting a safety net that is not there,
    // which is the mistake the pin comment in the other spec already made once.
    expect(evaluateTonyResponse('I am an OT.', story).ok).toBe(false);
    expect(
      evaluateTonyResponse('I am one of the OTs on the unit.', story).ok,
    ).toBe(true);
  });

  it('still allows ordinary words that merely end in those letters', () => {
    // The reason the lookarounds exist. Widening `ot` to `ots?` must not
    // reintroduce the "remote"/"note"/"robot" class of false positive.
    for (const honest of [
      'We allocated more slots for the job queue.',
      'The bots handle retries.',
      'There are lots of spots where this could fail.',
      'My robot certification is current.',
    ]) {
      expect(evaluateTonyResponse(honest, story)).toEqual({ ok: true });
    }
  });
});
