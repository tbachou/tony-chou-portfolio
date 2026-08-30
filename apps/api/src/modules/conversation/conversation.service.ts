import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_PROVIDER,
  resolveConfiguredProvider,
  type AiProvider,
} from '../anthropic/ai-provider.interface';
import { ConversationRole } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import type { StoryModel, TopicModel } from '../../generated/prisma/models';
import { loadConversationSkill } from './skill-loader';
import {
  evaluateTonyResponse,
  GENERIC_GUARD_FALLBACK,
  splitIntoChunks,
} from './ownership-guard';
import { DailyUsageService } from '../daily-usage/daily-usage.service';

export type HistoryTurn = {
  role: 'interviewer' | 'tony';
  text: string;
};

export type TopicWithStories = TopicModel & { stories: StoryModel[] };

/** One read of a conversation's persisted rows, per `loadConversation`. */
export type LoadedConversation = {
  /** The rebuilt transcript, oldest first, blank rows excluded. */
  turns: HistoryTurn[];
  /** The topic every persisted row belongs to; null when there are none. */
  topicId: string | null;
  /** The next free slot, counting reserved rows. */
  nextTurnIndex: number;
};

/**
 * A fresh object per call, never a shared constant. The server is long lived
 * and this value is handed to request code that owns it; one shared instance
 * would mean one shared `turns` array, so any caller that ever mutated it
 * (appending a synthetic opening turn, sorting in place) would leak that edit
 * into every later conversation in the process.
 */
function emptyConversation(): LoadedConversation {
  return { turns: [], topicId: null, nextTurnIndex: 0 };
}

export type EmitFn = (event: string, data: unknown) => void;

const TURN_PAIR_CAP = Number(process.env.TURN_PAIR_CAP ?? 5);

