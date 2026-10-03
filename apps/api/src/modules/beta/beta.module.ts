import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module.js';
import { BetaController } from './beta.controller.js';
import { BetaService } from './beta.service.js';
import { BetaUsageService } from './beta-usage.service.js';
import { BetaThrottlerGuard } from './beta-throttler.guard.js';

@Module({
  imports: [AnthropicModule],
  controllers: [BetaController],
  providers: [BetaService, BetaUsageService, BetaThrottlerGuard],
})
export class BetaModule {}
