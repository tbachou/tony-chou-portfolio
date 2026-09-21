import type { Mock } from 'vitest';
import { Logger } from '@nestjs/common';
import type { AnthropicService } from '../anthropic/anthropic.service.js';
import { ConversationService } from './conversation.service.js';
import { CREDENTIAL_GUARD_FALLBACK } from './credential-check.js';
import {
  ConversationRole,
  StoryOwnership,
} from '../../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AiProvider } from '../anthropic/ai-provider.interface.js';
import { TURN_ERROR_MESSAGE } from './conversation.constants.js';
import { runToolConversation } from '../anthropic/tool-conversation.js';
import type { DailyUsageService } from '../daily-usage/daily-usage.service.js';
import type { HistoryTurn, TopicWithStories } from './conversation.service.js';

// PrismaService is only referenced through constructor injection; the real
// module drags in the generated Prisma client, which no test may touch.
vi.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

// Agent prompts live as markdown skill files on disk; tests never read the
// filesystem (the beta.service.spec convention).
vi.mock('./skill-loader', () => ({
  loadConversationSkill: vi.fn(() => 'stub skill prompt'),
}));

// conversation.service.ts uses `Prisma.PrismaClientKnownRequestError` at
// runtime (an `instanceof` check, not just a type), which otherwise pulls in
// generated/prisma/client.ts's full module graph — unrelated to this spec
// and not something these tests exercise (that branch is prepareTurn's
// unique-constraint race, not generateTurnPair).
vi.mock('../../generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: class {} },
}));

const story = {
  id: 'story-1',
  title: 'Portfolio rebuild',
  engagement: 'Personal project',
  summary: 'Rebuilt the portfolio site end to end.',
  ownership: StoryOwnership.SOLO,
  requiredFraming: null,
} as TopicWithStories['stories'][number];

const otherStory = {
  id: 'story-2',
  title: 'Realtime collaboration',
  engagement: 'Product Forge',
  summary: 'Built the collaborative editing layer.',
  ownership: StoryOwnership.CONTRIBUTED,
  requiredFraming: 'contributed to',
} as TopicWithStories['stories'][number];

const topic: TopicWithStories = {
  id: 'topic-1',
  slug: 'engineering',
  label: 'Engineering',
  description: 'How Tony builds things.',
  stories: [story, otherStory],
} as unknown as TopicWithStories;

