import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module.js';
import { DailyUsageModule } from '../daily-usage/daily-usage.module.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';

@Module({
  imports: [AnthropicModule, DailyUsageModule],
  // ConversationService injects BOTH exports of AnthropicModule, on purpose.
  // Generation goes through the AI_PROVIDER token, so this is the surface the
  // provider-swap flag actually moves (spec 0005 provider-swap child). The
  // credential check injects the concrete AnthropicService instead, because a
  // check that fails closed must not follow that flag (spec 0013 AC-9).
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
