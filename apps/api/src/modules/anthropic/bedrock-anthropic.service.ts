import { Injectable } from '@nestjs/common';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_BEDROCK_MODEL_ID,
  type AiProvider,
  type ForceToolCallParams,
  type ForceToolCallResult,
  type StreamMessageParams,
  type StreamMessageResult,
  type UpstreamErrorClassification,
} from './ai-provider.interface';

/**
 * Bedrock implementation of `AiProvider` (spec 0005 provider-swap child):
 * same Claude models, reached through `@anthropic-ai/bedrock-sdk` instead of
 * the direct API. `messages.stream`/`messages.create` are shape-identical to
 * the direct SDK, so the method bodies mirror `AnthropicService`'s.
 */
@Injectable()
export class BedrockAnthropicService implements AiProvider {
  private client: AnthropicBedrock | null = null;
  private readonly model =
    process.env.BEDROCK_MODEL_ID ?? DEFAULT_BEDROCK_MODEL_ID;

  private getClient(): AnthropicBedrock {
    this.client ??= new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION,
    });
    return this.client;
  }

  async streamMessage(
    params: StreamMessageParams,
  ): Promise<StreamMessageResult> {
    const stream = this.getClient().messages.stream(
      {
        model: params.model ?? this.model,
        max_tokens: params.maxTokens,
        system: [
          {
            type: 'text',
            text: params.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: params.userMessage }],
      },
      {
        ...(params.timeoutMs !== undefined && { timeout: params.timeoutMs }),
        ...(params.maxRetries !== undefined && {
          maxRetries: params.maxRetries,
        }),
      },
    );

    stream.on('text', (textDelta) => params.onToken(textDelta));

    const finalMessage = await stream.finalMessage();

    const text = finalMessage.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };
  }

  async forceToolCall(
    params: ForceToolCallParams,
  ): Promise<ForceToolCallResult> {
    // Bedrock's Anthropic surface takes image bytes, not URL sources. Rather
    // than silently dropping the image and returning a confident answer about
    // a photo it never saw, this fails loudly. The one caller that passes an
    // image (spec 0006's Grade Guesser) treats a throw as a failed vision call
    // and degrades gracefully, so this costs a null analysis, not an error page.
    if (params.imageUrl) {
      throw new Error(
        'BedrockAnthropicService does not support URL image sources; set AI_PROVIDER=anthropic for vision calls',
      );
    }

    const message = await this.getClient().messages.create(
      {
        model: params.model,
        max_tokens: params.maxTokens,
        system: [
          {
            type: 'text',
            text: params.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: params.userMessage }],
        tools: [
          {
            name: params.toolName,
            description: params.toolDescription,
            input_schema:
              params.inputSchema as Anthropic.Messages.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: params.toolName },
      },
      {
        timeout: params.timeoutMs,
        ...(params.maxRetries !== undefined && {
          maxRetries: params.maxRetries,
        }),
      },
    );

    const block = message.content.find((b) => b.type === 'tool_use');
    if (!block) {
      throw new Error(
        `Model did not return the forced ${params.toolName} tool call`,
      );
    }

    return {
      input: block.input,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }

  /** Maps the Bedrock SDK's own error types into the neutral shape. */
  classifyUpstreamError(error: unknown): UpstreamErrorClassification | null {
    if (error instanceof AnthropicBedrock.APIConnectionError) {
      return { name: error.name, retryable: true };
    }
    if (error instanceof AnthropicBedrock.APIError) {
      return {
        name: error.name,
        status: error.status,
        retryable: typeof error.status === 'number' && error.status >= 500,
      };
    }
    return null;
  }
}

/**
 * Boot guard (spec 0005): with AI_PROVIDER=bedrock, fail fast and synchronously
 * if the AWS credentials this SDK needs are not present. No live AWS call is
 * made here — Render has no instance-role credential source, so env vars are
 * the entire credential story.
 */
export function assertBedrockCredentialsConfigured(): void {
  const missing = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].filter(
    (key) => !process.env[key]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `AI_PROVIDER=bedrock requires ${missing.join(', ')} to be set`,
    );
  }
}