function makeHarness() {
  const prisma = {
    $transaction: vi.fn().mockResolvedValue([]),
    conversationTurn: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn((args: unknown) => ({ __op: 'update', args })),
      create: vi.fn((args: unknown) => ({ __op: 'create', args })),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
  const anthropic = {
    // Declared on AiProvider since the seam existed; the service now reads it
    // to tell a real upstream failure from a visitor disconnect. Null is the
    // "not an upstream error" answer, which is right for the thrown Errors
    // these tests use.
    classifyUpstreamError: vi.fn().mockReturnValue(null),
    streamMessage: vi.fn(),
    forceToolCall: vi.fn(),
    // The Tony generation runs through here now (0012 phase three AC-4); only
    // the interviewer still uses streamMessage. Defaulted so the many tests
    // that only care about the interviewer do not each have to stub it.
    runToolConversation: vi.fn().mockResolvedValue({
      text: 'a',
      inputTokens: 1,
      outputTokens: 1,
      toolCallCount: 0,
      stoppedOnIterationCap: false,
    }),
  };
  const dailyUsage = {
    assertCapNotExceeded: vi.fn().mockResolvedValue(undefined),
    incrementOp: vi.fn((count: number, tokens: number) => ({
      __op: 'incrementOp',
      count,
      tokens,
    })),
  };
  // Spec 0013's second layer. Separate from `anthropic` on purpose: the check
  // is pinned to the concrete direct service (AC-9), so a test that moved the
  // provider token must not silently move the safety check with it. Defaulted
  // to a passing verdict so the many tests that never trip the prefilter do
  // not each have to stub it.
  const credentialCheck = {
    // Configured by default: the startup guard is exercised explicitly below,
    // and every other test would otherwise have to opt out of it.
    isConfigured: vi.fn().mockReturnValue(true),
    classifyUpstreamError: vi.fn().mockReturnValue(null),
    forceToolCall: vi.fn().mockResolvedValue({
      input: { category: 'no_credential_mentioned', reasoning: 'n/a' },
      inputTokens: 5,
      outputTokens: 2,
    }),
  };
  const service = new ConversationService(
    prisma as unknown as PrismaService,
    anthropic as unknown as AiProvider,
    dailyUsage as unknown as DailyUsageService,
    credentialCheck as unknown as AnthropicService,
  );
  const events: [string, unknown][] = [];
  const emit = (event: string, data: unknown) => {
    events.push([event, data]);
  };
  return {
    credentialCheck,
    prisma,
    anthropic,
    dailyUsage,
    service,
    events,
    emit,
  };
}

const prepared = {
  conversationId: 'conv-1',
  turnIndex: 0,
  isFinal: false,
  story,
  interviewerTurnId: 'turn-1',
};

describe('ConversationService.generateTurnPair', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('happy path: emits the full event sequence and commits both turns via one transaction', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'What drove the rebuild?',
      inputTokens: 20,
      outputTokens: 10,
    });
    h.anthropic.runToolConversation.mockResolvedValueOnce({
      text: 'Faster.',
      inputTokens: 30,
      outputTokens: 40,
      toolCallCount: 0,
      stoppedOnIterationCap: false,
    });

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    // The interviewer's onToken never fires here (the mock resolves
    // directly rather than streaming deltas); only Tony's guard-approved
    // text is explicitly chunked and emitted by the service itself.
    expect(h.events.map(([event]) => event)).toEqual([
      'turn_start',
      'turn_start',
      'token',
      'turn_end',
    ]);
    expect(h.events[h.events.length - 1]).toEqual([
      'turn_end',
      { conversationId: 'conv-1', turnIndex: 0, isFinal: false },
    ]);
    // One interviewer call on streamMessage, one Tony call on the tool loop.
    expect(h.anthropic.streamMessage).toHaveBeenCalledTimes(1);
    expect(h.anthropic.runToolConversation).toHaveBeenCalledTimes(1);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.conversationTurn.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'turn-1' } }),
    );
    expect(h.prisma.conversationTurn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: ConversationRole.TONY }),
      }),
    );
    expect(h.dailyUsage.incrementOp).toHaveBeenCalledWith(2, 100);
    expect(h.prisma.conversationTurn.delete).not.toHaveBeenCalled();
  });

  describe('retrieval is offered only when it is configured', () => {
    const upstashEnv = {
      UPSTASH_VECTOR_REST_URL: 'https://example-vector.upstash.io',
      UPSTASH_VECTOR_REST_TOKEN: 'read-only-token',
    };

    it('offers no tools at all when the Upstash credentials are absent', async () => {
      delete process.env.UPSTASH_VECTOR_REST_URL;
      delete process.env.UPSTASH_VECTOR_REST_TOKEN;
      const h = makeHarness();
      h.anthropic.streamMessage.mockResolvedValueOnce({
        text: 'q',
        inputTokens: 1,
        outputTokens: 1,
      });

      await h.service.generateTurnPair({
        topic,
        prepared,
        history: [],
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      // Without this the model spends an extra round trip per searching turn
      // to be told the search is unavailable, in a deployment that knew at
      // startup. With no tools the generation is what it was before retrieval.
      const params = h.anthropic.runToolConversation.mock.calls[0][0] as {
        tools: unknown[];
        maxIterations: number;
      };
      expect(params.tools).toEqual([]);
      expect(params.maxIterations).toBe(1);
    });

    it('offers searchKnowledge when they are present', async () => {
      Object.assign(process.env, upstashEnv);
      const h = makeHarness();
      h.anthropic.streamMessage.mockResolvedValueOnce({
        text: 'q',
        inputTokens: 1,
        outputTokens: 1,
      });

      await h.service.generateTurnPair({
        topic,
        prepared,
        history: [],
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      const params = h.anthropic.runToolConversation.mock.calls[0][0] as {
        tools: { name: string }[];
        maxIterations: number;
      };
      expect(params.tools.map((t) => t.name)).toEqual(['searchKnowledge']);
      expect(params.maxIterations).toBeGreaterThan(1);
    });

    it('budgets enough tokens for the model to think AND still answer', async () => {
      // Regression, measured 2026-09-03. At 600 the model twice spent the
      // WHOLE allowance on thinking — `stop_reason: max_tokens`, content
      // blocks `[thinking]`, zero text — and the visitor got the guard's
      // deflection instead of an answer. A third sample thought for 338 and
      // then had its answer cut off mid sentence, which is the persona score
      // the eval kept losing. Thinking tokens are billed against this budget,
      // so it has to cover both, not just the prose.
      //
      // Asserted as a floor rather than an exact number: the point is the
      // headroom, and pinning the literal would only make this a test that
      // has to be edited every time the budget is tuned.
      Object.assign(process.env, upstashEnv);
      const h = makeHarness();
      h.anthropic.streamMessage.mockResolvedValueOnce({
        text: 'q',
        inputTokens: 1,
        outputTokens: 1,
      });

      await h.service.generateTurnPair({
        topic,
        prepared,
        history: [],
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      const params = h.anthropic.runToolConversation.mock.calls[0][0] as {
        maxTokens: number;
      };
      expect(params.maxTokens).toBeGreaterThanOrEqual(1200);
    });
  });

  it('a blank interviewer question fails the turn rather than persisting an empty row', async () => {
    const h = makeHarness();
    // A blank question would be stored as-is and then dropped from later
    // transcripts, leaving an answer with no question above it.
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: '   ',
      inputTokens: 5,
      outputTokens: 0,
    });

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    expect(h.events).toEqual([
      ['turn_start', { role: 'interviewer' }],
      ['turn_error', { message: TURN_ERROR_MESSAGE }],
    ]);
    // Tony is never asked, and the reserved slot is released for a retry.
    expect(h.anthropic.streamMessage).toHaveBeenCalledTimes(1);
    expect(h.anthropic.runToolConversation).not.toHaveBeenCalled();
    expect(h.prisma.conversationTurn.delete).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
    });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records tokens already billed when the tool loop throws part way', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 20,
      outputTokens: 10,
    });
    // Built by the REAL tool loop rather than by faking its mechanism: the
    // usage now lives in a module-private WeakMap, so a test that attaches it
    // by hand would pass while the production contract was broken.
    let upstreamCalls = 0;
    const failure = await runToolConversation(
      () => {
        upstreamCalls += 1;
        if (upstreamCalls <= 2) {
          return Promise.resolve({
            content: [
              {
                type: 'tool_use',
                id: `tu_${upstreamCalls}`,
                name: 't',
                input: {},
              },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 1200, output_tokens: 90 },
          });
        }
        return Promise.reject(new Error('529 overloaded'));
      },
      'model-x',
      {
        system: 's',
        userMessage: 'u',
        maxTokens: 600,
        tools: [{ name: 't', description: 'd', inputSchema: {} }],
        executeTool: async () => 'r',
        maxIterations: 4,
      },
    ).catch((error: unknown) => error);
    h.anthropic.runToolConversation.mockRejectedValueOnce(failure);

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    // The turn failed, but the money was still spent, so the daily cap has to
    // move. Otherwise a persistently failing turn burns budget invisibly.
    // 2 loop iterations at 1200+90, plus the interviewer's 20+10, which was
    // itself being dropped until the running total was hoisted.
    expect(h.dailyUsage.incrementOp).toHaveBeenCalledWith(0, 2580 + 30);
    expect(h.events.map(([event]) => event)).toContain('turn_error');
    expect(h.prisma.conversationTurn.delete).toHaveBeenCalled();
  });

  it('records both generations when the transaction itself fails', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 20,
      outputTokens: 10,
    });
    h.anthropic.runToolConversation.mockResolvedValueOnce({
      text: 'a real answer',
      inputTokens: 5000,
      outputTokens: 2500,
      toolCallCount: 1,
      stoppedOnIterationCap: false,
      stoppedOnMaxTokens: false,
    });
    h.prisma.$transaction.mockRejectedValueOnce(new Error('deadlock detected'));

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    // Both generations completed and were billed before the write failed, and
    // a Prisma error carries no tool loop usage, so nothing else could
    // recover them: 30 + 7500.
    expect(h.dailyUsage.incrementOp).toHaveBeenLastCalledWith(0, 7530);
  });

  it('does not double count when the failure comes after a committed turn', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 20,
      outputTokens: 10,
    });
    // The transaction succeeds, charging the full turn, and the failure
    // happens afterwards. Charging again from the catch would bill it twice.
    let emitted = 0;
    const emit = (event: string, data: unknown) => {
      emitted += 1;
      if (event === 'turn_end') throw new Error('client disconnected');
      h.events.push([event, data]);
    };

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit,
    });

    expect(emitted).toBeGreaterThan(0);
    // Only the transaction's own increment, never a second one from the catch.
    expect(h.dailyUsage.incrementOp).toHaveBeenCalledTimes(1);
  });

  it("counts Tony's tokens when a failure lands between the call and the write", async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 20,
      outputTokens: 10,
    });
    h.anthropic.runToolConversation.mockResolvedValueOnce({
      text: 'a real answer',
      inputTokens: 400,
      outputTokens: 300,
      toolCallCount: 0,
      stoppedOnIterationCap: false,
      stoppedOnMaxTokens: false,
    });

    // Several statements sit between the billed call and the transaction: the
    // retrieval log, the guard, the emit loop. Each is a window where these
    // tokens are spent and uncounted, which is why the accumulate belongs
    // immediately after the call rather than just before the write.
    const emit = (event: string, data: unknown) => {
      if (event === 'token') throw new Error('client vanished mid-stream');
      h.events.push([event, data]);
    };

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit,
    });

    expect(h.dailyUsage.incrementOp).toHaveBeenCalledWith(0, 30 + 700);
  });

  it('blames the token budget, not the guard, when a tool call is truncated', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 1,
      outputTokens: 1,
    });
    h.anthropic.runToolConversation.mockResolvedValueOnce({
      text: '',
      inputTokens: 10,
      outputTokens: 10,
      toolCallCount: 1,
      stoppedOnIterationCap: false,
      stoppedOnMaxTokens: true,
    });
    const warn = vi.spyOn(Logger.prototype, 'warn');

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    // The guard does reject the empty text, but the cause is the token
    // budget. Logging it as a guard failure sends an operator after the wrong
    // thing, which is the misattribution this whole phase started with.
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines.some((l) => l.includes('truncated mid tool call'))).toBe(true);
    expect(lines.some((l) => l.includes('Ownership guard fired'))).toBe(false);
    warn.mockRestore();
  });

  it('still blames the guard for a genuine guard failure', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 1,
      outputTokens: 1,
    });
    h.anthropic.runToolConversation.mockResolvedValueOnce({
      text: '   ',
      inputTokens: 10,
      outputTokens: 10,
      toolCallCount: 0,
      stoppedOnIterationCap: false,
      stoppedOnMaxTokens: false,
    });
    const warn = vi.spyOn(Logger.prototype, 'warn');

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines.some((l) => l.includes('Ownership guard fired'))).toBe(true);
    warn.mockRestore();
  });

  it('warns with the error type and message when retrieval fails', async () => {
    // The line an operator actually sees. Nothing asserted it, so making the
    // service's onFailure a no-op, dropping the cause, or downgrading warn to
    // debug all left the suite green.
    process.env.UPSTASH_VECTOR_REST_URL = 'https://example-vector.upstash.io';
    process.env.UPSTASH_VECTOR_REST_TOKEN = 'read-only-token';
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 1,
      outputTokens: 1,
    });
    h.anthropic.runToolConversation.mockImplementationOnce(
      async (params: { executeTool: (c: unknown) => Promise<string> }) => {
        // Drive the real executor the service built, with a tool the model
        // was never offered, so onFailure fires through the production path.
        await params.executeTool({ name: 'nope', input: {} });
        return {
          text: 'an answer',
          inputTokens: 1,
          outputTokens: 1,
          toolCallCount: 1,
          stoppedOnIterationCap: false,
          stoppedOnMaxTokens: false,
        };
      },
    );
    const warn = vi.spyOn(Logger.prototype, 'warn');

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(
      lines.some((l) =>
        l.startsWith('searchKnowledge failed: unknown tool requested: nope'),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it('does not touch the counters when nothing was billed', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockRejectedValue(new Error('upstream down'));

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    expect(h.dailyUsage.incrementOp).not.toHaveBeenCalled();
  });

  it('error path: releases the reserved slot and emits turn_error instead of turn_end', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockRejectedValue(new Error('upstream down'));

    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    expect(h.events).toEqual([
      ['turn_start', { role: 'interviewer' }],
      // Fixed text: the raw 'upstream down' must never reach a visitor.
      ['turn_error', { message: TURN_ERROR_MESSAGE }],
    ]);
    expect(h.prisma.conversationTurn.delete).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
    });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('per-call provider log line (spec 0005 AC-P5)', () => {
    it('logs { provider: "anthropic", model, outcome: "ok" } when AI_PROVIDER is unset', async () => {
      delete process.env.AI_PROVIDER;
      process.env.ANTHROPIC_MODEL = 'claude-sonnet-5';
      const h = makeHarness();
      h.anthropic.streamMessage.mockResolvedValueOnce({
        text: 'q',
        inputTokens: 1,
        outputTokens: 1,
      });
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      await h.service.generateTurnPair({
        topic,
        prepared,
        history: [],
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      const logged = logSpy.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === 'string')
        .map((line) => JSON.parse(line))
        .find((entry) => entry.outcome === 'ok');
      expect(logged).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        outcome: 'ok',
      });
      logSpy.mockRestore();
    });

    it('logs { provider: "bedrock", model, outcome: "error" } on failure when AI_PROVIDER=bedrock', async () => {
      process.env.AI_PROVIDER = 'bedrock';
      process.env.BEDROCK_MODEL_ID =
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
      const h = makeHarness();
      h.anthropic.streamMessage.mockRejectedValue(new Error('boom'));
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      await h.service.generateTurnPair({
        topic,
        prepared,
        history: [],
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      const logged = logSpy.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === 'string')
        .map((line) => JSON.parse(line))
        .find((entry) => entry.outcome === 'error');
      expect(logged).toEqual({
        provider: 'bedrock',
        model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        outcome: 'error',
      });
      logSpy.mockRestore();
    });
  });
});

