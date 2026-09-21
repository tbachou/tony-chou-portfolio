import { Module } from '@nestjs/common';
import { DailyUsageService } from './daily-usage.service.js';

@Module({
  providers: [DailyUsageService],
  exports: [DailyUsageService],
})
export class DailyUsageModule {}
