import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export type StreamMessageParams = {
  system: string;
  userMessage: string;
  maxTokens: number;
  onToken: (text: string) => void;
};

export type StreamMessageResult = {
  text: string;
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
    const stream = this.getClient().messages.stream({
      model: this.model,
      max_tokens: params.maxTokens,
      system: [
        {
          type: 'text',
          text: params.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: params.userMessage }],
    });

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
}
