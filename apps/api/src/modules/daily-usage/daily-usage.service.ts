import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { utcDateOnly } from '../../common/utils/date.util';
import { readNumericEnv } from '../../common/config/env.config';

@Injectable()
export class DailyUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 429 if today's turn or token backstop is already exceeded. */
  async assertCapNotExceeded(): Promise<void> {
    const counter = await this.prisma.dailyUsageCounter.findUnique({
      where: { date: utcDateOnly(new Date()) },
    });
    // Read per call, not captured in a module const: see env.config.ts. A
    // bad value throws here rather than becoming NaN and disabling the cap,
    // and main.ts has already refused to boot on one anyway.
    const turnCap = readNumericEnv('DAILY_TURN_CAP');
    const tokenCap = readNumericEnv('DAILY_TOKEN_CAP');
    if (
      counter &&
      (counter.turnCount >= turnCap || counter.tokenCount >= tokenCap)
    ) {
      throw new HttpException(
        'Daily usage limit reached, try again tomorrow',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** A Prisma write to fold into the same $transaction that persists the turn pair. */
  incrementOp(
    turnDelta: number,
    tokenDelta: number,
  ): Prisma.PrismaPromise<unknown> {
    const date = utcDateOnly(new Date());
    return this.prisma.dailyUsageCounter.upsert({
      where: { date },
      create: { date, turnCount: turnDelta, tokenCount: tokenDelta },
      update: {
        turnCount: { increment: turnDelta },
        tokenCount: { increment: tokenDelta },
      },
    });
  }
}
