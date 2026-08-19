import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { rateLimitIdentity } from '../utils/ip-hash.util';

/**
 * Same throttling rules as the stock guard, but tracked by IPv6 /64 prefix
 * instead of the full address, so rotating addresses inside one home
 * allocation does not mint fresh rate-limit identities (Beta security
 * audit). IPv4 behavior is unchanged.
 *
 * Extracted from BetaThrottlerGuard (spec 0005 feedback-intake, Decision:
 * "Throttle identity") so the hourly throttle and any persisted daily cap
 * key on the same collapsed identity, and this logic exists once. Guards
 * that need extra behavior (usage tallying, etc.) extend this and override
 * further hooks; do not duplicate getTracker elsewhere.
 */
@Injectable()
export class CollapsedIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip =
      typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
    return rateLimitIdentity(ip);
  }
}
