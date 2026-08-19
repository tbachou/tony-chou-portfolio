import {
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BetaUsageService } from './beta-usage.service';
import {
  BETA_GLOBAL_DAILY_CAP,
  BETA_IP_DAILY_CAP,
  DEMO_BUDGET_MESSAGE,
  IP_LIMIT_MESSAGE,
} from './beta.constants';
import type { PrismaService } from '../prisma/prisma.service';

// The real PrismaService pulls in the generated client and the pg adapter;
// these tests must never touch a database, so the module is stubbed and the
// service gets a hand-rolled prisma double instead.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

// Pin the clock so `utcDateOnly(new Date())` inside the service resolves to
// a known date the assertions can name exactly.
const NOW = new Date('2026-08-18T12:34:56Z');
const TODAY = new Date(Date.UTC(2026, 7, 18));

function makePrisma() {
  return {
    betaDailyUsageCounter: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    betaIpDailyCount: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('BetaUsageService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: BetaUsageService;

  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
    Logger.overrideLogger(false);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = makePrisma();
    service = new BetaUsageService(prisma as unknown as PrismaService);
  });

  describe('reserveGlobalSlot', () => {
    it('reserves atomically: the WHERE itself enforces planCount < cap', async () => {
      prisma.betaDailyUsageCounter.upsert.mockResolvedValue({});
      prisma.betaDailyUsageCounter.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.reserveGlobalSlot()).resolves.toBe(true);

      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY },
        update: {},
      });
      expect(prisma.betaDailyUsageCounter.updateMany).toHaveBeenCalledWith({
        where: { date: TODAY, planCount: { lt: BETA_GLOBAL_DAILY_CAP } },
        data: { planCount: { increment: 1 } },
      });
    });

    it('returns false when the guarded update matches no row (cap reached) and tallies the raced global-cap rejection', async () => {
      prisma.betaDailyUsageCounter.upsert.mockResolvedValue({});
      prisma.betaDailyUsageCounter.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reserveGlobalSlot()).resolves.toBe(false);

      // Second upsert (after the row-ensuring one) is the tally.
      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenLastCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, globalCappedCount: 1 },
        update: { globalCappedCount: { increment: 1 } },
      });
    });

    it('does not tally globalCappedCount when a slot is reserved', async () => {
      prisma.betaDailyUsageCounter.upsert.mockResolvedValue({});
      prisma.betaDailyUsageCounter.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.reserveGlobalSlot()).resolves.toBe(true);

      // Only the row-ensuring upsert ran, no tally upsert.
      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('refundGlobalSlot', () => {
    it.each([
      ['error', 'errorCount'],
      ['red_flag', 'redFlagCount'],
      ['refusal', 'refusalCount'],
    ] as const)(
      'refunds with reason %s: decrements planCount (> 0 guard) and increments %s in the same atomic update',
      async (reason, column) => {
        prisma.betaDailyUsageCounter.updateMany.mockResolvedValue({
          count: 1,
        });

        await service.refundGlobalSlot(reason);

        expect(prisma.betaDailyUsageCounter.updateMany).toHaveBeenCalledTimes(
          1,
        );
        expect(prisma.betaDailyUsageCounter.updateMany).toHaveBeenCalledWith({
          where: { date: TODAY, planCount: { gt: 0 } },
          data: { planCount: { decrement: 1 }, [column]: { increment: 1 } },
        });
      },
    );
  });

  describe('getStatus', () => {
    it('reports available when no counter row exists yet', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue(null);
      await expect(service.getStatus()).resolves.toEqual({
        available: true,
        reason: 'ok',
      });
    });

    it('reports available just under the cap', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue({
        planCount: BETA_GLOBAL_DAILY_CAP - 1,
      });
      await expect(service.getStatus()).resolves.toEqual({
        available: true,
        reason: 'ok',
      });
    });

    it('reports daily_cap at planCount >= 40', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue({
        planCount: BETA_GLOBAL_DAILY_CAP,
      });
      await expect(service.getStatus()).resolves.toEqual({
        available: false,
        reason: 'daily_cap',
      });
    });
  });

  describe('assertAvailable', () => {
    it('throws 503 ServiceUnavailableException at the global cap', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue({
        planCount: BETA_GLOBAL_DAILY_CAP,
      });
      prisma.betaIpDailyCount.findUnique.mockResolvedValue(null);

      const error = await captureRejection(service.assertAvailable('hash'));

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).message).toBe(
        DEMO_BUDGET_MESSAGE,
      );
      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, globalCappedCount: 1 },
        update: { globalCappedCount: { increment: 1 } },
      });
    });

    it('throws 429 HttpException at the per-IP cap', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue({
        planCount: 5,
      });
      prisma.betaIpDailyCount.findUnique.mockResolvedValue({
        count: BETA_IP_DAILY_CAP,
      });

      const error = await captureRejection(service.assertAvailable('hash'));

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).message).toBe(IP_LIMIT_MESSAGE);
      expect(prisma.betaIpDailyCount.findUnique).toHaveBeenCalledWith({
        where: { hashedIp_date: { hashedIp: 'hash', date: TODAY } },
      });
      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, ipCappedCount: 1 },
        update: { ipCappedCount: { increment: 1 } },
      });
    });

    it.each([
      [
        'global',
        503,
        { planCount: BETA_GLOBAL_DAILY_CAP },
        null,
      ] as const,
      [
        'per-IP',
        429,
        { planCount: 5 },
        { count: BETA_IP_DAILY_CAP },
      ] as const,
    ])(
      'still rejects with %s cap status %i when the tally write itself fails',
      async (_label, status, globalRow, ipRow) => {
        prisma.betaDailyUsageCounter.findUnique.mockResolvedValue(globalRow);
        prisma.betaIpDailyCount.findUnique.mockResolvedValue(ipRow);
        prisma.betaDailyUsageCounter.upsert.mockRejectedValue(
          new Error('db down'),
        );

        const error = await captureRejection(service.assertAvailable('hash'));

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(status);
      },
    );

    it('resolves without any tally write when both counters are under their caps', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue({
        planCount: BETA_GLOBAL_DAILY_CAP - 1,
      });
      prisma.betaIpDailyCount.findUnique.mockResolvedValue({
        count: BETA_IP_DAILY_CAP - 1,
      });

      await expect(service.assertAvailable('hash')).resolves.toBeUndefined();
      expect(prisma.betaDailyUsageCounter.upsert).not.toHaveBeenCalled();
    });
  });

  describe('recordRedFlagBlock', () => {
    it('increments redFlagCount on today\'s row (the pre-reserve block paths)', async () => {
      prisma.betaDailyUsageCounter.upsert.mockResolvedValue({});

      await service.recordRedFlagBlock();

      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, redFlagCount: 1 },
        update: { redFlagCount: { increment: 1 } },
      });
    });

    it('swallows a failed write so the red-flag response is never disturbed', async () => {
      prisma.betaDailyUsageCounter.upsert.mockRejectedValue(
        new Error('db down'),
      );

      await expect(service.recordRedFlagBlock()).resolves.toBeUndefined();
    });
  });

  describe('recordThrottled', () => {
    it('increments throttledCount on today\'s row', async () => {
      prisma.betaDailyUsageCounter.upsert.mockResolvedValue({});

      await service.recordThrottled();

      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, throttledCount: 1 },
        update: { throttledCount: { increment: 1 } },
      });
    });

    it('never rejects, even when the write fails (fire-and-forget contract)', async () => {
      prisma.betaDailyUsageCounter.upsert.mockRejectedValue(
        new Error('db down'),
      );

      await expect(service.recordThrottled()).resolves.toBeUndefined();
    });
  });

  describe('successIncrementOps', () => {
    it('increments tokenCount only on the global row (slot already reserved) and count on the per-IP row', () => {
      prisma.betaDailyUsageCounter.upsert.mockReturnValue('global-op');
      prisma.betaIpDailyCount.upsert.mockReturnValue('ip-op');

      const ops = service.successIncrementOps('hashed-ip', 123);

      expect(ops).toEqual(['global-op', 'ip-op']);
      expect(prisma.betaDailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, planCount: 1, tokenCount: 123 },
        update: { tokenCount: { increment: 123 } },
      });
      expect(prisma.betaIpDailyCount.upsert).toHaveBeenCalledWith({
        where: { hashedIp_date: { hashedIp: 'hashed-ip', date: TODAY } },
        create: { hashedIp: 'hashed-ip', date: TODAY, count: 1 },
        update: { count: { increment: 1 } },
      });
    });
  });
});
