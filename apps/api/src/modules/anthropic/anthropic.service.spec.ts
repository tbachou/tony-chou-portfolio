import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';
import { totalInputTokens } from './ai-provider.interface';

/**
 * The real APIError/APIConnectionError constructors demand a fetch Headers
 * instance, so build prototypically instead — `instanceof` still holds,
 * which is exactly what classifyUpstreamError type-checks against (same
 * technique beta.service.spec.ts used before the AC-P4 migration).
 */
function fakeSdkApiError(status: number): InstanceType<typeof Anthropic.APIError> {
  const error = Object.create(Anthropic.APIError.prototype) as {
    status: number;
    name: string;
  };
  error.status = status;
  error.name = 'APIError';
  return error as unknown as InstanceType<typeof Anthropic.APIError>;
}

function fakeSdkConnectionError(): InstanceType<
  typeof Anthropic.APIConnectionError
> {
  const error = Object.create(Anthropic.APIConnectionError.prototype) as {
    name: string;
  };
  error.name = 'APIConnectionError';
  return error as unknown as InstanceType<typeof Anthropic.APIConnectionError>;
}

describe('AnthropicService.classifyUpstreamError', () => {
  const service = new AnthropicService();

  it('classifies a 5xx APIError as retryable', () => {
    expect(service.classifyUpstreamError(fakeSdkApiError(500))).toEqual({
      name: 'APIError',
      status: 500,
      retryable: true,
    });
  });

  it('classifies a 4xx APIError as not retryable', () => {
    expect(service.classifyUpstreamError(fakeSdkApiError(400))).toEqual({
      name: 'APIError',
      status: 400,
      retryable: false,
    });
  });

  it('classifies an APIConnectionError as retryable with no status', () => {
    expect(service.classifyUpstreamError(fakeSdkConnectionError())).toEqual({
      name: 'APIConnectionError',
      retryable: true,
    });
  });

  it('returns null for a plain Error (not an upstream SDK error)', () => {
    expect(service.classifyUpstreamError(new Error('boom'))).toBeNull();
  });

  it('returns null for a non-Error thrown value', () => {
    expect(service.classifyUpstreamError('boom')).toBeNull();
  });
});

/**
 * The vision path's request shape (spec 0006 R5, AC-15).
 *
 * These assertions exist because the bug this step fixes was invisible: the
 * seam used to carry a URL, which Bedrock rejects outright, and the failure only ever
 * showed up as an empty model panel on a game nobody had released yet. The
 * request body is therefore asserted directly rather than trusted.
 *
 * The SDK client is stubbed by assigning the service's own lazily-cached
 * field, so nothing here touches the network.
 */
describe('AnthropicService.forceToolCall image handling', () => {
  const IMAGE = { data: 'Ynl0ZXM=', mediaType: 'image/webp' };

  // getClient() checks the key before it returns the cached client, so
  // stubbing the client alone is not enough to keep this offline.
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  function stubbed(create: jest.Mock) {
    const service = new AnthropicService();
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
    model: 'claude-sonnet-5',
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

describe('totalInputTokens', () => {
  it('counts a cache hit, which the API reports outside input_tokens', () => {
    // Both providers mark the system block cache_control: ephemeral. Once a
    // prompt crosses the 1024-token minimum the whole prefix is billed as a
    // cache read, and counting input_tokens alone loses it — measured at 1033
    // (interviewer) and 1458 (Tony) tokens per turn pair, straight out of the
    // daily spend backstop.
    expect(
      totalInputTokens({ input_tokens: 9, cache_read_input_tokens: 1033 }),
    ).toBe(1042);
  });

  it('counts the write that creates the cache entry', () => {
    expect(
      totalInputTokens({ input_tokens: 9, cache_creation_input_tokens: 1033 }),
    ).toBe(1042);
  });

  it('is unchanged for an uncached call, which reports neither field', () => {
    expect(totalInputTokens({ input_tokens: 250 })).toBe(250);
    expect(
      totalInputTokens({
        input_tokens: 250,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      }),
    ).toBe(250);
  });
});
