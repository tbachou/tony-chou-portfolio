import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { DailyUsageModule } from '../daily-usage/daily-usage.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AnthropicModule, DailyUsageModule],
  // ConversationService injects AI_PROVIDER (exported by AnthropicModule),
  // not the concrete AnthropicService — this is the surface the provider
  // swap flag actually moves (spec 0005 provider-swap child).
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
