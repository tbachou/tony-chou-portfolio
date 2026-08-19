import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
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

/** Why a reserved global slot is being returned (each maps to a counter column). */
export type RefundReason = 'error' | 'red_flag' | 'refusal';

/**
 * Anonymous outcome/abuse tally columns on BetaDailyUsageCounter. Pure
 * counts of blocked/failed outcomes and rate-limit rejections — never
 * visitor content (AC-6 unchanged).
 */
type OutcomeColumn =
  | 'errorCount'
  | 'redFlagCount'
  | 'refusalCount'
  | 'throttledCount'
  | 'ipCappedCount'
  | 'globalCappedCount';

const REFUND_REASON_COLUMN: Record<RefundReason, OutcomeColumn> = {
  error: 'errorCount',
  red_flag: 'redFlagCount',
  refusal: 'refusalCount',
};

@Injectable()
export class BetaUsageService {
  private readonly logger = new Logger(BetaUsageService.name);

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
      await this.safeIncrement('globalCappedCount');
      throw new ServiceUnavailableException(DEMO_BUDGET_MESSAGE);
    }
    if (perIp && perIp.count >= BETA_IP_DAILY_CAP) {
      await this.safeIncrement('ipCappedCount');
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
    if (count === 0) {
      // The cap filled between assertAvailable and this reserve (rare race):
      // the visitor still sees the demo-budget message, so it counts as a
      // global-cap rejection like the 503 path.
      await this.safeIncrement('globalCappedCount');
    }
    return count > 0;
  }

  /**
   * Returns a reserved slot on any non-success outcome, preserving the
   * spec's success-only counter semantics: after the refund, planCount
   * reflects completed plans only (AC-8). The same atomic update tallies
   * WHY the slot came back (errorCount / redFlagCount / refusalCount), so
   * the outcome count can never drift from the refund. A crash between
   * reserve and refund leaks one slot until midnight UTC — accepted; it
   * errs toward spending less.
   */
  async refundGlobalSlot(reason: RefundReason): Promise<void> {
    const date = utcDateOnly(new Date());
    await this.prisma.betaDailyUsageCounter.updateMany({
      where: { date, planCount: { gt: 0 } },
      data: {
        planCount: { decrement: 1 },
        [REFUND_REASON_COLUMN[reason]]: { increment: 1 },
      },
    });
  }

  /**
   * Counts a code-enforced red-flag block (checked symptom or constant
   * rest-pain escalation). Those paths return before any slot is reserved,
   * so they never reach refundGlobalSlot — without this, "how many visitors
   * were told to see a professional" would undercount its cheapest, most
   * common path. Never throws: a lost tally must not disturb the response.
   */
  recordRedFlagBlock(): Promise<void> {
    return this.safeIncrement('redFlagCount');
  }

  /**
   * Counts an in-memory throttle rejection (fired-and-forgotten by
   * BetaThrottlerGuard). Never rejects, so callers may safely not await it.
   */
  recordThrottled(): Promise<void> {
    return this.safeIncrement('throttledCount');
  }

  /**
   * Upserts today's row with one outcome-column increment. Swallows and
   * logs failures (name only, per the logging convention) so an
   * observability write can never mask the response it annotates.
   */
  private async safeIncrement(column: OutcomeColumn): Promise<void> {
    const date = utcDateOnly(new Date());
    try {
      await this.prisma.betaDailyUsageCounter.upsert({
        where: { date },
        create: { date, [column]: 1 },
        update: { [column]: { increment: 1 } },
      });
    } catch (error) {
      this.logger.warn(
        `Beta ${column} increment failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
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
