import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { utcDateOnly } from '../../common/utils/date.util';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackSnsPublisher } from './feedback-sns.publisher';
import {
  FEEDBACK_IP_DAILY_CAP,
  FEEDBACK_RATE_LIMIT_MESSAGE,
} from './feedback.constants';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: FeedbackSnsPublisher,
  ) {}

  /**
   * Stores one feedback row and fires the SNS publish (AC-I1, AC-I6).
   *
   * Daily cap (AC-I3): counts existing rows for hashedIp within the current
   * UTC day and rejects with 429 before any insert once the cap is reached.
   * This is a count-then-insert check, not an atomic reserve — concurrent
   * submissions from one identity can race past 10 by a few rows. That is
   * accepted explicitly in the spec (unlike Beta's atomic reserve/refund,
   * which guards paid model calls): the stakes here are a few extra spam
   * rows, and the 5/hour in-memory throttle already bounds the burst
   * window. Do not "fix" this race without a spec change.
   */
  async submit(dto: CreateFeedbackDto, hashedIp: string): Promise<{ id: string }> {
    const dayStart = utcDateOnly(new Date());
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const todayCount = await this.prisma.feedback.count({
      where: { hashedIp, createdAt: { gte: dayStart, lt: dayEnd } },
    });
    if (todayCount >= FEEDBACK_IP_DAILY_CAP) {
      throw new HttpException(
        FEEDBACK_RATE_LIMIT_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const row = await this.prisma.feedback.create({
      data: {
        message: dto.message,
        category: dto.category,
        source: dto.source,
        hashedIp,
      },
    });

    // Fire and forget (AC-I6): the visitor's response never depends on AWS
    // availability. Exact payload shape from the spec's Decision section.
    this.publisher.publish({
      id: row.id,
      source: row.source,
      category: row.category,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    });

    return { id: row.id };
  }
}
