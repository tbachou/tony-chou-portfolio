import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { BetaController } from './beta.controller';
import { BetaService } from './beta.service';
import { BetaUsageService } from './beta-usage.service';

@Module({
  imports: [AnthropicModule],
  controllers: [BetaController],
  providers: [BetaService, BetaUsageService],
})
export class BetaModule {}
