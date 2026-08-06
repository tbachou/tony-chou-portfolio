import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from '../anthropic/anthropic.service';
import { ConversationRole } from '../../generated/prisma/enums';
import type { StoryModel, TopicModel } from '../../generated/prisma/models';
import { INTERVIEWER_SYSTEM_PROMPT, TONY_SYSTEM_PROMPT } from './tony-persona';

export type HistoryTurn = {
  role: 'interviewer' | 'tony';
  text: string;
};

export type TopicWithStories = TopicModel & { stories: StoryModel[] };

export type EmitFn = (event: string, data: unknown) => void;

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
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

  private buildInterviewerUserMessage(
    topic: TopicWithStories,
    story: StoryModel,
    history: HistoryTurn[],
  ): string {
    const historyBlock = formatHistory(history);
    return [
      `Topic: ${topic.label} — ${topic.description}`,
      `Story to ask about: ${story.title} (${story.engagement})`,
      `Story details: ${story.summary}`,
      historyBlock ? `Prior conversation:\n${historyBlock}` : null,
      'Ask your next interview question now.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildTonyUserMessage(
    story: StoryModel,
    interviewerQuestion: string,
  ): string {
    const framingNote =
      story.ownership !== 'SOLO' && story.requiredFraming
        ? `\n\nYou must frame your ownership of this story using language consistent with: "${story.requiredFraming}"`
        : '';
    return [
      `Interviewer just asked: "${interviewerQuestion}"`,
      `Story facts to answer from — title: ${story.title}; engagement: ${story.engagement}; ownership: ${story.ownership}; details: ${story.summary}${framingNote}`,
      'Answer as Tony now.',
    ].join('\n\n');
  }

  private groundingStory(
    topic: TopicWithStories,
    turnIndex: number,
  ): StoryModel {
    return topic.stories[turnIndex % topic.stories.length];
  }

  async runTurnPair(params: {
    topic: TopicWithStories;
    conversationId?: string;
    history: HistoryTurn[];
    hashedIp: string;
    emit: EmitFn;
  }): Promise<void> {
    const { topic, history, hashedIp, emit } = params;

    const isNewConversation = !params.conversationId || history.length === 0;
    const conversationId = isNewConversation
      ? randomUUID()
      : (params.conversationId as string);
    const turnIndex = isNewConversation
      ? 0
      : await this.nextTurnIndex(conversationId);

    const story = this.groundingStory(topic, turnIndex);

    try {
      emit('turn_start', { role: 'interviewer' });
      const interviewerResult = await this.anthropic.streamMessage({
        system: INTERVIEWER_SYSTEM_PROMPT,
        userMessage: this.buildInterviewerUserMessage(topic, story, history),
        maxTokens: 150,
        onToken: (text) => emit('token', { text }),
      });

      emit('turn_start', { role: 'tony' });
      const tonyResult = await this.anthropic.streamMessage({
        system: TONY_SYSTEM_PROMPT,
        userMessage: this.buildTonyUserMessage(story, interviewerResult.text),
        maxTokens: 400,
        onToken: (text) => emit('token', { text }),
      });

      await this.prisma.$transaction([
        this.prisma.conversationTurn.create({
          data: {
            conversationId,
            topicId: topic.id,
            turnIndex,
            role: ConversationRole.INTERVIEWER,
            text: interviewerResult.text,
            tokenCount:
              interviewerResult.inputTokens + interviewerResult.outputTokens,
            hashedIp,
          },
        }),
        this.prisma.conversationTurn.create({
          data: {
            conversationId,
            topicId: topic.id,
            turnIndex,
            role: ConversationRole.TONY,
            text: tonyResult.text,
            tokenCount: tonyResult.inputTokens + tonyResult.outputTokens,
            hashedIp,
          },
        }),
      ]);

      emit('turn_end', { conversationId, turnIndex, isFinal: false });
    } catch (error) {
      emit('turn_error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

function formatHistory(history: HistoryTurn[]): string {
  return history
    .map(
      (turn) =>
        `${turn.role === 'interviewer' ? 'Interviewer' : 'Tony'}: ${turn.text}`,
    )
    .join('\n');
}
