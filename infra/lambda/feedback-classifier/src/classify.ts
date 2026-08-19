import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type { Classification, ClassificationLabel, FeedbackPayload } from './types';
import { UNCLASSIFIED } from './types';

/** The labels the model may report; `unclassified` is our fallback, never its choice. */
type ReportableLabel = Exclude<ClassificationLabel, 'unclassified'>;

const REPORTABLE_LABELS: readonly ReportableLabel[] = [
  'bug',
  'feature',
  'praise',
  'other',
];

const TOOL_NAME = 'report_classification';

// The schema enforces the output shape, so this prompt only has to explain how
// to choose a label — it no longer has to beg for strict JSON.
const SYSTEM_PROMPT = `You classify visitor feedback for a portfolio site's owner.
Choose the single best fitting label:
- bug: something is broken, erroring, or behaving incorrectly
- feature: a request, suggestion, or idea for something new
- praise: positive feedback with nothing to act on
- other: anything else, including spam and unclear messages
Write the summary so the owner can triage without opening the full message.`;

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({});
  }
  return client;
}

function buildUserMessage(payload: FeedbackPayload): string {
  return [
    `source: ${payload.source}`,
    `category: ${payload.category ?? 'none'}`,
    `message: ${payload.message}`,
  ].join('\n');
}

function isReportableLabel(value: unknown): value is ReportableLabel {
  return (
    typeof value === 'string' &&
    (REPORTABLE_LABELS as readonly string[]).includes(value)
  );
}

/**
 * Validates the tool input the model returned. Forced tool use is far more
 * reliable than prompt-and-parse, but it is not a guarantee — a schema
 * violation still degrades to UNCLASSIFIED rather than being trusted.
 */
function toClassification(input: unknown): Classification {
  if (typeof input !== 'object' || input === null) {
    return UNCLASSIFIED;
  }
  const candidate = input as Record<string, unknown>;
  if (!isReportableLabel(candidate.label) || typeof candidate.summary !== 'string') {
    return UNCLASSIFIED;
  }
  return { label: candidate.label, summary: candidate.summary };
}

/**
 * Classifies feedback via Bedrock Converse with a forced tool call, mirroring
 * the Beta screener (apps/api/src/modules/anthropic/anthropic.service.ts
 * `forceToolCall`). The SDK hands back an already-deserialized `input` object,
 * so no model prose is ever string-parsed: a previous prompt-and-parse version
 * shipped every message as `unclassified` in production because the model
 * wrapped its JSON in a markdown fence despite the prompt forbidding it.
 *
 * Never throws (AC-C2): any failure — network, throttling, a missing toolUse
 * block, a schema violation — falls back to UNCLASSIFIED so email delivery
 * downstream never depends on this call succeeding.
 */
export async function classify(payload: FeedbackPayload): Promise<Classification> {
  try {
    const response = await getClient().send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [
          {
            role: 'user',
            content: [{ text: buildUserMessage(payload) }],
          },
        ],
        inferenceConfig: { maxTokens: 200, temperature: 0 },
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: TOOL_NAME,
                description:
                  'Report the classification for this feedback message.',
                inputSchema: {
                  json: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        enum: [...REPORTABLE_LABELS],
                      },
                      summary: {
                        type: 'string',
                        description: 'One line, under 20 words.',
                      },
                    },
                    required: ['label', 'summary'],
                  },
                },
              },
            },
          ],
          toolChoice: { tool: { name: TOOL_NAME } },
        },
      }),
    );

    const input = response.output?.message?.content?.find(
      (block) => block.toolUse,
    )?.toolUse?.input;

    return toClassification(input);
  } catch {
    return UNCLASSIFIED;
  }
}
