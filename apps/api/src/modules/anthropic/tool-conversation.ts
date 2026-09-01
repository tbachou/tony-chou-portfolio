import {
  totalInputTokens,
  type RunToolConversationParams,
  type RunToolConversationResult,
} from './ai-provider.interface';

/**
 * The tool loop both providers run (spec 0012 phase three, AC-4).
 *
 * This lives in one place rather than being mirrored into each service, which
 * is a deliberate departure from how `streamMessage` and `forceToolCall` are
 * written. Those are a dozen lines each, and a copy that drifts is obvious.
 * This is a protocol loop with real invariants — every `tool_use` block must
 * get exactly one `tool_result` with a matching id, in the same user turn, or
 * the next request is rejected — and a fix applied to one provider and not the
 * other would be silent until production hit the untouched path.
 *
 * It imports NO SDK, which is not tidiness. `@anthropic-ai/bedrock-sdk`
 * carries its own nested copy of `@anthropic-ai/sdk` at a different version
 * (0.118.0 nested against 0.115.0 at the root, on 2026-09-01), and the newer
 * one has content block types the older does not. TypeScript therefore treats
 * the two `MessageParam` types as incompatible even though the wire shapes are
 * the same, so a loop typed against either SDK cannot serve both. The types
 * below describe only the handful of fields this loop actually reads, which is
 * what the other methods get for free by building their request literals
 * inline at the call site.
 */

type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
};

type TextBlock = { type: 'text'; text: string };

type ContentBlock = ToolUseBlock | TextBlock | { type: string };

/** Only the fields this loop reads. Both SDKs' messages satisfy it. */
export type ProviderMessage = {
  content: ContentBlock[];
  stop_reason?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

export type ToolLoopRequest = {
  model: string;
  max_tokens: number;
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[];
  messages: { role: 'user' | 'assistant'; content: unknown }[];
  tools: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }[];
};

/**
 * The one thing that differs between providers: whose `messages.create` to
 * call. Each service supplies a small adapter, because that is the single
 * point where the two SDKs' nominally different types have to meet.
 */
export type CreateMessage = (
  body: ToolLoopRequest,
  options: { timeout?: number; maxRetries?: number },
) => Promise<ProviderMessage>;

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

function textOf(message: ProviderMessage): string {
  return message.content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Non streaming on purpose. The only caller buffers the whole response before
 * anything reaches the client anyway (the ownership guard has to see it
 * complete), and a tool loop has no single stream to hand out: the model
 * stops and restarts once per tool call, so partial text from an iteration
 * that is about to be followed by another one is not the answer.
 */
export async function runToolConversation(
  create: CreateMessage,
  defaultModel: string,
  params: RunToolConversationParams,
): Promise<RunToolConversationResult> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: params.userMessage },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;

  for (let iteration = 0; iteration < params.maxIterations; iteration += 1) {
    const message = await create(
      {
        model: params.model ?? defaultModel,
        max_tokens: params.maxTokens,
        system: [
          {
            type: 'text',
            text: params.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      },
      {
        ...(params.timeoutMs !== undefined && { timeout: params.timeoutMs }),
        ...(params.maxRetries !== undefined && {
          maxRetries: params.maxRetries,
        }),
      },
    );

    // Summed across iterations, not overwritten. Each iteration is a separate
    // billed call, and the caller feeds this into a daily spend backstop, so
    // keeping only the last would under count a searching turn by every call
    // but the final one.
    inputTokens += totalInputTokens(message.usage);
    outputTokens += message.usage.output_tokens;

    const toolUses = message.content.filter(isToolUse);

    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return {
        text: textOf(message),
        inputTokens,
        outputTokens,
        toolCallCount,
        stoppedOnIterationCap: false,
      };
    }

    // The assistant turn goes back verbatim, tool_use blocks included. Sending
    // only the text would leave the tool results below referring to ids the
    // model never sees, which the API rejects.
    messages.push({ role: 'assistant', content: message.content });

    // Every tool_use gets a tool_result, in one user turn. A missing one is a
    // 400 rather than a partial answer, so this maps rather than filters.
    const results: {
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }[] = [];
    for (const toolUse of toolUses) {
      toolCallCount += 1;
      const content = await params.executeTool({
        name: toolUse.name,
        input: toolUse.input,
      });
      results.push({
        type: 'tool_result' as const,
        tool_use_id: toolUse.id,
        content,
      });
    }
    messages.push({ role: 'user', content: results });
  }

  // The cap was hit with the model still asking for tools. Returning empty
  // beats throwing: the caller's guard and fallback already handle a weak
  // answer, whereas a throw would fail the whole turn over a model that was
  // merely being persistent.
  return {
    text: '',
    inputTokens,
    outputTokens,
    toolCallCount,
    stoppedOnIterationCap: true,
  };
}
