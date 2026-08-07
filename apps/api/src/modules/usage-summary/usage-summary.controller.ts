import { Controller, Get } from '@nestjs/common';
import {
  UsageSummaryResponse,
  UsageSummaryService,
} from './usage-summary.service';

// Deliberately no @AllowAnonymous(): protected by the global auth guard
// (AuthModule.forRoot in app.module.ts) by default. Any valid better-auth
// session reaches this, which is sufficient since sign-up is permanently
// disabled — the single seeded admin is the only account that can ever exist.
@Controller('internal/usage')
export class UsageSummaryController {
  constructor(private readonly usageSummaryService: UsageSummaryService) {}

  @Get('summary')
  getSummary(): Promise<UsageSummaryResponse> {
    return this.usageSummaryService.getSummary();
  }
}
