import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { rateLimitIdentity } from '../../common/utils/ip-hash.util';
import { BetaUsageService } from './beta-usage.service';

/**
 * Same throttling rules as the stock guard, but tracked by IPv6 /64 prefix
 * instead of the full address, so rotating addresses inside one home
 * allocation does not mint fresh rate-limit identities (Beta security
 * audit). IPv4 behavior is unchanged.
 *
 * Every rejection also bumps the anonymous throttledCount tally for today
 * (both /beta routes use this guard, so status-endpoint hammering counts
 * too) — the in-memory limits reset on deploy, so without the tally,
 * throttle pressure is invisible in the persisted counters.
 */
@Injectable()
export class BetaThrottlerGuard extends ThrottlerGuard {
  // Property injection: the base guard's constructor takes the throttler's
  // own injection tokens, and redeclaring them here would couple this class
  // to those internals.
  @Inject(BetaUsageService)
  private readonly betaUsage!: BetaUsageService;

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip =
      typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
    return rateLimitIdentity(ip);
  }

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
