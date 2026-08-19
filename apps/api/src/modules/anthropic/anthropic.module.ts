import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import {
  assertBedrockCredentialsConfigured,
  BedrockAnthropicService,
} from './bedrock-anthropic.service';
import {
  AI_PROVIDER,
  resolveConfiguredProvider,
  type AiProvider,
} from './ai-provider.interface';

/**
 * Chooses the `AiProvider` implementation from `AI_PROVIDER` ('anthropic'
 * default, or 'bedrock'). Synchronous and side-effect-free besides the
 * bedrock boot guard: no live AWS call is made here (spec 0005
 * provider-swap child).
 */
export function aiProviderFactory(
  anthropicService: AnthropicService,
  bedrockService: BedrockAnthropicService,
): AiProvider {
  const { provider } = resolveConfiguredProvider();
  if (provider === 'bedrock') {
    assertBedrockCredentialsConfigured();
    return bedrockService;
  }
  return anthropicService;
}

@Module({
  providers: [
    AnthropicService,
    BedrockAnthropicService,
    {
      provide: AI_PROVIDER,
      useFactory: aiProviderFactory,
      inject: [AnthropicService, BedrockAnthropicService],
    },
  ],
  // Beta stays constructor-injected on the concrete AnthropicService
  // (unchanged, direct-path only, until the Guardrails child); the
  // conversation module and any future consumer inject the AI_PROVIDER
  // token instead.
  exports: [AnthropicService, AI_PROVIDER],
})
export class AnthropicModule {}
