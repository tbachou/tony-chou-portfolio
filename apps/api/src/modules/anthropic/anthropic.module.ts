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
  // Two exports on purpose, and the split is permanent for now. Beta stays
  // constructor-injected on the concrete AnthropicService (direct path only);
  // the conversation module and the Grade Guesser grader inject the
  // AI_PROVIDER token, so AI_PROVIDER=bedrock moves them and not Beta.
  //
  // The gate is model access, not the Guardrails child this comment used to
  // name: the account cannot invoke Claude Sonnet 5 on Bedrock and Beta's
  // drafter is pinned to it, so collapsing these two exports into one would
  // downgrade the model that writes rehab plans.
  exports: [AnthropicService, AI_PROVIDER],
})
export class AnthropicModule {}
