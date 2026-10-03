import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';
import { FeedbackSnsPublisher } from './feedback-sns.publisher.js';
import { FeedbackThrottlerGuard } from './feedback-throttler.guard.js';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackSnsPublisher, FeedbackThrottlerGuard],
})
export class FeedbackModule {}
