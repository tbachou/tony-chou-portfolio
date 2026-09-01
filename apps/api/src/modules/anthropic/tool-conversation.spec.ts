import {
  runToolConversation,
  type CreateMessage,
  type ProviderMessage,
  type ToolLoopRequest,
} from './tool-conversation';
import type { ToolDefinition } from './ai-provider.interface';

const TOOL: ToolDefinition = {
  name: 'searchKnowledge',
  description: 'search',
  inputSchema: { type: 'object' },
};

const usage = (input = 10, output = 5) => ({
  input_tokens: input,
  output_tokens: output,
});

function textMessage(text: string): ProviderMessage {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: usage(),
  };
}

function toolMessage(
  calls: { id: string; name?: string; input?: unknown }[],
): ProviderMessage {
  return {
    content: calls.map((call) => ({
      type: 'tool_use' as const,
      id: call.id,
      name: call.name ?? TOOL.name,
      input: call.input ?? { query: 'q' },
    })),
    stop_reason: 'tool_use',
    usage: usage(),
  };
}

/** Records every request body so the protocol can be asserted on. */
function recordingCreate(responses: ProviderMessage[]): {
  create: CreateMessage;
  bodies: ToolLoopRequest[];
} {
  const bodies: ToolLoopRequest[] = [];
  let index = 0;
  const create: CreateMessage = (body) => {
    bodies.push(JSON.parse(JSON.stringify(body)) as ToolLoopRequest);
    const next = responses[index];
    index += 1;
    if (!next) throw new Error(`no stubbed response for call ${index}`);
    return Promise.resolve(next);
  };
  return { create, bodies };
}

const base = {
  system: 'sys',
  userMessage: 'hello',
  maxTokens: 600,
  tools: [TOOL],
  maxIterations: 4,
  executeTool: async () => 'result',
};

describe('runToolConversation', () => {
  it('returns the text and never calls a tool when the model just answers', async () => {
    const { create, bodies } = recordingCreate([textMessage('an answer')]);
    const executeTool = jest.fn();

    const result = await runToolConversation(create, 'model-x', {
      ...base,
      executeTool,
    });

    expect(result.text).toBe('an answer');
    expect(result.toolCallCount).toBe(0);
    expect(result.stoppedOnIterationCap).toBe(false);
    expect(executeTool).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe('model-x');
  });

  it('runs the tool, sends the result back, and returns the follow-up answer', async () => {
    const { create, bodies } = recordingCreate([
      toolMessage([{ id: 'tu_1', input: { query: 'how does Tony spec' } }]),
      textMessage('grounded answer'),
    ]);
    const executeTool = jest.fn().mockResolvedValue('a chunk');

    const result = await runToolConversation(create, 'model-x', {
      ...base,
      executeTool,
    });

    expect(result.text).toBe('grounded answer');
    expect(result.toolCallCount).toBe(1);
    expect(executeTool).toHaveBeenCalledWith({
      name: 'searchKnowledge',
      input: { query: 'how does Tony spec' },
    });

    // The second request carries the assistant turn verbatim and then the
    // tool_result. Sending only the text would leave the result referring to
    // an id the model never saw, which the API rejects.
    const second = bodies[1];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].role).toBe('assistant');
    expect(second.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'a chunk' },
      ],
    });
  });

  it('answers every tool_use in one assistant turn, with matching ids', async () => {
    const { create, bodies } = recordingCreate([
      toolMessage([{ id: 'tu_1' }, { id: 'tu_2' }]),
      textMessage('done'),
    ]);
    const executeTool = jest
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    const result = await runToolConversation(create, 'model-x', {
      ...base,
      executeTool,
    });

    expect(result.toolCallCount).toBe(2);
    // A missing tool_result is a 400 from the API rather than a partial
    // answer, so both must be present and both ids must match.
    expect(bodies[1].messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'first' },
      { type: 'tool_result', tool_use_id: 'tu_2', content: 'second' },
    ]);
  });

  it('sums tokens across iterations rather than keeping only the last', async () => {
    const { create } = recordingCreate([
      { ...toolMessage([{ id: 'tu_1' }]), usage: usage(100, 20) },
      { ...textMessage('answer'), usage: usage(300, 40) },
    ]);

    const result = await runToolConversation(create, 'model-x', base);

    // Each iteration is a separately billed call and this number feeds a
    // daily spend backstop; keeping only the last would under count.
    expect(result.inputTokens).toBe(400);
    expect(result.outputTokens).toBe(60);
  });

  it('counts cache reads as input tokens', async () => {
    const { create } = recordingCreate([
      {
        ...textMessage('answer'),
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 90,
        },
      },
    ]);

    const result = await runToolConversation(create, 'model-x', base);

    expect(result.inputTokens).toBe(100);
  });

  it('stops at maxIterations when the model keeps asking for tools', async () => {
    const { create, bodies } = recordingCreate([
      toolMessage([{ id: 'tu_1' }]),
      toolMessage([{ id: 'tu_2' }]),
      toolMessage([{ id: 'tu_3' }]),
    ]);

    const result = await runToolConversation(create, 'model-x', {
      ...base,
      maxIterations: 3,
    });

    // Without this cap a model whose executor keeps refusing (a per turn
    // search cap) would spin forever at one upstream call per iteration.
    expect(bodies).toHaveLength(3);
    expect(result.stoppedOnIterationCap).toBe(true);
    expect(result.text).toBe('');
    expect(result.toolCallCount).toBe(3);
  });

  it('treats a tool_use stop_reason with no tool_use block as a plain answer', async () => {
    const { create } = recordingCreate([
      { content: [{ type: 'text', text: 'odd' }], stop_reason: 'tool_use', usage: usage() },
    ]);

    // Defensive rather than expected: looping here would send an assistant
    // turn with no tool_result and get a 400 back.
    const result = await runToolConversation(create, 'model-x', base);

    expect(result.text).toBe('odd');
    expect(result.stoppedOnIterationCap).toBe(false);
  });

  it('joins multiple text blocks and ignores block types it does not know', async () => {
    const { create } = recordingCreate([
      {
        content: [
          { type: 'text', text: 'one ' },
          { type: 'thinking' },
          { type: 'text', text: 'two' },
        ],
        stop_reason: 'end_turn',
        usage: usage(),
      },
    ]);

    const result = await runToolConversation(create, 'model-x', base);

    expect(result.text).toBe('one two');
  });

  it('marks the system block cacheable and passes the tools through', async () => {
    const { create, bodies } = recordingCreate([textMessage('a')]);

    await runToolConversation(create, 'model-x', base);

    expect(bodies[0].system).toEqual([
      { type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } },
    ]);
    expect(bodies[0].tools).toEqual([
      {
        name: 'searchKnowledge',
        description: 'search',
        input_schema: { type: 'object' },
      },
    ]);
  });
});
