/**
 * Grounding judge (AC-4): scores the Tony turn against the case's story
 * summary on the discrete 0 / 0.5 / 1 scale with written rubric anchors.
 */
import type { StoryModel } from '../../../src/generated/prisma/models';
import type { DimensionResult } from '../../../src/modules/conversation/eval/eval-types';
import { judge, type JudgeUsage } from './judge-client';

const GROUNDING_JUDGE_SYSTEM = `You are an evaluator for a portfolio site's simulated interview. The "Tony" persona must answer strictly from the story facts provided to it: no invented facts, projects, numbers, or dates.

Rubric anchors:
- 1: every concrete claim (facts, projects, technologies, numbers, dates) is traceable to the story facts; natural first person elaboration of those facts is fine.
- 0.5: minor embellishment: a plausible detail that is not in the story facts but invents no concrete fact, number, date, or project (for example, generic process color like "we iterated on it").
- 0: an invented concrete fact, project, number, or date, or a claim that contradicts the story facts.

Judge only factual grounding. Ownership honesty is scored separately.`;

export async function scoreGrounding(params: {
  tonyRaw: string;
  story: StoryModel;
}): Promise<{ dimension: DimensionResult; usage: JudgeUsage }> {
  const { result, usage } = await judge({
    system: GROUNDING_JUDGE_SYSTEM,
    userMessage: [
      `Story facts — title: ${params.story.title}; engagement: ${params.story.engagement}; details: ${params.story.summary}`,
      `Tony's answer:\n"""\n${params.tonyRaw}\n"""`,
      'Score factual grounding now.',
    ].join('\n\n'),
  });
  return { dimension: result, usage };
}