describe('ConversationService.loadConversation (spec 0012 AC-3)', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('returns nothing when no conversationId is given, without querying', async () => {
    const h = makeHarness();
    await expect(h.service.loadConversation(undefined)).resolves.toEqual({
      turns: [],
      topicId: null,
      nextTurnIndex: 0,
    });
    expect(h.prisma.conversationTurn.findMany).not.toHaveBeenCalled();
  });

  it('a known conversationId with no persisted rows behaves like a new conversation', async () => {
    const h = makeHarness();
    h.prisma.conversationTurn.findMany.mockResolvedValue([]);
    await expect(h.service.loadConversation('conv-unknown')).resolves.toEqual({
      turns: [],
      topicId: null,
      nextTurnIndex: 0,
    });
  });

  it('orders by turnIndex, interviewer before Tony within a pair, whatever order the rows arrive in', async () => {
    const h = makeHarness();
    h.prisma.conversationTurn.findMany.mockResolvedValue([
      {
        turnIndex: 1,
        role: ConversationRole.TONY,
        text: 'A2',
        topicId: 'topic-1',
      },
      {
        turnIndex: 0,
        role: ConversationRole.TONY,
        text: 'A1',
        topicId: 'topic-1',
      },
      {
        turnIndex: 1,
        role: ConversationRole.INTERVIEWER,
        text: 'Q2',
        topicId: 'topic-1',
      },
      {
        turnIndex: 0,
        role: ConversationRole.INTERVIEWER,
        text: 'Q1',
        topicId: 'topic-1',
      },
    ]);

    const loaded = await h.service.loadConversation('conv-1');
    expect(loaded.turns).toEqual([
      { role: 'interviewer', text: 'Q1' },
      { role: 'tony', text: 'A1' },
      { role: 'interviewer', text: 'Q2' },
      { role: 'tony', text: 'A2' },
    ]);
    expect(loaded.topicId).toBe('topic-1');
    expect(loaded.nextTurnIndex).toBe(2);
  });

  it('skips the empty placeholder row for the transcript but still counts it for the next slot', async () => {
    const h = makeHarness();
    h.prisma.conversationTurn.findMany.mockResolvedValue([
      {
        turnIndex: 0,
        role: ConversationRole.INTERVIEWER,
        text: 'Q1',
        topicId: 'topic-1',
      },
      {
        turnIndex: 0,
        role: ConversationRole.TONY,
        text: 'A1',
        topicId: 'topic-1',
      },
      {
        turnIndex: 1,
        role: ConversationRole.INTERVIEWER,
        text: '',
        topicId: 'topic-1',
      },
    ]);

    const loaded = await h.service.loadConversation('conv-1');
    expect(loaded.turns).toEqual([
      { role: 'interviewer', text: 'Q1' },
      { role: 'tony', text: 'A1' },
    ]);
    // The reserved slot is not a turn, but it is taken: reusing index 1 would
    // hit the (conversationId, turnIndex, role) unique constraint.
    expect(loaded.nextTurnIndex).toBe(2);
  });
});

