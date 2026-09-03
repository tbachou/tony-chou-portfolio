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
  /**
   * An image to put in front of `userMessage` in the same user turn (spec
   * 0006's vision call). Optional and additive: omitting it gives exactly the
   * text-only call every existing caller already makes.
   *
   * BYTES, not a URL. This replaced an `imageUrl` field in R5 for a reason
   * worth keeping written down: Bedrock's Anthropic surface rejects URL image
   * sources outright, so the URL form could never have worked in production —
   * it would have failed on every attempt and degraded into a reveal with the
   * model fields empty. Base64 bytes are the one form BOTH providers accept,
   * so this seam now has a single shape rather than one provider quietly not
   * supporting it.
   *
   * `mediaType` is the stored object's own content type, produced by the
   * upload pipeline rather than claimed by a client.
   */
  image?: { data: string; mediaType: string };
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

/** One tool offered to the model, in the shape both providers' SDKs take. */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Runs one tool call and returns the text handed back to the model as the
 * tool result.
 *
 * The provider knows the protocol; the caller knows the policy. Per turn caps,
 * degrade behaviour and logging all live in the executor, not in here, so the
 * seam stays free of any one feature's rules.
 *
 * An executor must not throw. A thrown error would abort the whole generation,
 * which for retrieval would turn a failed search into a failed turn (0012
 * phase three AC-8 forbids exactly that). Return a string describing the
 * failure instead, and let the model carry on without it.
 */
export type ToolExecutor = (call: {
  name: string;
  input: unknown;
}) => Promise<string>;

export type RunToolConversationParams = {
  system: string;
  userMessage: string;
  maxTokens: number;
  tools: ToolDefinition[];
  executeTool: ToolExecutor;
  /**
   * Hard stop on model turns. Load bearing rather than defensive: a caller
   * whose executor refuses further calls (a per turn cap) still returns a
   * result, so a model that keeps asking would otherwise loop forever at one
   * upstream call per iteration.
   */
  maxIterations: number;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type RunToolConversationResult = StreamMessageResult & {
  /** Tool calls the model actually made, summed across iterations. */
  toolCallCount: number;
  /** True when maxIterations was hit with the model still asking for tools. */
  stoppedOnIterationCap: boolean;
  /**
   * True when the model was cut off by max_tokens PART WAY THROUGH a tool
   * call. Distinct from an answer that merely ran long: here there is no
   * answer at all, and the tool was not run.
   */
  stoppedOnMaxTokens: boolean;
  /**
   * True when the loop ended holding no answer and spent one extra call, with
   * the tools withheld, to get one.
   *
   * Worth its own field rather than being inferred: the recovery costs a whole
   * additional model call, and the turns that need it are the ones where the
   * model stopped without answering. A number that starts climbing means that
   * is happening often, which is a prompt or a cap problem rather than
   * something to keep paying for.
   */
  recoveredWithoutTools: boolean;
};

export interface AiProvider {
  streamMessage(params: StreamMessageParams): Promise<StreamMessageResult>;
  forceToolCall(params: ForceToolCallParams): Promise<ForceToolCallResult>;
  /**
   * A model driven tool loop: the model may call the offered tools, gets
   * each result back, and keeps going until it answers in plain text.
   *
   * Distinct from `forceToolCall`, which compels exactly one call and
   * returns its arguments without ever running anything. This one runs the
   * tool and continues the conversation, which is what a retrieval tool
   * needs (0012 phase three AC-4).
   */
  runToolConversation(
    params: RunToolConversationParams,
  ): Promise<RunToolConversationResult>;
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

/**
 * Every input token the model actually processed, cached or not.
 *
 * Both providers mark the system block `cache_control: ephemeral`, and the
 * API reports a cache hit under `cache_read_input_tokens` rather than
 * `input_tokens`. Reading `input_tokens` alone therefore under-counts by the
 * whole cached prefix once a prompt crosses the 1024-token minimum — measured
 * at 1033 (interviewer) and 1458 (Tony) tokens vanishing per turn pair, which
 * silently weakens the daily spend backstop that consumes this number.
 *
 * This is a token count, not a cost model: cache reads bill at a fraction of
 * a fresh input token, so the daily cap it feeds is conservative by design.
 */
export function totalInputTokens(usage: {
  input_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}
