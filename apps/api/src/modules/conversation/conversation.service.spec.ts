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
  const anthropic = { streamMessage: jest.fn(), forceToolCall: jest.fn() };
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
    h.anthropic.streamMessage
      .mockResolvedValueOnce({
        text: 'What drove the rebuild?',
        inputTokens: 20,
        outputTokens: 10,
      })
      .mockResolvedValueOnce({
        text: 'Faster.',
        inputTokens: 30,
        outputTokens: 40,
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
    expect(h.anthropic.streamMessage).toHaveBeenCalledTimes(2);
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
      h.anthropic.streamMessage
        .mockResolvedValueOnce({ text: 'q', inputTokens: 1, outputTokens: 1 })
        .mockResolvedValueOnce({ text: 'a', inputTokens: 1, outputTokens: 1 });
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

describe('ConversationService.loadHistory (spec 0012 AC-3)', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('returns nothing when no conversationId is given, without querying', async () => {
    const h = makeHarness();
    await expect(h.service.loadHistory(undefined)).resolves.toEqual([]);
    expect(h.prisma.conversationTurn.findMany).not.toHaveBeenCalled();
  });

  it('a known conversationId with no persisted rows behaves like a new conversation', async () => {
    const h = makeHarness();
    h.prisma.conversationTurn.findMany.mockResolvedValue([]);
    await expect(h.service.loadHistory('conv-unknown')).resolves.toEqual([]);
  });

  it('orders by turnIndex, interviewer before Tony within a pair, whatever order the rows arrive in', async () => {
    const h = makeHarness();
    h.prisma.conversationTurn.findMany.mockResolvedValue([
      { turnIndex: 1, role: ConversationRole.TONY, text: 'A2' },
      { turnIndex: 0, role: ConversationRole.TONY, text: 'A1' },
      { turnIndex: 1, role: ConversationRole.INTERVIEWER, text: 'Q2' },
      { turnIndex: 0, role: ConversationRole.INTERVIEWER, text: 'Q1' },
    ]);

    await expect(h.service.loadHistory('conv-1')).resolves.toEqual([
      { role: 'interviewer', text: 'Q1' },
      { role: 'tony', text: 'A1' },
      { role: 'interviewer', text: 'Q2' },
      { role: 'tony', text: 'A2' },
    ]);
  });

  it('skips the empty placeholder row prepareTurn reserves before generation', async () => {
    const h = makeHarness();
    h.prisma.conversationTurn.findMany.mockResolvedValue([
      { turnIndex: 0, role: ConversationRole.INTERVIEWER, text: 'Q1' },
      { turnIndex: 0, role: ConversationRole.TONY, text: 'A1' },
      { turnIndex: 1, role: ConversationRole.INTERVIEWER, text: '' },
    ]);

    await expect(h.service.loadHistory('conv-1')).resolves.toEqual([
      { role: 'interviewer', text: 'Q1' },
      { role: 'tony', text: 'A1' },
    ]);
  });
});

describe('interviewer user message (spec 0012 AC-1, AC-2)', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  async function interviewerMessage(history: HistoryTurn[] = []) {
    const h = makeHarness();
    h.anthropic.streamMessage
      .mockResolvedValueOnce({ text: 'q', inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ text: 'a', inputTokens: 1, outputTokens: 1 });

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
    h.anthropic.streamMessage
      .mockResolvedValueOnce({ text: 'q', inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ text: 'a', inputTokens: 1, outputTokens: 1 });

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
