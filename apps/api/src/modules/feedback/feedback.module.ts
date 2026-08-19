import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { FeedbackSnsPublisher } from './feedback-sns.publisher';
import { FeedbackThrottlerGuard } from './feedback-throttler.guard';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackSnsPublisher, FeedbackThrottlerGuard],
})
export class FeedbackModule {}
