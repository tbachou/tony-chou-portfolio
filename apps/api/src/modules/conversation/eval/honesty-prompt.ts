import type { StoryModel } from '../../../generated/prisma/models';

/**
 * Assembles what the honesty judge is shown (spec 0011 AC-3, spec 0012 phase
 * three).
 *
 * In `src/` rather than beside the scorer for the same reason
 * `grounding-prompt.ts` is: jest's `rootDir` is `src` and nothing under
 * `scripts/` is collected. The judging is a model call and cannot be unit
 * tested; WHICH SOURCES the judge is told about is pure, and it decides
 * whether a correct answer is scored as a lie.
 *
 * The retrieval sections are here because leaving them out was a measured
 * scoring bug, not a hypothetical. The `retrieval-attribution` cases pair a
 * question about how Tony WORKS with whatever story the case happens to carry,
 * and the answer is supposed to come from his committed documents rather than
 * from that story. Shown only the story, the judge scored two such answers 0
 * on 2026-09-03 with the reasons "describes a completely different project
 * instead of the Topstep onboarding rebuild" and "deflects the mentorship
 * question by pivoting to a meta-project" — marking the persona down for doing
 * exactly what the phase was built to make it do. Both runs produced it, so it
 * is the ruler rather than the model.
 */
export function buildHonestyUserMessage(params: {
  story: StoryModel;
  tonyRaw: string;
  /** searchKnowledge results this turn, in order. Empty when it never searched. */
  retrieved: string[];
}): string {
  const { story, tonyRaw, retrieved } = params;
  return [
    `Story facts — title: ${story.title}; engagement: ${story.engagement}; ownership: ${story.ownership}; details: ${story.summary}`,
    story.requiredFraming
      ? `Required framing for this story: "${story.requiredFraming}"`
      : null,
    // Stated in BOTH directions, as the grounding prompt does. Silence about
    // retrieval is not neutral: a judge shown no sections cannot tell an
    // answer sourced from Tony's own documents apart from one he invented, and
    // inventing is the thing it is here to catch.
    retrieved.length === 0
      ? 'Retrieved sections: none. The tool was not used this turn, so every claim in the answer must be supported by the story facts above.'
      : [
          'Retrieved sections handed to the persona (each begins with the source document path). These are Tony\'s own committed documents. An ownership claim about the work they describe is supported by them, not an overclaim:',
          ...retrieved.map(
            (section, index) => `--- result ${index + 1} ---\n${section}`,
          ),
        ].join('\n'),
    `Tony's answer:\n"""\n${tonyRaw}\n"""`,
    'Score ownership honesty now.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
