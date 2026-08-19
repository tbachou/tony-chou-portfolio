import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import {
  assertBedrockCredentialsConfigured,
  BedrockAnthropicService,
} from './bedrock-anthropic.service';

/** Same prototypal-construction technique as anthropic.service.spec.ts, against the Bedrock SDK's own error classes. */
function fakeBedrockApiError(
  status: number,
): InstanceType<typeof AnthropicBedrock.APIError> {
  const error = Object.create(AnthropicBedrock.APIError.prototype) as {
    status: number;
    name: string;
  };
  error.status = status;
  error.name = 'APIError';
  return error as unknown as InstanceType<typeof AnthropicBedrock.APIError>;
}

function fakeBedrockConnectionError(): InstanceType<
  typeof AnthropicBedrock.APIConnectionError
> {
  const error = Object.create(
    AnthropicBedrock.APIConnectionError.prototype,
  ) as { name: string };
  error.name = 'APIConnectionError';
  return error as unknown as InstanceType<
    typeof AnthropicBedrock.APIConnectionError
  >;
}

describe('BedrockAnthropicService.classifyUpstreamError', () => {
  const service = new BedrockAnthropicService();

  it('classifies a 5xx APIError as retryable', () => {
    expect(service.classifyUpstreamError(fakeBedrockApiError(500))).toEqual({
      name: 'APIError',
      status: 500,
      retryable: true,
    });
  });

  it('classifies a 4xx APIError as not retryable', () => {
    expect(service.classifyUpstreamError(fakeBedrockApiError(429))).toEqual({
      name: 'APIError',
      status: 429,
      retryable: false,
    });
  });

  it('classifies an APIConnectionError as retryable with no status', () => {
    expect(
      service.classifyUpstreamError(fakeBedrockConnectionError()),
    ).toEqual({
      name: 'APIConnectionError',
      retryable: true,
    });
  });

  it('returns null for a plain Error (not an upstream SDK error)', () => {
    expect(service.classifyUpstreamError(new Error('boom'))).toBeNull();
  });
});

describe('assertBedrockCredentialsConfigured (boot guard)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes silently when all three AWS vars are present and non-empty', () => {
    process.env.AWS_REGION = 'us-east-2';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    expect(() => assertBedrockCredentialsConfigured()).not.toThrow();
  });

  it('throws naming every missing variable', () => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(() => assertBedrockCredentialsConfigured()).toThrow(
      'AI_PROVIDER=bedrock requires AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY to be set',
    );
  });

  it('treats a whitespace-only value as missing', () => {
    process.env.AWS_REGION = '  ';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    expect(() => assertBedrockCredentialsConfigured()).toThrow(/AWS_REGION/);
  });
});
