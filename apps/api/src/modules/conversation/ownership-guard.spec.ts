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

  it.each(overclaims)('blocks: %s', (text) => {
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
