import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module.js';
import { DailyUsageModule } from '../daily-usage/daily-usage.module.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';

@Module({
  imports: [AnthropicModule, DailyUsageModule],
  // ConversationService injects AI_PROVIDER (exported by AnthropicModule),
  // not the concrete AnthropicService — this is the surface the provider
  // swap flag actually moves (spec 0005 provider-swap child).
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
