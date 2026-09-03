import {
  conversationTurnRequestSchema,
  type ConversationTurnRequest,
} from '@portfolio/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
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
import { Throttle } from '@nestjs/throttler';
import { CollapsedIpThrottlerGuard } from '../../common/guards/collapsed-ip-throttler.guard';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import { ConversationService } from './conversation.service';
import {
  hashIp,
  rateLimitIdentity,
  resolveClientIp,
} from '../../common/utils/ip-hash.util';
import { writeSseEvent } from './sse.util';

@Controller('conversation')
@AllowAnonymous()
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post('turn')
  // The IPv6 collapsing guard, like every other public endpoint that spends
  // per request (beta, feedback, grade). The stock guard keys on the full
  // address, and one home IPv6 allocation hands out 2^64 of those, so a per
  // address limit is free to rotate past. This is the endpoint that calls the
  // model on every request and it was the one that never adopted the fix.
  @UseGuards(CollapsedIpThrottlerGuard)
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    long: { limit: 30, ttl: 3_600_000 },
  })
  async turn(
    @Body(new ZodValidationPipe(conversationTurnRequestSchema))
    body: ConversationTurnRequest,
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

    const hashedIp = hashIp(rateLimitIdentity(resolveClientIp(req)));
    // Rebuilt from the persisted rows, never echoed by the client (spec 0012
    // phase one, AC-3). Read before prepareTurn reserves this turn's slot, so
    // the empty placeholder row it writes is not part of the transcript.
    const conversation = await this.conversationService.loadConversation(
      body.conversationId,
    );

    // Resolves turnIndex, rejects an already-concluded conversation, and
    // claims the turn slot via the DB unique constraint — all before any
    // SSE stream opens, so these failures surface as plain HTTP errors.
    const prepared = await this.conversationService.prepareTurn({
      topic,
      conversationId: body.conversationId,
      conversation,
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
      history: conversation.turns,
      hashedIp,
      emit: (event, data) => writeSseEvent(res, event, data),
    });

    res.end();
  }
}