export type PreparedTurn = {
  conversationId: string;
  turnIndex: number;
  isFinal: boolean;
  story: StoryModel;
  interviewerTurnId: string;
};

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly anthropic: AiProvider,
    private readonly dailyUsage: DailyUsageService,
  ) {}

  async resolveTopic(topicId: string): Promise<TopicWithStories | null> {
    return this.prisma.topic.findUnique({
      where: { slug: topicId },
      include: { stories: { orderBy: { id: 'asc' } } },
    });
  }

  /**
   * Rebuilds a conversation from its persisted rows rather than trusting a
   * client-echoed transcript (spec 0012 phase one, AC-3). Nothing a visitor
   * types reaches a prompt: the request carries only a topic slug and a uuid.
   *
   * One query answers all three questions the caller has — what was said, what
   * topic it was said about, and which slot is next — so there is exactly one
   * definition of "the rows of this conversation" rather than two reads that
   * can disagree.
   *
   * An unknown conversationId yields no rows, which prepareTurn treats as a
   * new conversation.
   */
  async loadConversation(
    conversationId?: string,
  ): Promise<LoadedConversation> {
    if (!conversationId) return emptyConversation();
    const rows = await this.prisma.conversationTurn.findMany({
      where: { conversationId },
      orderBy: { turnIndex: 'asc' },
      select: { turnIndex: true, role: true, text: true, topicId: true },
    });
    if (rows.length === 0) return emptyConversation();

    return {
      // Counts EVERY row, including a reserved one whose text is still empty,
      // so a crashed generation leaves a hole rather than handing the next
      // request a slot the unique constraint would reject.
      nextTurnIndex: Math.max(...rows.map((row) => row.turnIndex)) + 1,
      // Every row of one conversation shares a topic; prepareTurn enforces it.
      topicId: rows[0].topicId,
      turns: rows
        // prepareTurn reserves the interviewer slot with `text: ''` before
        // generation, and a crashed process can orphan one. A blank turn in a
        // prompt reads as a question nobody answered.
        .filter((row) => row.text.length > 0)
        .sort(
          (a, b) =>
            a.turnIndex - b.turnIndex ||
            rolePosition(a.role) - rolePosition(b.role),
        )
        .map((row) => ({
          role:
            row.role === ConversationRole.INTERVIEWER
              ? ('interviewer' as const)
              : ('tony' as const),
          text: row.text,
        })),
    };
  }

  private groundingStory(
    topic: TopicWithStories,
    turnIndex: number,
  ): StoryModel {
    return topic.stories[turnIndex % topic.stories.length];
  }

  /**
   * Resolves conversationId/turnIndex, rejects a request against an already
   * concluded conversation, and atomically claims the (conversationId,
   * turnIndex, INTERVIEWER) slot via the DB unique constraint so a
   * concurrent duplicate request fails here, before any SSE stream opens.
   */
  async prepareTurn(params: {
    topic: TopicWithStories;
    conversationId?: string;
    conversation: LoadedConversation;
    hashedIp: string;
  }): Promise<PreparedTurn> {
    const { topic, conversation, hashedIp } = params;

    // Independent of the per IP throttle: a global hard backstop on daily
    // Anthropic spend, checked before any AI call regardless of who's asking.
    await this.dailyUsage.assertCapNotExceeded();

    const isNewConversation =
      !params.conversationId || conversation.turns.length === 0;

    // A conversation is about exactly one topic. Pairing one topic's slug with
    // another topic's conversationId is a malformed request, not a new
    // conversation: continuing it would splice one transcript into the other's
    // prompts and leave the persisted rows permanently mixed. Rejected rather
    // than silently restarted, so the client learns its id was wrong.
    if (
      !isNewConversation &&
      conversation.topicId !== null &&
      conversation.topicId !== topic.id
    ) {
      throw new ConflictException(
        'This conversation belongs to a different topic',
      );
    }

    const conversationId = isNewConversation
      ? randomUUID()
      : (params.conversationId as string);
    const turnIndex = isNewConversation ? 0 : conversation.nextTurnIndex;

    if (turnIndex >= TURN_PAIR_CAP) {
      throw new ConflictException('This conversation has already concluded');
    }

    const story = this.groundingStory(topic, turnIndex);
    const isFinal = turnIndex + 1 >= TURN_PAIR_CAP;

    try {
      const reserved = await this.prisma.conversationTurn.create({
        data: {
          conversationId,
          topicId: topic.id,
          turnIndex,
          role: ConversationRole.INTERVIEWER,
          text: '',
          tokenCount: 0,
          hashedIp,
        },
        select: { id: true },
      });
      return {
        conversationId,
        turnIndex,
        isFinal,
        story,
        interviewerTurnId: reserved.id,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A turn for this conversation and turn index is already being generated',
        );
      }
      throw error;
    }
  }

  async generateTurnPair(params: {
    topic: TopicWithStories;
    prepared: PreparedTurn;
    history: HistoryTurn[];
    hashedIp: string;
    emit: EmitFn;
  }): Promise<void> {
    const { topic, prepared, history, hashedIp, emit } = params;
    const { conversationId, turnIndex, isFinal, story, interviewerTurnId } =
      prepared;

    try {
      emit('turn_start', { role: 'interviewer' });
      const interviewerResult = await this.anthropic.streamMessage({
        system: loadConversationSkill('interviewer'),
        userMessage: buildInterviewerUserMessage(
          topic,
          story,
          history,
          isFinal,
        ),
        maxTokens: 150,
        onToken: (text) => emit('token', { text }),
      });

      // The interviewer has no guard of its own, so a blank question would be
      // persisted as-is and then dropped from later transcripts, leaving an
      // answer with no question above it. Treat it as a failed generation:
      // the catch below releases the reserved slot, so a retry can re-claim it.
      if (interviewerResult.text.trim().length === 0) {
        throw new Error('The interviewer produced an empty question');
      }

      emit('turn_start', { role: 'tony' });
      // Buffered, not live: the ownership guard below must see the complete
      // response before anything reaches the client, so onToken here only
      // accumulates internally (via AnthropicService's return value), never emits.
      const tonyGenerated = await this.anthropic.streamMessage({
        system: loadConversationSkill('tony'),
        userMessage: buildTonyUserMessage(
          story,
          interviewerResult.text,
          isFinal,
        ),
        // A backstop, not an editor: the prompt asks for 2-4 sentences, and
        // 600 leaves room for a slightly long answer to finish. At 400 the
        // model's longer answers truncated mid-sentence (spec 0011's eval
        // caught it: persona judge scored the cut-off answers 0).
        maxTokens: 600,
        onToken: () => undefined,
      });

      const guardResult = evaluateTonyResponse(tonyGenerated.text, story);
      let tonyText = tonyGenerated.text;
      if (!guardResult.ok) {
        tonyText = story.requiredFraming ?? GENERIC_GUARD_FALLBACK;
        this.logger.warn(
          `Ownership guard fired for story ${story.id} (${story.title}): ${guardResult.reason}`,
        );
      }

      for (const chunk of splitIntoChunks(tonyText)) {
        emit('token', { text: chunk });
      }

      const interviewerTokenCount =
        interviewerResult.inputTokens + interviewerResult.outputTokens;
      const tonyTokenCount =
        tonyGenerated.inputTokens + tonyGenerated.outputTokens;

      await this.prisma.$transaction([
        this.prisma.conversationTurn.update({
          where: { id: interviewerTurnId },
          data: {
            text: interviewerResult.text,
            tokenCount: interviewerTokenCount,
          },
        }),
        this.prisma.conversationTurn.create({
          data: {
            conversationId,
            topicId: topic.id,
            turnIndex,
            role: ConversationRole.TONY,
            text: tonyText,
            tokenCount: tonyTokenCount,
            hashedIp,
          },
        }),
        // Running counter incremented per persisted ConversationTurn row (one
        // interviewer + one Tony row this pair), not recomputed by aggregation,
        // so the AC-11 backstop check stays a single fast read.
        this.dailyUsage.incrementOp(2, interviewerTokenCount + tonyTokenCount),
      ]);

      emit('turn_end', { conversationId, turnIndex, isFinal });
      this.logProviderCall('ok');
    } catch (error) {
      // Release the reserved slot so a retry of the same call can re-claim it.
      await this.prisma.conversationTurn
        .delete({ where: { id: interviewerTurnId } })
        .catch(() => undefined);
      emit('turn_error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logProviderCall('error');
    }
  }

  /**
   * Minimal per-call structured log line for the interview path (spec 0005
   * provider-swap child, AC-P5): { provider, model, outcome }. Not full
   * parity with Beta's per-agent logging — that stays out of scope here.
   */
  private logProviderCall(outcome: 'ok' | 'error'): void {
    const { provider, model } = resolveConfiguredProvider();
    this.logger.log(JSON.stringify({ provider, model, outcome }));
  }
}

