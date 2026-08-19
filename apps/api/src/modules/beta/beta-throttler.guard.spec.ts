import type { ExecutionContext } from '@nestjs/common';
import {
  ThrottlerException,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import { BetaThrottlerGuard } from './beta-throttler.guard';
import { rateLimitIdentity } from '../../common/utils/ip-hash.util';

// The guard's BetaUsageService injection pulls in PrismaService, whose real
// module drags in the generated Prisma client and the pg adapter; these
// tests must never touch a database.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

/**
 * The base ThrottlerGuard constructor demands the throttler module's own
 * injection tokens, so the guard is built prototypically instead: only the
 * two overridden methods run, plus the base fields they reach
 * (getErrorMessage reads `options` and `errorMessage`).
 */
type GuardInternals = {
  betaUsage: { recordThrottled: jest.Mock };
  options: Record<string, unknown>;
  errorMessage: string;
  getTracker(req: Record<string, unknown>): Promise<string>;
  throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void>;
};

function makeGuard(
  recordThrottled: jest.Mock = jest.fn().mockResolvedValue(undefined),
) {
  const guard = Object.create(
    BetaThrottlerGuard.prototype,
  ) as unknown as GuardInternals;
  guard.betaUsage = { recordThrottled };
  guard.options = {}; // no errorMessage option → base falls back to `errorMessage`
  guard.errorMessage = 'Too Many Requests';
  return { guard, recordThrottled };
}

const CONTEXT = {} as ExecutionContext;
const DETAIL = {} as ThrottlerLimitDetail;

describe('BetaThrottlerGuard', () => {
  describe('getTracker', () => {
    it('tracks by rate-limit identity (IPv6 collapses to its /64 prefix)', async () => {
      const { guard } = makeGuard();

      await expect(guard.getTracker({ ip: '203.0.113.9' })).resolves.toBe(
        '203.0.113.9',
      );
      await expect(
        guard.getTracker({ ip: '2001:db8:12:34:aa:bb:cc:dd' }),
      ).resolves.toBe(rateLimitIdentity('2001:db8:12:34:aa:bb:cc:dd'));
    });

    it('falls back to a shared "unknown" identity when req.ip is missing or empty', async () => {
      const { guard } = makeGuard();

      await expect(guard.getTracker({})).resolves.toBe('unknown');
      await expect(guard.getTracker({ ip: '' })).resolves.toBe('unknown');
    });
  });

  describe('throwThrottlingException', () => {
    it('tallies throttledCount fire-and-forget and still throws the ThrottlerException', async () => {
      const { guard, recordThrottled } = makeGuard();

      await expect(
        guard.throwThrottlingException(CONTEXT, DETAIL),
      ).rejects.toBeInstanceOf(ThrottlerException);
      expect(recordThrottled).toHaveBeenCalledTimes(1);
    });

    it('rejects with the unaltered 429 even when the tally write fails', async () => {
      const { guard } = makeGuard(
        jest.fn().mockRejectedValue(new Error('db down')),
      );

      const error: unknown = await guard
        .throwThrottlingException(CONTEXT, DETAIL)
        .then(() => {
          throw new Error('expected the guard to throw');
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ThrottlerException);
      expect((error as ThrottlerException).getStatus()).toBe(429);
      expect((error as ThrottlerException).message).toBe('Too Many Requests');
    });
  });
});
