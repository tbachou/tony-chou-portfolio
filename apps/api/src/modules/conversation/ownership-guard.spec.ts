import { StoryOwnership } from '../../generated/prisma/enums';
import type { StoryModel } from '../../generated/prisma/models';
import {
  CREDENTIAL_GUARD_FALLBACK,
  GENERIC_GUARD_FALLBACK,
  evaluateTonyResponse,
} from './ownership-guard';

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
    // Re-baselined: the original said "by training and still one on paper",
    // which conflated an honest qualifier with the overclaim. "by training" is
    // now an allowed phrasing, so the claim here is the licence, explicitly.
    'I am an occupational therapist by training and I still hold my OT license.',
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

  // Each of these was ALLOWED by a version that excused a span containing any
  // past-tense or negating word. The marker sat after the credential, or in a
  // different clause, and whitelisted a claim that had already been made.
  const claimsWithTrailingPastTense = [
    'I am a licensed OT and was for years.',
    'I am still a licensed occupational therapist, then and now.',
    "I'm a licensed OT; before that I was a student.",
    'I am a licensed occupational therapist and my license has not expired.',
    'I am currently a licensed OT, as I was in 2019.',
    'I hold a current OT license and worked clinically for six years.',
    'I remain a licensed OT, never having let it lapse.',
    'I am a practicing occupational therapist and spent six years in the field.',
    'I am an OT. My ex-colleague can confirm it.',
  ];

  // Realistic misses the enumerated list was widened to cover: the
  // hold/have/keep family and "work as", each still requiring a clinical noun.
  const maintenanceClaims = [
    'I have an active OT license.',
    'I still hold my OT license.',
    'I keep my OT license current.',
    'I work as an occupational therapist.',
  ];

  // A curly apostrophe defeated every "I'm" branch: one character, and a false
  // claim of medical licensure reached the visitor. U+2019 is the default
  // typography of the model whose output this reads, so this was not exotic.
  const curlyApostrophe = [
    '\u2019m a licensed occupational therapist.'.replace('\u2019', 'I\u2019'),
    'I\u2019m an occupational therapist and I treat patients weekly.',
    'I\u2019m still a practicing occupational therapist.',
    'I\u2019m still an OT and I take clients.',
  ];

  // The modal forms, which are the grammatical echo of the question a visitor
  // actually asks ("could you still treat patients?").
  const modalClaims = [
    'I could still treat patients.',
    'I can still see patients.',
    'I could take a caseload again tomorrow.',
    'I do still practice occupational therapy.',
  ];

  // Bare present tense, with no "still" or "currently" to key on.
  const barePresentClaims = [
    'I treat patients on Fridays.',
    'I see patients weekly at the clinic.',
    'I practice occupational therapy on weekends.',
    'I am an OT alum and I treat patients on weekends.',
    'I am an OT program graduate who still sees patients weekly.',
  ];

  // Credential nouns and copulas the enumeration was missing.
  const otherCredentialWords = [
    'I am a registered occupational therapist.',
    'I am a certified occupational therapist.',
    'I am an OTR/L licensed in Colorado.',
    'I hold an active OT certification.',
    'I have an active NBCOT certification.',
    'My OT license remains current.',
    'I am an occupational therapy practitioner.',
    'My OT license is in good standing.',
    'My C/NDT never expired.',
    'Yes, I am still licensed.',
    // Exceeds the old 25-character window between the verb and the licence.
    "I hold, and have held without interruption since 2011, an OT license.",
    'I have, for what it\u2019s worth, a current OT license.',
    // Whitespace and apostrophe variants. The double space needs no exotic
    // input at all — it is an ordinary stream-join artefact, and it bypassed
    // the entire guard.
    'I am  a licensed occupational therapist.',
    'I am\ta licensed occupational therapist.',
    'I\u00a0am a licensed occupational therapist.',
    'I am a licensed occupational\u00a0therapist.',
    'I\u202fam a licensed occupational therapist.',
    'I\u00b4m a licensed occupational therapist.',
    'I\uff07m a licensed occupational therapist.',
    'I\u2032m a licensed occupational therapist.',
    // "O.T." is a standard written form of the credential.
    'I am a licensed O.T.',
    'I am a licensed O/T.',
  ];

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

  // The words this rule keys on are ordinary engineering vocabulary. Every
  // string below was blocked by a "credential word nearby, negation absent"
  // span check that looked reasonable and was not: proximity means nothing
  // here, only the shape of a first-person claim does. They are the reason
  // the rule is an enumerated list of claim forms rather than a heuristic.
  const honestButKeywordDense = [
    // The credential belongs to someone else.
    'I am a software engineer. My wife is a licensed occupational therapist.',
    'I am building a tool for licensed occupational therapists.',
    'I currently collaborate with licensed clinicians on the content.',
    "I'm designing the intake flow with a licensed OT reviewing it.",
    "I'm on a team building software for licensed therapists.",
    // "practice" with no clinical sense at all.
    'I am practicing test-driven development on this codebase.',
    'I still practice code review discipline every day.',
    'I currently practice pair programming with the team.',
    // "license" in a software or civil sense.
    'I am the licensee of the MIT license for this repo.',
    'I currently hold a driver license and nothing more exotic.',
    'I am shipping under an open source license.',
    // "OT" as a field, a programme, or an abbreviation of the real degree.
    'I hold an M.S. in OT from Ohio State.',
    'I am reading about OT history for background.',
    'I currently mentor students in the OT program.',
    // Product-domain talk that happens to name the clinical verb.
    'I am building a scheduler that helps clinics see patients faster.',
    // Non-clinical certifications and licences. Two branches used to match
    // "certification is current" and "hold a current ... license" with no
    // clinical word in them at all — proximity reasoning wearing a regex
    // costume. This persona talks about cloud certifications constantly, so
    // these are the likeliest sentences in the whole list.
    'My AWS certification is still valid until 2027.',
    'My Solutions Architect certification is current.',
    'My CPR certification is current, which is unrelated to clinical work.',
    'My JetBrains license is active on this machine.',
    'My open source license is still valid for this use.',
    'My driver license is still valid.',
    'I hold a current driver license.',
    'I hold a current AWS certification in AI practitioner.',
    // "OT" bound into a compound or qualifying a noun is not a claim to be one.
    'I am an OT-trained engineer.',
    'I am an OT alum who now writes TypeScript.',
    'I am an OT school graduate turned engineer.',
    // Past tense, however it is phrased.
    'I am a former OT.',
    'I am an ex-OT.',
    'The OT license I held is long expired; I am an engineer now.',
    'I am not licensed and have not been since 2020.',
    // `ot` with no boundary guard matched inside ordinary words. Every one of
    // these is a sentence this engineering persona would actually say.
    'My note on that is still valid.',
    'My remote branch is up to date.',
    'My robot certification is current.',
    'My bot token is still valid.',
    'My footer copy is current.',
    'My Terraform remote state is up to date.',
    'My screenshot of the dashboard is current.',
    'My knowledge of the protocol is current.',
    'I have a chatbot license key in the repo.',
    'I still have the robot license plate photo somewhere.',
    // A licence with no clinical noun attached to it.
    'I am a licensed pilot, which is where the checklist habit comes from.',
    'I am licensed to use that dataset commercially.',
    "I'm licensed under MIT for everything I publish.",
    'I am currently licensed to drive commercial vehicles.',
    'I am a licensed amateur radio operator.',
    'I am board certified in Kubernetes.',
    // The most natural TRUE sentence about the lapsed licence. An earlier
    // window bridged "I have" to the licence straight across the word "not".
    'I have not held an occupational therapy license since 2019.',
    // The relative-clause branch is bound to a self-identification, so a
    // clause about someone else must still pass.
    'I work with a therapist who still sees patients weekly.',
    'I am building software for a clinic whose OTs see patients daily.',
    // The relative-clause branch is bound to a self-identification. A clause
    // about a colleague, a teammate, or a spouse must pass.
    "I'm on a team with an OT who treats patients.",
    'I am the engineer on a product with an OT who still sees patients.',
    'I am working alongside an occupational therapist who treats patients weekly.',
    "I'm married to an OT who still sees patients.",
    'I am reviewing notes from an OT who sees patients daily.',
    // Plain statements of the fact the guard exists to protect.
    'I have no OT license.',
    'I have no current OT license.',
    'I hold no OT certification.',
    'I have no plans to renew my OT license.',
    'I have an inactive OT license.',
    'I have a dormant OT license.',
    // Honest qualifiers: the credential describes his background, not his job.
    "I'm an occupational therapist by training, now a software engineer.",
    'I am an OT by training who moved into engineering.',
    'I am an occupational therapist turned software engineer.',
    'I am an OT turned engineer.',
    "I'm an occupational therapist by background.",
  ];

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
