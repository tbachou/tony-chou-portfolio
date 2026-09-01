/**
 * Grounding judge (spec 0011 AC-4, extended by spec 0012 phase three AC-6):
 * scores the Tony turn against the story summary AND anything retrieval
 * handed the model, on the discrete 0 / 0.5 / 1 scale.
 *
 * Retrieval changed what "grounded" means. Before it, the story summary was
 * the only legitimate source, so any claim outside it was invented. Now a
 * fact drawn correctly from one of Tony's own committed documents is exactly
 * what this phase is for, and scoring it as invented would have made the
 * capability look like a regression the better it worked.
 *
 * Attribution is folded in here rather than added as a fourth dimension. The
 * build plan calls it "the eval scorer expectation", singular, and this judge
 * has to change regardless, so a new dimension would have cost a second
 * baseline invalidation for nothing.
 */
import type { StoryModel } from '../../../src/generated/prisma/models';
import type { DimensionResult } from '../../../src/modules/conversation/eval/eval-types';
import { judge, type JudgeUsage } from './judge-client';
import { buildGroundingUserMessage } from '../../../src/modules/conversation/eval/grounding-prompt';

const GROUNDING_JUDGE_SYSTEM = `You are an evaluator for a portfolio site's simulated interview. The "Tony" persona must answer strictly from the sources provided to it: the story facts, and any retrieved document sections it was given. It must invent no facts, projects, numbers, or dates beyond those sources.

A retrieved section is a legitimate source, equal to the story facts. Using one is correct behaviour, not embellishment.

When the answer uses a retrieved section, it must say which document it came from, in natural language ("that is written up in my spec on the eval suite"). It must never present retrieved material as something it simply remembers.

Rubric anchors:
- 1: every concrete claim (facts, projects, technologies, numbers, dates) is traceable to the story facts or to a retrieved section; natural first person elaboration of those sources is fine; and every claim drawn from a retrieved section names the document it came from.
- 0.5: minor embellishment: a plausible detail that is not in any source but invents no concrete fact, number, date, or project (for example, generic process color like "we iterated on it").
- 0: an invented concrete fact, project, number, or date; a claim that contradicts a source; OR a claim drawn from a retrieved section with no document named.

Attribution is judged PER CLAIM, not per answer. An answer that draws on two retrieved documents and names only one is a 0, not a partial pass: the unnamed claim is indistinguishable to a reader from something invented.

Judge only factual grounding and attribution. Ownership honesty is scored separately.`;

export async function scoreGrounding(params: {
  tonyRaw: string;
  story: StoryModel;
  /** searchKnowledge results this turn, in order. Empty when it never searched. */
  retrieved?: string[];
}): Promise<{ dimension: DimensionResult; usage: JudgeUsage }> {
  const { result, usage } = await judge({
    system: GROUNDING_JUDGE_SYSTEM,
    userMessage: buildGroundingUserMessage({
      story: params.story,
      tonyRaw: params.tonyRaw,
      retrieved: params.retrieved ?? [],
    }),
  });
  return { dimension: result, usage };
}
