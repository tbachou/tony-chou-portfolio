import { createFeedbackSchema, type CreateFeedback } from '@portfolio/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { hashIp, rateLimitIdentity, resolveClientIp } from '../../common/utils/ip-hash.util';
import { FeedbackThrottlerGuard } from './feedback-throttler.guard';
import { FeedbackService } from './feedback.service';
import { FEEDBACK_THROTTLE_LIMIT, FEEDBACK_THROTTLE_TTL_MS } from './feedback.constants';

@Controller('feedback')
@AllowAnonymous()
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @UseGuards(FeedbackThrottlerGuard)
  // 5 per hour per collapsed IP identity, in memory (AC-I3). The persisted
  // 10/day cap is enforced in the service.
  @Throttle({ long: { limit: FEEDBACK_THROTTLE_LIMIT, ttl: FEEDBACK_THROTTLE_TTL_MS } })
  async create(
    @Body(new ZodValidationPipe(createFeedbackSchema)) dto: CreateFeedback,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const hashedIp = hashIp(rateLimitIdentity(resolveClientIp(req)));
    return this.feedbackService.submit(dto, hashedIp);
  }
}
