import { buildGroundingUserMessage } from './grounding-prompt';
import type { StoryModel } from '../../../generated/prisma/models';

const story = {
  id: 's1',
  title: 'Portfolio rebuild',
  engagement: 'Personal project',
  summary: 'Rebuilt the portfolio.',
} as StoryModel;

describe('buildGroundingUserMessage', () => {
  it('says plainly that nothing was retrieved, so nothing must be attributed', () => {
    const message = buildGroundingUserMessage({
      story,
      tonyRaw: 'An ordinary answer.',
      retrieved: [],
    });

    // Silence about retrieval is not neutral. A judge shown only the story
    // could assume a search happened and was omitted, and mark down an answer
    // that had nothing to cite.
    expect(message).toContain('Retrieved sections: none');
    expect(message).toContain('attribution must not be required');
  });

  it('shows every retrieved section, numbered, when the tool was used', () => {
    const message = buildGroundingUserMessage({
      story,
      tonyRaw: 'A cited answer.',
      retrieved: [
        '[1] docs/specs/_root/0011.md — Decision\nsome text',
        '[1] docs/specs/_root/0014.md — Summary\nother text',
      ],
    });

    expect(message).toContain('--- result 1 ---');
    expect(message).toContain('--- result 2 ---');
    expect(message).toContain('0011.md');
    expect(message).toContain('0014.md');
    // The "nothing to attribute" licence must not survive a real search.
    expect(message).not.toContain('attribution must not be required');
  });

  it('carries the story facts and the answer either way', () => {
    for (const retrieved of [[], ['[1] docs/a.md — H\nx']]) {
      const message = buildGroundingUserMessage({
        story,
        tonyRaw: 'The answer.',
        retrieved,
      });
      expect(message).toContain('Portfolio rebuild');
      expect(message).toContain('Rebuilt the portfolio.');
      expect(message).toContain('The answer.');
    }
  });
});
