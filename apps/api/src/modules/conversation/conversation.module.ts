import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { DailyUsageModule } from '../daily-usage/daily-usage.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AnthropicModule, DailyUsageModule],
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
