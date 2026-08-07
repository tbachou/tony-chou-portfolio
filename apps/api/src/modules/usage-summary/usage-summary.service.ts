import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { utcDaysAgo } from '../../common/utils/date.util';

const WINDOW_DAYS = 14;
const TOP_SOURCES_LIMIT = 10;

export type UsageSummaryResponse = {
  dailyTotals: { date: string; turnCount: number; tokenCount: number }[];
  topSources: { hashedIp: string; tokenCount: number }[];
};

@Injectable()
export class UsageSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<UsageSummaryResponse> {
    // 14 calendar days inclusive of today, UTC.
    const windowStart = utcDaysAgo(WINDOW_DAYS - 1);

    const dailyCounters = await this.prisma.dailyUsageCounter.findMany({
      where: { date: { gte: windowStart } },
      orderBy: { date: 'asc' },
    });
    const dailyTotals = dailyCounters.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      turnCount: row.turnCount,
      tokenCount: row.tokenCount,
    }));

    const topSourcesRaw = await this.prisma.conversationTurn.groupBy({
      by: ['hashedIp'],
      where: { createdAt: { gte: windowStart } },
      _sum: { tokenCount: true },
      orderBy: { _sum: { tokenCount: 'desc' } },
      take: TOP_SOURCES_LIMIT,
    });
    const topSources = topSourcesRaw.map((row) => ({
      hashedIp: row.hashedIp,
      tokenCount: row._sum.tokenCount ?? 0,
    }));

    return { dailyTotals, topSources };
  }
}