describe('ConversationService.prepareTurn topic scoping', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  const continuing = {
    turns: [
      { role: 'interviewer' as const, text: 'Q1' },
      { role: 'tony' as const, text: 'A1' },
    ],
    topicId: 'topic-1',
    nextTurnIndex: 1,
  };

  it('rejects a conversationId that belongs to a different topic', async () => {
    const h = makeHarness();
    const otherTopic = { ...topic, id: 'topic-2' } as TopicWithStories;

    await expect(
      h.service.prepareTurn({
        topic: otherTopic,
        conversationId: 'conv-1',
        conversation: continuing,
        hashedIp: 'hashed-ip',
      }),
    ).rejects.toThrow('This conversation belongs to a different topic');

    // Rejected before any slot is claimed, so no row is written.
    expect(h.prisma.conversationTurn.create).not.toHaveBeenCalled();
  });

  it('continues normally when the topic matches', async () => {
    const h = makeHarness();
    // The harness stub returns a plain object, not a promise; prepareTurn
    // awaits it either way. Retyped because that shape widens the mock to never.
    (h.prisma.conversationTurn.create as Mock).mockReturnValue({
      id: 'turn-9',
    });

    const prepared = await h.service.prepareTurn({
      topic,
      conversationId: 'conv-1',
      conversation: continuing,
      hashedIp: 'hashed-ip',
    });

    expect(prepared.conversationId).toBe('conv-1');
    expect(prepared.turnIndex).toBe(1);
  });

  it('does not apply the topic check to a new conversation', async () => {
    const h = makeHarness();
    // The harness stub returns a plain object, not a promise; prepareTurn
    // awaits it either way. Retyped because that shape widens the mock to never.
    (h.prisma.conversationTurn.create as Mock).mockReturnValue({
      id: 'turn-9',
    });

    const prepared = await h.service.prepareTurn({
      topic,
      conversationId: undefined,
      conversation: { turns: [], topicId: null, nextTurnIndex: 0 },
      hashedIp: 'hashed-ip',
    });

    expect(prepared.turnIndex).toBe(0);
    expect(prepared.conversationId).not.toBe('conv-1');
  });
});

