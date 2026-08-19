import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { CollapsedIpThrottlerGuard } from '../../common/guards/collapsed-ip-throttler.guard';
import { BetaUsageService } from './beta-usage.service';

/**
 * IPv6-collapsing throttle tracking (see CollapsedIpThrottlerGuard) plus
 * Beta's own tally on rejection.
 *
 * Every rejection also bumps the anonymous throttledCount tally for today
 * (both /beta routes use this guard, so status-endpoint hammering counts
 * too) — the in-memory limits reset on deploy, so without the tally,
 * throttle pressure is invisible in the persisted counters.
 */
@Injectable()
export class BetaThrottlerGuard extends CollapsedIpThrottlerGuard {
  // Property injection: the base guard's constructor takes the throttler's
  // own injection tokens, and redeclaring them here would couple this class
  // to those internals.
  @Inject(BetaUsageService)
  private readonly betaUsage!: BetaUsageService;

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    // Fire-and-forget: recordThrottled swallows its own failures, and the
    // extra catch keeps even a future regression from ever blocking or
    // altering the 429 below.
    void this.betaUsage.recordThrottled().catch(() => undefined);
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
