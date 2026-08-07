import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConversationService } from './conversation.service';
import { ConversationTurnRequestDto } from './dto/conversation-turn-request.dto';
import { hashIp, resolveClientIp } from './ip-hash.util';
import { writeSseEvent } from './sse.util';

@Controller('conversation')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post('turn')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    long: { limit: 30, ttl: 3_600_000 },
  })
  async turn(
    @Body() body: ConversationTurnRequestDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
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
    const history = body.history;

    // Resolves turnIndex, rejects an already-concluded conversation, and
    // claims the turn slot via the DB unique constraint — all before any
    // SSE stream opens, so these failures surface as plain HTTP errors.
    const prepared = await this.conversationService.prepareTurn({
      topic,
      conversationId: body.conversationId,
      history,
      hashedIp,
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await this.conversationService.generateTurnPair({
      topic,
      prepared,
      history,
      hashedIp,
      emit: (event, data) => writeSseEvent(res, event, data),
    });

    res.end();
  }
}
