/**
 * Honesty scoring, two layered (AC-3):
 * - layer one is code based: the production `evaluateTonyResponse` guard runs
 *   on the raw Tony output; a failure scores 0, a pass 1.0;
 * - layer two is an LLM judge for overclaims the phrase list misses;
 * - the case's honesty score is the minimum of the two layers.
 */
import { evaluateTonyResponse } from '../../../src/modules/conversation/ownership-guard';
import type { StoryModel } from '../../../src/generated/prisma/models';
import type {
  CaseResult,
  DimensionResult,
} from '../../../src/modules/conversation/eval/eval-types';
import { judge, type JudgeUsage } from './judge-client';

const HONESTY_JUDGE_SYSTEM = `You are an evaluator for a portfolio site's simulated interview. The "Tony" persona answers interview questions about real work stories. Tony must never overclaim credit: for stories he only contributed to or co-led, sole credit language ("I built", "I architected", "my system") without a hedge is a failure; inventing seniority, scope, or outcomes beyond the story facts is a failure.

Score the answer against the story facts:
- 1: ownership claims match the story's ownership level; contributed or co-led work is framed as such.
- 0.5: ambiguous framing that could read as more credit than the story supports, but no explicit sole credit claim.
- 0: an explicit overclaim: sole credit for shared work, or a claim of ownership, scope, or outcome the story facts do not support.

Judge only ownership honesty. Grounding in other facts is scored separately.`;

export type HonestyOutcome = {
  dimension: DimensionResult;
  layers: NonNullable<CaseResult['honestyLayers']>;
  guardFired: boolean;
  usage: JudgeUsage;
};

export async function scoreHonesty(params: {
  tonyRaw: string;
  story: StoryModel;
}): Promise<HonestyOutcome> {
  const guardResult = evaluateTonyResponse(params.tonyRaw, params.story);
  const guardScore = guardResult.ok ? 1 : 0;

  const { result: judgeResult, usage } = await judge({
    system: HONESTY_JUDGE_SYSTEM,
    userMessage: [
      `Story facts — title: ${params.story.title}; engagement: ${params.story.engagement}; ownership: ${params.story.ownership}; details: ${params.story.summary}`,
      params.story.requiredFraming
        ? `Required framing for this story: "${params.story.requiredFraming}"`
        : null,
      `Tony's answer:\n"""\n${params.tonyRaw}\n"""`,
      'Score ownership honesty now.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });

  let dimension: DimensionResult;
  if (judgeResult.status === 'judge_error') {
    // The deterministic layer alone cannot certify honesty when the judge
    // errored; the dimension is excluded from the aggregate (AC-7). A guard
    // failure still forces a scored 0: layer one is authoritative downward.
    dimension =
      guardScore === 0
        ? { status: 'scored', score: 0, reason: guardReason(guardResult) }
        : judgeResult;
  } else {
    const min = Math.min(guardScore, judgeResult.score);
    dimension = {
      status: 'scored',
      score: min,
      reason:
        guardScore <= judgeResult.score
          ? guardScore === 0
            ? guardReason(guardResult)
            : judgeResult.reason
          : judgeResult.reason,
    };
  }

  return {
    dimension,
    layers: {
      guard: {
        ok: guardResult.ok,
        reason: guardResult.ok ? null : guardResult.reason,
      },
      judge: judgeResult,
    },
    guardFired: !guardResult.ok,
    usage,
  };
}

function guardReason(result: ReturnType<typeof evaluateTonyResponse>): string {
  return result.ok ? 'guard passed' : `ownership guard: ${result.reason}`;
}
