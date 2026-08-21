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

/**
 * The vision path's request shape (spec 0006 R5, AC-15).
 *
 * These assertions exist because the bug this step fixes was invisible: the
 * seam used to carry a URL, and this provider REFUSED it outright, and the failure only ever
 * showed up as an empty model panel on a game nobody had released yet. The
 * request body is therefore asserted directly rather than trusted.
 *
 * The SDK client is stubbed by assigning the service's own lazily-cached
 * field, so nothing here touches the network.
 */
describe('BedrockAnthropicService.forceToolCall image handling', () => {
  const IMAGE = { data: 'Ynl0ZXM=', mediaType: 'image/webp' };

  function stubbed(create: jest.Mock) {
    const service = new BedrockAnthropicService();
    (service as unknown as { client: unknown }).client = {
      messages: { create },
    };
    return service;
  }

  function okResponse() {
    return jest.fn().mockResolvedValue({
      content: [{ type: 'tool_use', input: { grade: 5 } }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  }

  const baseParams = {
    model: 'us.anthropic.claude-sonnet-4-6',
    system: 'you grade boulders',
    userMessage: 'grade this',
    maxTokens: 100,
    toolName: 'report_grade',
    toolDescription: 'report it',
    inputSchema: { type: 'object' },
    timeoutMs: 1000,
  };

  it('sends the image as a base64 source, never a URL', async () => {
    const create = okResponse();

    await stubbed(create).forceToolCall({ ...baseParams, image: IMAGE });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/webp',
        data: 'Ynl0ZXM=',
      },
    });
    expect(JSON.stringify(content)).not.toContain('"url"');
  });

  it('puts the image before the instruction, as the grader skill expects', async () => {
    const create = okResponse();

    await stubbed(create).forceToolCall({ ...baseParams, image: IMAGE });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[1]).toEqual({ type: 'text', text: 'grade this' });
  });

  it('carries the media type through rather than assuming one', async () => {
    const create = okResponse();

    await stubbed(create).forceToolCall({
      ...baseParams,
      image: { data: 'Ynl0ZXM=', mediaType: 'image/png' },
    });

    expect(
      create.mock.calls[0][0].messages[0].content[0].source.media_type,
    ).toBe('image/png');
  });

  it('sends a plain string body when there is no image', async () => {
    // Every existing caller is text only; the field is additive and must not
    // reshape their request.
    const create = okResponse();

    await stubbed(create).forceToolCall(baseParams);

    expect(create.mock.calls[0][0].messages[0].content).toBe('grade this');
  });
});
