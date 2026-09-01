import { Logger } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ConversationRole, StoryOwnership } from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiProvider } from '../anthropic/ai-provider.interface';
import type { DailyUsageService } from '../daily-usage/daily-usage.service';
import type {
  HistoryTurn,
  TopicWithStories,
} from './conversation.service';

// PrismaService is only referenced through constructor injection; the real
// module drags in the generated Prisma client, which no test may touch.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

// Agent prompts live as markdown skill files on disk; tests never read the
// filesystem (the beta.service.spec convention).
jest.mock('./skill-loader', () => ({
  loadConversationSkill: jest.fn(() => 'stub skill prompt'),
}));

// conversation.service.ts uses `Prisma.PrismaClientKnownRequestError` at
// runtime (an `instanceof` check, not just a type), which otherwise pulls in
// generated/prisma/client.ts's full module graph — unrelated to this spec
// and not something these tests exercise (that branch is prepareTurn's
// unique-constraint race, not generateTurnPair).
jest.mock('../../generated/prisma/client', () => ({
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
    $transaction: jest.fn().mockResolvedValue([]),
    conversationTurn: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: unknown) => ({ __op: 'update', args })),
      create: jest.fn((args: unknown) => ({ __op: 'create', args })),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  };
  const anthropic = {
    streamMessage: jest.fn(),
    forceToolCall: jest.fn(),
    // The Tony generation runs through here now (0012 phase three AC-4); only
    // the interviewer still uses streamMessage. Defaulted so the many tests
    // that only care about the interviewer do not each have to stub it.
    runToolConversation: jest.fn().mockResolvedValue({
      text: 'a',
      inputTokens: 1,
      outputTokens: 1,
      toolCallCount: 0,
      stoppedOnIterationCap: false,
    }),
  };
  const dailyUsage = {
    assertCapNotExceeded: jest.fn().mockResolvedValue(undefined),
    incrementOp: jest.fn((count: number, tokens: number) => ({
      __op: 'incrementOp',
      count,
      tokens,
    })),
  };
  const service = new ConversationService(
    prisma as unknown as PrismaService,
    anthropic as unknown as AiProvider,
    dailyUsage as unknown as DailyUsageService,
  );
  const events: [string, unknown][] = [];
  const emit = (event: string, data: unknown) => {
    events.push([event, data]);
  };
  return { prisma, anthropic, dailyUsage, service, events, emit };
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
      ['turn_error', { message: 'The interviewer produced an empty question' }],
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
    // What runToolConversation throws once two iterations have been billed.
    const failure = new Error('529 overloaded');
    Object.defineProperty(failure, '__toolLoopUsage', {
      value: { inputTokens: 2400, outputTokens: 180 },
      enumerable: false,
    });
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
    expect(h.dailyUsage.incrementOp).toHaveBeenCalledWith(0, 2580);
    expect(h.events.map(([event]) => event)).toContain('turn_error');
    expect(h.prisma.conversationTurn.delete).toHaveBeenCalled();
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
      ['turn_error', { message: 'upstream down' }],
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
      const logSpy = jest.spyOn(Logger.prototype, 'log');

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
      process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
      const h = makeHarness();
      h.anthropic.streamMessage.mockRejectedValue(new Error('boom'));
      const logSpy = jest.spyOn(Logger.prototype, 'log');

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
      { turnIndex: 1, role: ConversationRole.TONY, text: 'A2', topicId: 'topic-1' },
      { turnIndex: 0, role: ConversationRole.TONY, text: 'A1', topicId: 'topic-1' },
      { turnIndex: 1, role: ConversationRole.INTERVIEWER, text: 'Q2', topicId: 'topic-1' },
      { turnIndex: 0, role: ConversationRole.INTERVIEWER, text: 'Q1', topicId: 'topic-1' },
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
      { turnIndex: 0, role: ConversationRole.INTERVIEWER, text: 'Q1', topicId: 'topic-1' },
      { turnIndex: 0, role: ConversationRole.TONY, text: 'A1', topicId: 'topic-1' },
      { turnIndex: 1, role: ConversationRole.INTERVIEWER, text: '', topicId: 'topic-1' },
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
    (h.prisma.conversationTurn.create as jest.Mock).mockReturnValue({
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
    (h.prisma.conversationTurn.create as jest.Mock).mockReturnValue({
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
