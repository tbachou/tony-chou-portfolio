import {
  runToolConversation,
  usageFromError,
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

  it('reports a truncated tool call instead of silently answering nothing', async () => {
    // Reachable under maxTokens: the model starts a tool_use block and is cut
    // off. stop_reason is 'max_tokens', not 'tool_use', so the old code took
    // the "answered in plain text" branch, textOf() found no text blocks and
    // returned '', the visitor got the guard fallback, and the only log line
    // blamed the ownership guard. No retrieval line at all.
    const { create } = recordingCreate([
      {
        content: [
          { type: 'tool_use', id: 'tu_1', name: TOOL.name, input: { query: 'x' } },
        ],
        stop_reason: 'max_tokens',
        usage: usage(),
      },
    ]);
    const executeTool = jest.fn();

    const result = await runToolConversation(create, 'model-x', {
      ...base,
      executeTool,
    });

    // Not executed: a truncated tool_use block may carry incomplete input, so
    // running it is worse than reporting it.
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.stoppedOnMaxTokens).toBe(true);
    expect(result.text).toBe('');
  });

  it('does not flag a normal answer that happens to run out of tokens', async () => {
    const { create } = recordingCreate([
      {
        content: [{ type: 'text', text: 'a long answer cut off' }],
        stop_reason: 'max_tokens',
        usage: usage(),
      },
    ]);

    const result = await runToolConversation(create, 'model-x', base);

    // Text truncation is the pre-existing, accepted behaviour: the answer is
    // real, just short. Only a truncated TOOL CALL is the new outcome.
    expect(result.stoppedOnMaxTokens).toBe(false);
    expect(result.text).toBe('a long answer cut off');
  });

  it('carries the tokens already billed when a later iteration throws', async () => {
    // Pre-change this lost at most one call's tokens. With maxIterations 4 it
    // loses up to three, and generateTurnPair's catch then never increments
    // the daily counters, so a persistently failing third iteration burns
    // money while DAILY_TOKEN_CAP never moves.
    let call = 0;
    const create: CreateMessage = () => {
      call += 1;
      if (call <= 2) {
        return Promise.resolve({
          ...toolMessage([{ id: `tu_${call}` }]),
          usage: usage(1200, 90),
        });
      }
      return Promise.reject(new Error('529 overloaded'));
    };

    const thrown = await runToolConversation(create, 'model-x', base).catch(
      (error: unknown) => error,
    );

    expect((thrown as Error).message).toContain('529 overloaded');
    // Two iterations at 1200 in + 90 out were really billed.
    expect(usageFromError(thrown)).toEqual({
      inputTokens: 2400,
      outputTokens: 180,
    });
  });

  it('reports no usage for an error that never reached the provider', async () => {
    const create: CreateMessage = () => Promise.reject(new Error('bad request'));

    const thrown = await runToolConversation(create, 'model-x', base).catch(
      (error: unknown) => error,
    );

    expect(usageFromError(thrown)).toEqual({ inputTokens: 0, outputTokens: 0 });
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
