import { Module } from '@nestjs/common';
import { UsageSummaryController } from './usage-summary.controller';
import { UsageSummaryService } from './usage-summary.service';

@Module({
  controllers: [UsageSummaryController],
  providers: [UsageSummaryService],
})
export class UsageSummaryModule {}
