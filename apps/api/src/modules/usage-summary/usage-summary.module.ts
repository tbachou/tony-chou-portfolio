import { Module } from '@nestjs/common';
import { UsageSummaryController } from './usage-summary.controller.js';
import { UsageSummaryService } from './usage-summary.service.js';

@Module({
  controllers: [UsageSummaryController],
  providers: [UsageSummaryService],
})
export class UsageSummaryModule {}
