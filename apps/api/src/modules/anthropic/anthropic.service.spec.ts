import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';

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
