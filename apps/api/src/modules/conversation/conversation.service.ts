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
import { INTERVIEWER_SYSTEM_PROMPT, TONY_SYSTEM_PROMPT } from './tony-persona';
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

  private async nextTurnIndex(conversationId: string): Promise<number> {
    const last = await this.prisma.conversationTurn.findFirst({
      where: { conversationId },
      orderBy: { turnIndex: 'desc' },
      select: { turnIndex: true },
    });
    return last ? last.turnIndex + 1 : 0;
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
    history: HistoryTurn[];
    hashedIp: string;
  }): Promise<PreparedTurn> {
    const { topic, history, hashedIp } = params;

    // Independent of the per IP throttle: a global hard backstop on daily
    // Anthropic spend, checked before any AI call regardless of who's asking.
    await this.dailyUsage.assertCapNotExceeded();

    const isNewConversation = !params.conversationId || history.length === 0;
    const conversationId = isNewConversation
      ? randomUUID()
      : (params.conversationId as string);
    const turnIndex = isNewConversation
      ? 0
      : await this.nextTurnIndex(conversationId);

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
        system: INTERVIEWER_SYSTEM_PROMPT,
        userMessage: buildInterviewerUserMessage(
          topic,
          story,
          history,
          isFinal,
        ),
        maxTokens: 150,
        onToken: (text) => emit('token', { text }),
      });

      emit('turn_start', { role: 'tony' });
      // Buffered, not live: the ownership guard below must see the complete
      // response before anything reaches the client, so onToken here only
      // accumulates internally (via AnthropicService's return value), never emits.
      const tonyGenerated = await this.anthropic.streamMessage({
        system: TONY_SYSTEM_PROMPT,
        userMessage: buildTonyUserMessage(
          story,
          interviewerResult.text,
          isFinal,
        ),
        maxTokens: 400,
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
    `Story to ask about: ${story.title} (${story.engagement})`,
    `Story details: ${story.summary}`,
    historyBlock ? `Prior conversation:\n${historyBlock}` : null,
    instruction,
  ]
    .filter(Boolean)
    .join('\n\n');
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
    ? 'Give a warm, concluding closing answer that wraps up the conversation and invites the visitor to explore more of the portfolio, rather than a normal deep-dive answer.'
    : 'Answer as Tony now.';
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