describe('interviewer user message (spec 0012 AC-1, AC-2)', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  async function interviewerMessage(history: HistoryTurn[] = []) {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 1,
      outputTokens: 1,
    });

    await h.service.generateTurnPair({
      topic,
      prepared,
      history,
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    return (
      h.anthropic.streamMessage.mock.calls[0][0] as { userMessage: string }
    ).userMessage;
  }

  it('catalogs the rest of the topic by title and engagement, excluding the grounding story', async () => {
    const message = await interviewerMessage();

    expect(message).toContain('- Realtime collaboration (Product Forge)');
    // The grounding story is listed in full below the catalog; repeating it
    // there would read as two different stories.
    expect(message).not.toContain('- Portfolio rebuild (Personal project)');
    expect(message).toContain('Story to ask about: Portfolio rebuild');
    // Titles only: the catalog must not hand over details to invent from.
    expect(message).not.toContain('Built the collaborative editing layer.');
  });

  it('says so plainly when the topic has no other story', async () => {
    const h = makeHarness();
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 1,
      outputTokens: 1,
    });

    await h.service.generateTurnPair({
      topic: { ...topic, stories: [story] } as TopicWithStories,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });

    const message = (
      h.anthropic.streamMessage.mock.calls[0][0] as { userMessage: string }
    ).userMessage;
    expect(message).toContain('(none — this topic has one story)');
  });

  it('renders the rebuilt history as the prior conversation block', async () => {
    const message = await interviewerMessage([
      { role: 'interviewer', text: 'Q1' },
      { role: 'tony', text: 'A1' },
    ]);

    expect(message).toContain('Prior conversation:\nInterviewer: Q1\nTony: A1');
  });
});

