/**
 * Eval only Anthropic SDK client for the LLM judges (AC-4, AC-5, AC-7).
 *
 * Deliberately NOT the production provider seam: `AiProvider` has no
 * temperature parameter and is not changed for evals (spec 0011 invariant).
 * Judges run on claude-haiku-4-5 at temperature 0 with the verdict returned
 * through a forced tool call, a 30 second per call timeout, and one retry.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  DimensionResult,
  JudgeVerdict,
} from '../../../src/modules/conversation/eval/eval-types';

export const JUDGE_MODEL = 'claude-haiku-4-5';
const JUDGE_TIMEOUT_MS = 30_000;
const JUDGE_MAX_TOKENS = 300;
const JUDGE_ATTEMPTS = 2; // one retry (AC-7)

const VERDICT_TOOL = {
  name: 'record_verdict',
  description:
    'Record your verdict for this evaluation. Always call this tool exactly once.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['score', 'reason'],
    properties: {
      score: {
        type: 'number',
        enum: [0, 0.5, 1],
        description: 'The rubric score.',
      },
      reason: {
        type: 'string',
        description: 'One line naming the decisive observation.',
      },
    },
  },
};

export type JudgeUsage = { inputTokens: number; outputTokens: number };

export type JudgeOutcome = {
  result: DimensionResult;
  usage: JudgeUsage;
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function judge(params: {
  system: string;
  userMessage: string;
}): Promise<JudgeOutcome> {
  const usage: JudgeUsage = { inputTokens: 0, outputTokens: 0 };
  let lastReason = 'unknown judge failure';

  for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt += 1) {
    try {
      const response = await getClient().messages.create(
        {
          model: JUDGE_MODEL,
          max_tokens: JUDGE_MAX_TOKENS,
          temperature: 0,
          system: params.system,
          messages: [{ role: 'user', content: params.userMessage }],
          tools: [VERDICT_TOOL],
          tool_choice: { type: 'tool', name: VERDICT_TOOL.name },
        },
        { timeout: JUDGE_TIMEOUT_MS, maxRetries: 0 },
      );
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      const verdict = parseVerdict(response);
      if (verdict) {
        return {
          result: {
            status: 'scored',
            score: verdict.score,
            reason: verdict.reason,
          },
          usage,
        };
      }
      lastReason = 'unparseable verdict (no valid record_verdict tool call)';
    } catch (error) {
      // Name + status only, never the raw message (apps/api convention):
      // these reasons land in committed public results files.
      lastReason =
        error instanceof Anthropic.APIError
          ? `${error.name} (status ${error.status ?? 'n/a'})`
          : error instanceof Error
            ? error.name
            : 'unknown';
    }
  }

  return {
    result: { status: 'judge_error', reason: lastReason },
    usage,
  };
}

function parseVerdict(response: Anthropic.Message): JudgeVerdict | null {
  for (const block of response.content) {
    if (block.type !== 'tool_use' || block.name !== VERDICT_TOOL.name) continue;
    const input = block.input as { score?: unknown; reason?: unknown };
    const score = input.score;
    const reason = input.reason;
    if (
      (score === 0 || score === 0.5 || score === 1) &&
      typeof reason === 'string' &&
      reason.length > 0
    ) {
      return { score, reason };
    }
  }
  return null;
}
