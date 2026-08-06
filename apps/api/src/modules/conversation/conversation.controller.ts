import {
  BadRequestException,
  Controller,
  InternalServerErrorException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConversationService, HistoryTurn } from './conversation.service';
import { hashIp, resolveClientIp } from './ip-hash.util';
import { writeSseEvent } from './sse.util';

type ConversationTurnRequestBody = {
  topicId?: string;
  conversationId?: string;
  history?: HistoryTurn[];
};

@Controller('conversation')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post('turn')
  async turn(@Req() req: Request, @Res() res: Response): Promise<void> {
    const body = req.body as ConversationTurnRequestBody;

    if (!body?.topicId || typeof body.topicId !== 'string') {
      throw new BadRequestException('topicId is required');
    }

    const topic = await this.conversationService.resolveTopic(body.topicId);
    if (!topic) {
      throw new BadRequestException('topicId does not match any seeded Topic');
    }
    if (topic.stories.length === 0) {
      throw new InternalServerErrorException('Topic has no mapped stories');
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured',
      );
    }

    const hashedIp = hashIp(resolveClientIp(req));
    const history = body.history ?? [];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await this.conversationService.runTurnPair({
      topic,
      conversationId: body.conversationId,
      history,
      hashedIp,
      emit: (event, data) => writeSseEvent(res, event, data),
    });

    res.end();
  }
}
