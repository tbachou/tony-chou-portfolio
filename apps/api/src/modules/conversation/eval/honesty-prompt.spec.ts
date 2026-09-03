import { buildHonestyUserMessage } from './honesty-prompt';
import { StoryOwnership } from '../../../generated/prisma/enums';
import type { StoryModel } from '../../../generated/prisma/models';

const story = {
  id: 's1',
  title: 'Topstep onboarding rebuild',
  engagement: 'Topstep',
  ownership: StoryOwnership.CONTRIBUTED,
  summary: 'Rebuilt the onboarding flow with two other engineers.',
  requiredFraming: null,
} as StoryModel;

describe('buildHonestyUserMessage', () => {
  it('carries the ownership level, which is the thing being judged', () => {
    const message = buildHonestyUserMessage({
      story,
      tonyRaw: 'I helped rebuild it.',
      retrieved: [],
    });

    expect(message).toContain(StoryOwnership.CONTRIBUTED);
    expect(message).toContain('Topstep onboarding rebuild');
    expect(message).toContain('I helped rebuild it.');
  });

  it('includes the required framing only when the story has one', () => {
    expect(
      buildHonestyUserMessage({ story, tonyRaw: 'x', retrieved: [] }),
    ).not.toContain('Required framing');

    const scripted = { ...story, requiredFraming: 'Say it was a team effort.' } as StoryModel;
    expect(
      buildHonestyUserMessage({ story: scripted, tonyRaw: 'x', retrieved: [] }),
    ).toContain('Say it was a team effort.');
  });

  it('says plainly that nothing was retrieved, so the story is the only source', () => {
    const message = buildHonestyUserMessage({
      story,
      tonyRaw: 'An ordinary answer.',
      retrieved: [],
    });

    expect(message).toContain('Retrieved sections: none');
    expect(message).toContain('supported by the story facts above');
  });

  it('shows every retrieved section and names them as Tony own documents', () => {
    const message = buildHonestyUserMessage({
      story,
      tonyRaw: 'A cited answer.',
      retrieved: [
        '[1] docs/specs/_root/0013.md — Second layer\nsome text',
        '[1] docs/specs/_root/0008.md — Rejected\nother text',
      ],
    });

    expect(message).toContain('--- result 1 ---');
    expect(message).toContain('--- result 2 ---');
    expect(message).toContain('0013.md');
    expect(message).toContain('0008.md');
    // Without this the judge cannot tell an answer sourced from Tony's own
    // documents from one he invented, and it scored two correct
    // retrieval-attribution answers 0 on 2026-09-03 for exactly that reason.
    expect(message).toContain('not an overclaim');
    // The "story is the only source" licence must not survive a real search.
    expect(message).not.toContain('Retrieved sections: none');
  });

  it('puts the answer after the sources, so the sources frame the judgement', () => {
    const message = buildHonestyUserMessage({
      story,
      tonyRaw: 'THE ANSWER',
      retrieved: ['[1] docs/specs/_root/0008.md — Rejected\ntext'],
    });

    expect(message.indexOf('0008.md')).toBeLessThan(message.indexOf('THE ANSWER'));
    expect(message.trimEnd().endsWith('Score ownership honesty now.')).toBe(true);
  });
});
