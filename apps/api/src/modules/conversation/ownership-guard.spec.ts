import { StoryOwnership } from '../../generated/prisma/enums';
import type { StoryModel } from '../../generated/prisma/models';
import { evaluateTonyResponse } from './ownership-guard';

const soloStory = {
  id: 'story-1',
  title: 'Portfolio rebuild',
  engagement: 'Personal project',
  summary: 'Rebuilt the portfolio site end to end.',
  ownership: StoryOwnership.SOLO,
  requiredFraming: null,
} as StoryModel;

describe('evaluateTonyResponse: current clinical credentials', () => {
  // The rule skills/tony.md leads its never-claim list with. Unlike the three
  // commercial items there, this one misrepresents a real, regulated
  // qualification, so it is enforced here rather than only requested in a
  // prompt.
  const overclaims = [
    'I am a licensed occupational therapist, so I think about accessibility a lot.',
    "I'm a licensed OT and that shapes how I approach this.",
    'I am currently licensed in occupational therapy.',
    'I am an occupational therapist by training and still one on paper.',
    "I'm an OT, which is where the ergonomics instinct comes from.",
    'I still practice occupational therapy on the side.',
    'I currently treat patients two days a week.',
    'My OT license is current, though I do not use it much.',
    'My C/NDT is still valid.',
    'My occupational therapy licence is up to date.',
  ];

  // Every one of these walked through a version that required the credential
  // word to sit immediately after "I am". One filler defeated it.
  const filleredOverclaims = [
    "I'm still a licensed occupational therapist.",
    'I am still an occupational therapist and I take clients.',
    'I am a practicing occupational therapist.',
    'I remain a licensed OT.',
    'I hold a current OT license.',
    'I am, in fact, a licensed OT.',
    'I am board certified in occupational therapy and licensed today.',
    'As a licensed occupational therapist, I see patients weekly.',
  ];

  it.each([...overclaims, ...filleredOverclaims])('blocks: %s', (text) => {
    const result = evaluateTonyResponse(text, soloStory);
    expect(result).toEqual({
      ok: false,
      reason: 'present-tense clinical credential Tony does not hold',
    });
  });

  // The honest answers. These matter MORE than the cases above: a guard that
  // fires on the truth would replace a correct, verified answer with the
  // fallback, teaching the system to hide the real career history rather than
  // state it plainly. Every one of these must pass.
  const honest = [
    'I was a licensed occupational therapist for six years before moving into engineering.',
    'I am not a licensed OT any more; that certification lapsed years ago.',
    "I'm no longer a licensed occupational therapist and I do not practice.",
    'I used to be an occupational therapist, but the work here was a debugging problem.',
    'I was an OT for six years, then transitioned into engineering in 2020.',
    'I no longer practice, and my C/NDT certification is expired.',
    'My C/NDT certification is expired, so I would not claim it.',
    'I practiced occupational therapy until 2020.',
    'I hold an M.S. in Occupational Therapy from Ohio State.',
    'I am a senior software engineer with six years of production experience.',
  ];

  it.each(honest)('allows: %s', (text) => {
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
  ])(
    'rejects a blank answer (%j) rather than passing it through',
    (text) => {
      expect(evaluateTonyResponse(text, soloStory)).toEqual({
        ok: false,
        reason: 'empty response',
      });
    },
  );

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
  ])('blocks the comparative, which asserts as easily as it corrects: %s', (text) => {
    expect(evaluateTonyResponse(text, soloStory).ok).toBe(false);
  });

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
