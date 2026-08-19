import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_ANTHROPIC_MODEL,
  type AiProvider,
  type ForceToolCallParams,
  type ForceToolCallResult,
  type StreamMessageParams,
  type StreamMessageResult,
  type UpstreamErrorClassification,
} from './ai-provider.interface';

// Re-exported for existing call sites (`import type { StreamMessageParams } from
// './anthropic.service'`); the canonical definitions now live in
// ai-provider.interface.ts so both providers share one shape.
export type {
  StreamMessageParams,
  StreamMessageResult,
  ForceToolCallParams,
  ForceToolCallResult,
};

@Injectable()
export class AnthropicService implements AiProvider {
  private client: Anthropic | null = null;
  private readonly model =
    process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;

  private getClient(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured',
      );
    }
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

  /**
   * Non-streaming call that forces a single tool invocation so the output
   * parses reliably (Beta's screener and drafter agents, spec 0004).
   */
  async forceToolCall(
    params: ForceToolCallParams,
  ): Promise<ForceToolCallResult> {
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

  /** Maps the direct SDK's own error types into the neutral shape. */
  classifyUpstreamError(error: unknown): UpstreamErrorClassification | null {
    if (error instanceof Anthropic.APIConnectionError) {
      return { name: error.name, retryable: true };
    }
    if (error instanceof Anthropic.APIError) {
      return {
        name: error.name,
        status: error.status,
        retryable: typeof error.status === 'number' && error.status >= 500,
      };
    }
    return null;
  }
}
