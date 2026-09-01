import type { StoryModel } from '../../../generated/prisma/models';

/**
 * Assembles what the grounding judge is shown (spec 0012 phase three, AC-6).
 *
 * In `src/` rather than beside the scorer because jest's `rootDir` is `src`
 * and nothing under `scripts/` is collected. The judging itself is a model
 * call and cannot be unit tested, but WHICH SOURCES the judge is told about
 * is pure, and it decides whether an ordinary answer is marked down for
 * failing to cite something that was never retrieved.
 */

export function buildGroundingUserMessage(params: {
  story: StoryModel;
  tonyRaw: string;
  /** searchKnowledge results this turn, in order. Empty when it never searched. */
  retrieved: string[];
}): string {
  const { story, tonyRaw, retrieved } = params;
  return [
    `Story facts — title: ${story.title}; engagement: ${story.engagement}; details: ${story.summary}`,
    // Stated explicitly in BOTH directions. Silence about retrieval is not
    // neutral: a judge shown only the story could assume a search happened and
    // was omitted, and mark down an answer that had nothing to cite.
    retrieved.length === 0
      ? 'Retrieved sections: none. The tool was not used this turn, so there is nothing to attribute and attribution must not be required.'
      : [
          'Retrieved sections handed to the persona (each begins with the source document path):',
          ...retrieved.map(
            (section, index) => `--- result ${index + 1} ---\n${section}`,
          ),
        ].join('\n'),
    `Tony's answer:\n"""\n${tonyRaw}\n"""`,
    'Score factual grounding and attribution now.',
  ].join('\n\n');
}
