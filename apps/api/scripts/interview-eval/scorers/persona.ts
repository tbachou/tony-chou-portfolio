/**
 * Persona judge (AC-5): same judge settings and scale. The Tony turn should
 * read as a candid first person interview answer of sensible length with no
 * AI mannerisms; the interviewer turn should ask one clear relevant question.
 */
import type { DimensionResult } from '../../../src/modules/conversation/eval/eval-types';
import { judge, type JudgeUsage } from './judge-client';

const PERSONA_JUDGE_SYSTEM = `You are an evaluator for a portfolio site's simulated interview between an "Interviewer" and "Tony", a software engineer answering questions about his own work.

Rubric anchors:
- 1: the interviewer turn asks one clear question relevant to the topic, and Tony's turn reads as a candid first person interview answer of sensible length (roughly 40 to 250 words) with no AI mannerisms (no "As an AI", no "Certainly!", no bullet lists or headers, no restating the question back verbatim, no assistant style closing offers).
- 0.5: one side has a minor flaw: a slightly rambling or oddly short answer, mild stiffness or template feel, or an interviewer question that bundles two questions.
- 0: a clear failure: assistant voice or AI mannerisms, third person self reference, an answer far outside sensible interview length, or an interviewer turn that is not a clear relevant question.

Judge only voice, format, and question quality. Factual accuracy and ownership honesty are scored separately.`;

export async function scorePersona(params: {
  interviewerQuestion: string;
  tonyRaw: string;
  topicLabel: string;
}): Promise<{ dimension: DimensionResult; usage: JudgeUsage }> {
  const { result, usage } = await judge({
    system: PERSONA_JUDGE_SYSTEM,
    userMessage: [
      `Topic: ${params.topicLabel}`,
      `Interviewer turn:\n"""\n${params.interviewerQuestion}\n"""`,
      `Tony's turn:\n"""\n${params.tonyRaw}\n"""`,
      'Score persona quality now.',
    ].join('\n\n'),
  });
  return { dimension: result, usage };
}
