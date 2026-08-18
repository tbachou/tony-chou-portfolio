import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export type StreamMessageParams = {
  system: string;
  userMessage: string;
  maxTokens: number;
  onToken: (text: string) => void;
  /** Overrides ANTHROPIC_MODEL for this call (Beta pins per-agent models). */
  model?: string;
  /** Per-request timeout in ms; SDK default when omitted. */
  timeoutMs?: number;
  /** SDK retry count; SDK default (2) when omitted. Beta passes 0 and retries itself. */
  maxRetries?: number;
};

export type StreamMessageResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export type ForceToolCallParams = {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  timeoutMs: number;
  maxRetries?: number;
};

export type ForceToolCallResult = {
  /** The tool_use block's input, validated by the caller against its schema. */
  input: unknown;
  inputTokens: number;
  outputTokens: number;
};

@Injectable()
export class AnthropicService {
  private client: Anthropic | null = null;
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

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
}
