import { HttpException, HttpStatus } from '@nestjs/common';
import { DailyUsageService } from './daily-usage.service';
import type { PrismaService } from '../prisma/prisma.service';

// The real PrismaService pulls in the generated client and the pg adapter;
// these tests must never touch a database, so the module is stubbed and the
// service gets a hand-rolled prisma double instead.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

// Pin the clock so `utcDateOnly(new Date())` inside the service resolves to a
// known date the assertions can name exactly.
const NOW = new Date('2026-09-20T12:34:56Z');
const TODAY = new Date(Date.UTC(2026, 8, 20));

function makePrisma() {
  return {
    dailyUsageCounter: {
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

describe('DailyUsageService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: DailyUsageService;

  const ENV_KEYS = ['DAILY_TURN_CAP', 'DAILY_TOKEN_CAP'] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = makePrisma();
    service = new DailyUsageService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('assertCapNotExceeded', () => {
    it('resolves when no counter row exists for today', async () => {
      prisma.dailyUsageCounter.findUnique.mockResolvedValue(null);

      await expect(service.assertCapNotExceeded()).resolves.toBeUndefined();
      expect(prisma.dailyUsageCounter.findUnique).toHaveBeenCalledWith({
        where: { date: TODAY },
      });
    });

    it('resolves when both counts are below their caps', async () => {
      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 299,
        tokenCount: 149_999,
      });

      await expect(service.assertCapNotExceeded()).resolves.toBeUndefined();
    });

    // The cap is `>=`, so the boundary is the last value that must still be
    // rejected. Pinned from both sides: one under passes, exactly at throws.
    it('throws 429 at exactly DAILY_TURN_CAP, and not one turn earlier', async () => {
      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 299,
        tokenCount: 0,
      });
      await expect(service.assertCapNotExceeded()).resolves.toBeUndefined();

      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 300,
        tokenCount: 0,
      });
      const error = await captureRejection(service.assertCapNotExceeded());
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it('throws 429 at exactly DAILY_TOKEN_CAP, and not one token earlier', async () => {
      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 0,
        tokenCount: 149_999,
      });
      await expect(service.assertCapNotExceeded()).resolves.toBeUndefined();

      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 0,
        tokenCount: 150_000,
      });
      const error = await captureRejection(service.assertCapNotExceeded());
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it('enforces an env-configured cap rather than the default', async () => {
      process.env.DAILY_TURN_CAP = '10';
      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 10,
        tokenCount: 0,
      });

      const error = await captureRejection(service.assertCapNotExceeded());
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    // The regression the pre-deploy gate caught. turnCount and tokenCount are
    // Prisma `Int`, so Postgres int4 — they cannot exceed 2147483647. A cap
    // above that can never be reached by `counter.tokenCount >= tokenCap`,
    // which is the same fail-open as the NaN it replaced, reached by an extra
    // run of zeros instead of a typo. It must be refused, not enforced.
    it.each([
      ['one past the int4 ceiling', '2147483648'],
      ['a fat-fingered run of zeros', '99999999999999999999'],
      ['scientific notation', '1e21'],
    ])('refuses a DAILY_TOKEN_CAP that is %s', async (_label, raw) => {
      process.env.DAILY_TOKEN_CAP = raw;
      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        // The most the column can physically hold. If the cap is honoured at
        // this value the backstop is dead, because no real counter can exceed it.
        turnCount: 0,
        tokenCount: 2_147_483_647,
      });

      const error = await captureRejection(service.assertCapNotExceeded());
      expect((error as Error).message).toMatch(/DAILY_TOKEN_CAP/);
    });

    it('still enforces a cap set exactly at the int4 ceiling', async () => {
      process.env.DAILY_TOKEN_CAP = '2147483647';
      prisma.dailyUsageCounter.findUnique.mockResolvedValue({
        date: TODAY,
        turnCount: 0,
        tokenCount: 2_147_483_647,
      });

      const error = await captureRejection(service.assertCapNotExceeded());
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });
  });

  describe('incrementOp', () => {
    it('upserts today row, creating with the deltas and incrementing an existing one', () => {
      service.incrementOp(1, 250);

      expect(prisma.dailyUsageCounter.upsert).toHaveBeenCalledWith({
        where: { date: TODAY },
        create: { date: TODAY, turnCount: 1, tokenCount: 250 },
        update: {
          turnCount: { increment: 1 },
          tokenCount: { increment: 250 },
        },
      });
    });
  });
});
