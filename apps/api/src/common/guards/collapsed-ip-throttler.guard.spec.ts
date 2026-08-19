import { CollapsedIpThrottlerGuard } from './collapsed-ip-throttler.guard';
import { rateLimitIdentity } from '../utils/ip-hash.util';

/**
 * The base ThrottlerGuard constructor demands the throttler module's own
 * injection tokens, so the guard is built prototypically instead — only the
 * overridden getTracker hook runs (same technique as
 * beta-throttler.guard.spec.ts, which this file was extracted alongside).
 */
type GuardInternals = {
  getTracker(req: Record<string, unknown>): Promise<string>;
};

function makeGuard(): GuardInternals {
  return Object.create(
    CollapsedIpThrottlerGuard.prototype,
  ) as GuardInternals;
}

describe('CollapsedIpThrottlerGuard', () => {
  describe('getTracker', () => {
    it('tracks IPv4 addresses as-is', async () => {
      const guard = makeGuard();
      await expect(guard.getTracker({ ip: '203.0.113.9' })).resolves.toBe(
        '203.0.113.9',
      );
    });

    it('collapses IPv6 addresses to their /64 prefix', async () => {
      const guard = makeGuard();
      await expect(
        guard.getTracker({ ip: '2001:db8:12:34:aa:bb:cc:dd' }),
      ).resolves.toBe(rateLimitIdentity('2001:db8:12:34:aa:bb:cc:dd'));
    });

    it('falls back to a shared "unknown" identity when req.ip is missing or empty', async () => {
      const guard = makeGuard();
      await expect(guard.getTracker({})).resolves.toBe('unknown');
      await expect(guard.getTracker({ ip: '' })).resolves.toBe('unknown');
    });
  });
});
