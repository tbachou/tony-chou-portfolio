import { HttpException, ServiceUnavailableException } from '@nestjs/common';
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

    it('returns false when the guarded update matches no row (cap reached)', async () => {
      prisma.betaDailyUsageCounter.upsert.mockResolvedValue({});
      prisma.betaDailyUsageCounter.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reserveGlobalSlot()).resolves.toBe(false);
    });
  });

  describe('refundGlobalSlot', () => {
    it('decrements with a planCount > 0 guard so refunds can never go negative', async () => {
      prisma.betaDailyUsageCounter.updateMany.mockResolvedValue({ count: 1 });

      await service.refundGlobalSlot();

      expect(prisma.betaDailyUsageCounter.updateMany).toHaveBeenCalledWith({
        where: { date: TODAY, planCount: { gt: 0 } },
        data: { planCount: { decrement: 1 } },
      });
    });
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
    });

    it('resolves when both counters are under their caps', async () => {
      prisma.betaDailyUsageCounter.findUnique.mockResolvedValue({
        planCount: BETA_GLOBAL_DAILY_CAP - 1,
      });
      prisma.betaIpDailyCount.findUnique.mockResolvedValue({
        count: BETA_IP_DAILY_CAP - 1,
      });

      await expect(service.assertAvailable('hash')).resolves.toBeUndefined();
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
