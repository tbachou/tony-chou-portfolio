import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type { Classification, ClassificationLabel, FeedbackPayload } from './types';
import { UNCLASSIFIED } from './types';

const VALID_LABELS: readonly ClassificationLabel[] = [
  'bug',
  'feature',
  'praise',
  'other',
];

const SYSTEM_PROMPT = `You classify visitor feedback for a portfolio site's owner.
Read the feedback message and respond with strict JSON only, no markdown, no
prose, matching exactly this shape:
{"label": "bug|feature|praise|other", "summary": "<one line, under 20 words>"}
Choose the single best fitting label. The summary should let the owner
triage without opening the full message.`;

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

function isValidLabel(value: unknown): value is Exclude<ClassificationLabel, 'unclassified'> {
  return typeof value === 'string' && (VALID_LABELS as readonly string[]).includes(value);
}

/**
 * Parses a Bedrock Converse text response into a Classification, defensively.
 * Any shape mismatch returns UNCLASSIFIED rather than throwing — callers
 * that want a hard failure signal should inspect the returned label.
 */
export function parseClassification(rawText: string | undefined): Classification {
  if (!rawText) {
    return UNCLASSIFIED;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return UNCLASSIFIED;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return UNCLASSIFIED;
  }
  const candidate = parsed as Record<string, unknown>;
  if (!isValidLabel(candidate.label) || typeof candidate.summary !== 'string') {
    return UNCLASSIFIED;
  }
  return { label: candidate.label, summary: candidate.summary };
}

/**
 * Classifies feedback via Bedrock Converse. Never throws (AC-C2): any
 * failure — network, throttling, malformed response — falls back to
 * UNCLASSIFIED so email delivery downstream never depends on this call
 * succeeding.
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
      }),
    );

    const text = response.output?.message?.content?.find(
      (block) => typeof block.text === 'string',
    )?.text;

    return parseClassification(text);
  } catch {
    return UNCLASSIFIED;
  }
}
