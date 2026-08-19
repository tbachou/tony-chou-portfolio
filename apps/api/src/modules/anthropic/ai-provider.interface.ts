/**
 * Provider-agnostic seam for AI calls (spec 0005 provider-swap child).
 * `AnthropicService` (direct API) and `BedrockAnthropicService` (Bedrock)
 * both implement this; consumers depend only on the shapes here, never on
 * either concrete class or SDK.
 */

export type StreamMessageParams = {
  system: string;
  userMessage: string;
  maxTokens: number;
  onToken: (text: string) => void;
  /** Overrides the provider's default model for this call (Beta pins per-agent models). */
  model?: string;
  /** Per-request timeout in ms; SDK default when omitted. */
  timeoutMs?: number;
  /** SDK retry count; SDK default when omitted. Beta passes 0 and retries itself. */
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

/**
 * Provider-agnostic classification of an upstream call failure. `null` means
 * the error did not come from this provider's SDK (a bug in our own code,
 * a validation error we threw ourselves, etc.) — callers fall back to
 * generic `Error` handling for those.
 */
export type UpstreamErrorClassification = {
  /** The SDK error's constructor name (e.g. "APIConnectionError", "InternalServerError"). */
  name: string;
  /** HTTP status, when the SDK error carries one. */
  status?: number;
  /** Whether a caller-driven retry is appropriate (5xx / connection failures, never 4xx). */
  retryable: boolean;
};

export interface AiProvider {
  streamMessage(params: StreamMessageParams): Promise<StreamMessageResult>;
  forceToolCall(params: ForceToolCallParams): Promise<ForceToolCallResult>;
  /** Maps this provider's own SDK error types into the neutral shape above. */
  classifyUpstreamError(error: unknown): UpstreamErrorClassification | null;
}

/** DI token for `AiProvider`; the concrete choice is made by `anthropic.module.ts`'s factory. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

export type ProviderName = 'anthropic' | 'bedrock';

/** Kept alongside AnthropicService's own default so a log line can reflect it without a live call. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';
/** Kept alongside BedrockAnthropicService's own default; see that file's comment for provenance. */
export const DEFAULT_BEDROCK_MODEL_ID =
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

/**
 * The same `AI_PROVIDER` decision `anthropic.module.ts`'s factory makes,
 * exposed for the conversation path's per-call log line — reading env vars
 * directly here (rather than asking the injected `AiProvider` instance,
 * which by design exposes only `streamMessage`/`forceToolCall`) is cheaper
 * than a live call and does not go through SDK types.
 */
export function resolveConfiguredProvider(): {
  provider: ProviderName;
  model: string;
} {
  if (process.env.AI_PROVIDER === 'bedrock') {
    return {
      provider: 'bedrock',
      model: process.env.BEDROCK_MODEL_ID ?? DEFAULT_BEDROCK_MODEL_ID,
    };
  }
  return {
    provider: 'anthropic',
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
  };
}
