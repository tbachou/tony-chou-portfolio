import { aiProviderFactory } from './anthropic.module';
import type { AnthropicService } from './anthropic.service';
import type { BedrockAnthropicService } from './bedrock-anthropic.service';

/**
 * Spec 0005 provider-swap child: the factory keyed on AI_PROVIDER is the
 * single choke point for the implementation choice (AC-P3), and its bedrock
 * boot guard must fail synchronously without any live AWS call (Config
 * guard scenario).
 */
describe('aiProviderFactory (AI_PROVIDER selection)', () => {
  const originalEnv = { ...process.env };
  const anthropicService = { tag: 'anthropic' } as unknown as AnthropicService;
  const bedrockService = { tag: 'bedrock' } as unknown as BedrockAnthropicService;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to AnthropicService when AI_PROVIDER is unset', () => {
    delete process.env.AI_PROVIDER;
    expect(aiProviderFactory(anthropicService, bedrockService)).toBe(
      anthropicService,
    );
  });

  it('chooses AnthropicService when AI_PROVIDER=anthropic', () => {
    process.env.AI_PROVIDER = 'anthropic';
    expect(aiProviderFactory(anthropicService, bedrockService)).toBe(
      anthropicService,
    );
  });

  it('chooses BedrockAnthropicService when AI_PROVIDER=bedrock and creds are present', () => {
    process.env.AI_PROVIDER = 'bedrock';
    process.env.AWS_REGION = 'us-east-2';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    expect(aiProviderFactory(anthropicService, bedrockService)).toBe(
      bedrockService,
    );
  });

  it.each([
    ['AWS_REGION'],
    ['AWS_ACCESS_KEY_ID'],
    ['AWS_SECRET_ACCESS_KEY'],
  ] as const)(
    'throws synchronously at boot when %s is missing under AI_PROVIDER=bedrock',
    (missingKey) => {
      process.env.AI_PROVIDER = 'bedrock';
      process.env.AWS_REGION = 'us-east-2';
      process.env.AWS_ACCESS_KEY_ID = 'key';
      process.env.AWS_SECRET_ACCESS_KEY = 'secret';
      delete process.env[missingKey];

      expect(() =>
        aiProviderFactory(anthropicService, bedrockService),
      ).toThrow(/AI_PROVIDER=bedrock requires/);
    },
  );

  it('throws when every AWS credential is missing under AI_PROVIDER=bedrock', () => {
    process.env.AI_PROVIDER = 'bedrock';
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    expect(() =>
      aiProviderFactory(anthropicService, bedrockService),
    ).toThrow('AI_PROVIDER=bedrock requires AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY to be set');
  });

  it('treats a blank credential the same as a missing one', () => {
    process.env.AI_PROVIDER = 'bedrock';
    process.env.AWS_REGION = '   ';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';

    expect(() =>
      aiProviderFactory(anthropicService, bedrockService),
    ).toThrow(/AWS_REGION/);
  });
});
