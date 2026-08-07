import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { utcDateOnly } from '../../common/utils/date.util';

const DAILY_TURN_CAP = Number(process.env.DAILY_TURN_CAP ?? 300);
const DAILY_TOKEN_CAP = Number(process.env.DAILY_TOKEN_CAP ?? 150000);

@Injectable()
export class DailyUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 429 if today's turn or token backstop is already exceeded. */
  async assertCapNotExceeded(): Promise<void> {
    const counter = await this.prisma.dailyUsageCounter.findUnique({
      where: { date: utcDateOnly(new Date()) },
    });
    if (
      counter &&
      (counter.turnCount >= DAILY_TURN_CAP ||
        counter.tokenCount >= DAILY_TOKEN_CAP)
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