function buildInterviewerUserMessage(
  topic: TopicWithStories,
  story: StoryModel,
  history: HistoryTurn[],
  isFinal: boolean,
): string {
  const historyBlock = formatHistory(history);
  const instruction = isFinal
    ? 'This is the final exchange of the conversation. Ask a warm, concluding wrap-up question inviting a reflection on this topic overall, not a fresh deep-dive question.'
    : 'Ask your next interview question now.';
  return [
    `Topic: ${topic.label} — ${topic.description}`,
    // The catalog is the topic's full material, one line per story (spec 0012
    // phase one, AC-2): a question may reference any of it, but only the
    // grounding story below carries details to ask into.
    `Other material in this topic (titles only — you may reference these, but never invent details about them):\n${formatStoryCatalog(topic, story)}`,
    `Story to ask about: ${story.title} (${story.engagement})`,
    `Story details: ${story.summary}`,
    historyBlock ? `Prior conversation:\n${historyBlock}` : null,
    instruction,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Title plus engagement, one line per story in the active topic. The grounding
 * story is excluded: it is already listed in full just below, and repeating it
 * would read as two different stories.
 */
function formatStoryCatalog(
  topic: TopicWithStories,
  groundingStory: StoryModel,
): string {
  const others = topic.stories.filter((s) => s.id !== groundingStory.id);
  if (others.length === 0) return '(none — this topic has one story)';
  return others.map((s) => `- ${s.title} (${s.engagement})`).join('\n');
}

function rolePosition(role: ConversationRole): number {
  return role === ConversationRole.INTERVIEWER ? 0 : 1;
}

function buildTonyUserMessage(
  story: StoryModel,
  interviewerQuestion: string,
  isFinal: boolean,
): string {
  const framingNote =
    story.ownership !== 'SOLO' && story.requiredFraming
      ? `\n\nYou must frame your ownership of this story using language consistent with: "${story.requiredFraming}"`
      : '';
  const instruction = isFinal
    ? 'Give a warm, concluding closing answer, in 2-4 sentences, that wraps up the conversation and invites the visitor to explore more of the portfolio, rather than a normal deep-dive answer.'
    : 'Answer as Tony now, in 2-4 sentences. Finish your final sentence.';
  return [
    `Interviewer just asked: "${interviewerQuestion}"`,
    `Story facts to answer from — title: ${story.title}; engagement: ${story.engagement}; ownership: ${story.ownership}; details: ${story.summary}${framingNote}`,
    instruction,
  ].join('\n\n');
}

function formatHistory(history: HistoryTurn[]): string {
  return history
    .map(
      (turn) =>
        `${turn.role === 'interviewer' ? 'Interviewer' : 'Tony'}: ${turn.text}`,
    )
    .join('\n');
}