describe('the credential check, spec 0013 layer two', () => {
  // Carries a distinctive tail, so 'the fallback replaced it' is provable.
  // The fallback itself says "occupational therapist for six years", so a
  // substring check on the clinical words alone could never discriminate.
  const CLINICAL =
    'I was an occupational therapist for six years, then came the pipeline rebuild.';
  const NOT_CLINICAL = 'I rebuilt the deployment pipeline over two sprints.';

  /** Drives one turn whose Tony answer is `text`. */
  async function runWith(h: ReturnType<typeof makeHarness>, text: string) {
    h.anthropic.streamMessage.mockResolvedValueOnce({
      text: 'q',
      inputTokens: 1,
      outputTokens: 1,
    });
    h.anthropic.runToolConversation.mockResolvedValueOnce({
      text,
      inputTokens: 10,
      outputTokens: 10,
      toolCallCount: 0,
      stoppedOnIterationCap: false,
      stoppedOnMaxTokens: false,
    });
    await h.service.generateTurnPair({
      topic,
      prepared,
      history: [],
      hashedIp: 'hashed-ip',
      emit: h.emit,
    });
    return h.events
      .filter(([name]) => name === 'token')
      .map(([, payload]) => (payload as { text: string }).text)
      .join('');
  }

  it('makes no call at all when the prefilter does not match (AC-1)', async () => {
    const h = makeHarness();
    const streamed = await runWith(h, NOT_CLINICAL);
    expect(h.credentialCheck.forceToolCall).not.toHaveBeenCalled();
    expect(streamed).toBe(NOT_CLINICAL);
  });

  it('streams the answer unchanged when the verdict clears it (AC-2)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockResolvedValueOnce({
      input: { category: 'past_tense_ok', reasoning: 'stated in the past' },
      inputTokens: 5,
      outputTokens: 2,
    });
    const streamed = await runWith(h, CLINICAL);
    expect(h.credentialCheck.forceToolCall).toHaveBeenCalledTimes(1);
    expect(streamed).toBe(CLINICAL);
  });

  it('substitutes the fallback on a current_claim, emitting no original token (AC-2)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockResolvedValueOnce({
      input: { category: 'current_claim', reasoning: 'claims a live licence' },
      inputTokens: 5,
      outputTokens: 2,
    });
    const streamed = await runWith(h, CLINICAL);
    expect(streamed).toBe(CREDENTIAL_GUARD_FALLBACK);
    expect(streamed).not.toContain('then came the pipeline rebuild');
  });

  it('suppresses on `ambiguous`, because unsure is not permission (AC-2)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockResolvedValueOnce({
      input: { category: 'ambiguous', reasoning: 'cannot tell' },
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(await runWith(h, CLINICAL)).toBe(CREDENTIAL_GUARD_FALLBACK);
  });

  it('suppresses a category outside the enum rather than reading it as permission (AC-2)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockResolvedValueOnce({
      input: { category: 'looks_fine_to_me', reasoning: 'invented' },
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(await runWith(h, CLINICAL)).toBe(CREDENTIAL_GUARD_FALLBACK);
  });

  it('fails CLOSED on a provider error, and does not emit turn_error (AC-3)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockRejectedValueOnce(
      new Error('upstream exploded'),
    );
    const streamed = await runWith(h, CLINICAL);
    expect(streamed).toBe(CREDENTIAL_GUARD_FALLBACK);
    // A throw escaping the check would be caught by generateTurnPair's handler,
    // which deletes the reserved turn and emits turn_error instead of the
    // fallback — so the check would not fail closed at all.
    expect(h.events.map(([name]) => name)).not.toContain('turn_error');
  });

  it('bills the check as spend without counting it as a persisted row (AC-6)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockResolvedValueOnce({
      input: { category: 'past_tense_ok', reasoning: 'past' },
      inputTokens: 5,
      outputTokens: 2,
    });
    await runWith(h, CLINICAL);
    const call = h.dailyUsage.incrementOp.mock.calls.at(-1) as [number, number];
    expect(call[0]).toBe(2);
    // interviewer 2 + tony 20 + the check's 7
    expect(call[1]).toBe(29);
  });

  it('makes no call when CREDENTIAL_CHECK_ENABLED is false (AC-5)', async () => {
    process.env.CREDENTIAL_CHECK_ENABLED = 'false';
    try {
      const h = makeHarness();
      const streamed = await runWith(h, CLINICAL);
      expect(h.credentialCheck.forceToolCall).not.toHaveBeenCalled();
      expect(streamed).toBe(CLINICAL);
    } finally {
      delete process.env.CREDENTIAL_CHECK_ENABLED;
    }
  });

  it('never logs the answer text, only the verdict and story id (AC-7)', async () => {
    const h = makeHarness();
    h.credentialCheck.forceToolCall.mockResolvedValueOnce({
      input: { category: 'current_claim', reasoning: 'claims a live licence' },
      inputTokens: 5,
      outputTokens: 2,
    });
    const warn = vi.spyOn(Logger.prototype, 'warn');
    await runWith(h, CLINICAL);
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines.some((l) => l.includes('current_claim'))).toBe(true);
    expect(lines.some((l) => l.includes('occupational therapist'))).toBe(false);
    expect(lines.some((l) => l.includes('claims a live licence'))).toBe(false);
    warn.mockRestore();
  });
});

describe('the credential check startup guard, spec 0013 AC-10', () => {
  afterEach(() => {
    delete process.env.CREDENTIAL_CHECK_ENABLED;
  });

  it('refuses to start when the check is enabled and the key is absent', () => {
    const h = makeHarness();
    h.credentialCheck.isConfigured.mockReturnValue(false);
    // The failure this prevents is silent and total: the check fails closed,
    // so booting would replace EVERY clinical answer with the fallback, and
    // the only symptom would be a persona that will not discuss its own past.
    expect(() => h.service.onModuleInit()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('starts when the key is absent but the check is switched off', () => {
    process.env.CREDENTIAL_CHECK_ENABLED = 'false';
    const h = makeHarness();
    h.credentialCheck.isConfigured.mockReturnValue(false);
    expect(() => h.service.onModuleInit()).not.toThrow();
  });

  it('starts normally when the key is present', () => {
    const h = makeHarness();
    expect(() => h.service.onModuleInit()).not.toThrow();
  });
});
