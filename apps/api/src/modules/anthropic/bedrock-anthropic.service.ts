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
  type RunToolConversationParams,
  type RunToolConversationResult,
  totalInputTokens,
  type UpstreamErrorClassification,
} from './ai-provider.interface';
import {
  runToolConversation,
  type ProviderMessage,
} from './tool-conversation';

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
      inputTokens: totalInputTokens(finalMessage.usage),
      outputTokens: finalMessage.usage.output_tokens,
    };
  }

  /**
   * The model driven tool loop (spec 0012 phase three).
   *
   * Shares one implementation with the direct provider rather than mirroring
   * it, unlike the methods above. See `tool-conversation.ts` for why.
   */
  async runToolConversation(
    params: RunToolConversationParams,
  ): Promise<RunToolConversationResult> {
    const client = this.getClient();
    return runToolConversation(
      // The cast is the seam. `tool-conversation.ts` deliberately imports no
      // SDK, because this SDK's types and the other provider's are nominally
      // different (see that file). Both accept this wire shape at runtime.
      (body, options) =>
        client.messages.create(
          body as unknown as Parameters<typeof client.messages.create>[0],
          options,
        ) as unknown as Promise<ProviderMessage>,
      this.model,
      params,
    );
  }

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
        messages: [
          {
            role: 'user',
            // Identical to the direct API path. Bedrock's Anthropic surface
            // takes base64 image bytes, which is why R5 moved this seam off
            // URL sources: this provider used to refuse an image outright, so
            // the vision call could never have run in production.
            content: params.image
              ? [
                  {
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: params.image
                        .mediaType as Anthropic.Base64ImageSource['media_type'],
                      data: params.image.data,
                    },
                  },
                  { type: 'text' as const, text: params.userMessage },
                ]
              : params.userMessage,
          },
        ],
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
      inputTokens: totalInputTokens(message.usage),
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
