import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { utcDateOnly } from '../../common/utils/date.util';
import {
  BETA_GLOBAL_DAILY_CAP,
  BETA_IP_DAILY_CAP,
  DEMO_BUDGET_MESSAGE,
  IP_LIMIT_MESSAGE,
} from './beta.constants';

export type BetaStatus = {
  available: boolean;
  reason: 'ok' | 'daily_cap';
};

@Injectable()
export class BetaUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /beta/status: lets the page pre-warn a spent demo budget (AC-5). */
  async getStatus(): Promise<BetaStatus> {
    const counter = await this.prisma.betaDailyUsageCounter.findUnique({
      where: { date: utcDateOnly(new Date()) },
    });
    const capped = !!counter && counter.planCount >= BETA_GLOBAL_DAILY_CAP;
    return { available: !capped, reason: capped ? 'daily_cap' : 'ok' };
  }

  /**
   * Checked before any AI call and before the SSE stream opens, so limit
   * hits surface as plain HTTP errors: 503 at the global cap, 429 at the
   * per-IP daily cap (AC-5). The in-memory throttler (3/hour) runs earlier,
   * at the guard layer.
   */
  async assertAvailable(hashedIp: string): Promise<void> {
    const date = utcDateOnly(new Date());
    const [global, perIp] = await Promise.all([
      this.prisma.betaDailyUsageCounter.findUnique({ where: { date } }),
      this.prisma.betaIpDailyCount.findUnique({
        where: { hashedIp_date: { hashedIp, date } },
      }),
    ]);

    if (global && global.planCount >= BETA_GLOBAL_DAILY_CAP) {
      throw new ServiceUnavailableException(DEMO_BUDGET_MESSAGE);
    }
    if (perIp && perIp.count >= BETA_IP_DAILY_CAP) {
      throw new HttpException(IP_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Atomically reserves one global plan slot BEFORE any model call, so
   * concurrent requests cannot race past the 40/day cap (the cap check and
   * the increment used to be seconds apart — audit finding). The WHERE
   * clause makes Postgres serialize competitors on the row lock: the
   * request that takes the last slot wins, the rest see count 0.
   * Returns true when a slot was reserved.
   */
  async reserveGlobalSlot(): Promise<boolean> {
    const date = utcDateOnly(new Date());
    await this.prisma.betaDailyUsageCounter.upsert({
      where: { date },
      create: { date },
      update: {},
    });
    const { count } = await this.prisma.betaDailyUsageCounter.updateMany({
      where: { date, planCount: { lt: BETA_GLOBAL_DAILY_CAP } },
      data: { planCount: { increment: 1 } },
    });
    return count > 0;
  }

  /**
   * Returns a reserved slot on any non-success outcome (red flag, refusal,
   * failure), preserving the spec's success-only counter semantics: after
   * the refund, planCount reflects completed plans only (AC-8). A crash
   * between reserve and refund leaks one slot until midnight UTC —
   * accepted; it errs toward spending less.
   */
  async refundGlobalSlot(): Promise<void> {
    const date = utcDateOnly(new Date());
    await this.prisma.betaDailyUsageCounter.updateMany({
      where: { date, planCount: { gt: 0 } },
      data: { planCount: { decrement: 1 } },
    });
  }

  /**
   * Success-only bookkeeping, run only after the coach finishes: the global
   * slot is already reserved, so the global row gains tokens only; the
   * per-IP row counts one more successful plan (AC-6, AC-8).
   */
  successIncrementOps(
    hashedIp: string,
    tokenDelta: number,
  ): Prisma.PrismaPromise<unknown>[] {
    const date = utcDateOnly(new Date());
    return [
      this.prisma.betaDailyUsageCounter.upsert({
        where: { date },
        create: { date, planCount: 1, tokenCount: tokenDelta },
        update: { tokenCount: { increment: tokenDelta } },
      }),
      this.prisma.betaIpDailyCount.upsert({
        where: { hashedIp_date: { hashedIp, date } },
        create: { hashedIp, date, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ];
  }
}
