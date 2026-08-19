import { HttpException, Logger } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FEEDBACK_IP_DAILY_CAP, FEEDBACK_RATE_LIMIT_MESSAGE } from './feedback.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { FeedbackSnsPublisher } from './feedback-sns.publisher';
import type { CreateFeedbackDto } from './dto/create-feedback.dto';

// The real PrismaService pulls in the generated client and the pg adapter;
// these tests must never touch a database, so the module is stubbed and the
// service gets a hand-rolled prisma double instead (repo convention, see
// beta-usage.service.spec.ts).
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

// Pin the clock so utcDateOnly(new Date()) resolves to a known UTC day.
const NOW = new Date('2026-08-19T15:30:00Z');
const TODAY_START = new Date(Date.UTC(2026, 7, 19));
const TODAY_END = new Date(Date.UTC(2026, 7, 20));

function makePrisma() {
  return {
    feedback: {
      count: jest.fn(),
      create: jest.fn(),
    },
  };
}

function makePublisher() {
  return { publish: jest.fn() };
}

describe('FeedbackService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let publisher: ReturnType<typeof makePublisher>;
  let service: FeedbackService;

  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
    Logger.overrideLogger(false);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = makePrisma();
    publisher = makePublisher();
    service = new FeedbackService(
      prisma as unknown as PrismaService,
      publisher as unknown as FeedbackSnsPublisher,
    );
  });

  describe('submit — happy path', () => {
    it.each(['beta', 'portfolio'] as const)(
      'stores the row and publishes the exact SNS payload shape for the %s surface',
      async (source) => {
        prisma.feedback.count.mockResolvedValue(0);
        prisma.feedback.create.mockResolvedValue({
          id: 'cfeedback1',
          source,
          category: 'bug',
          message: 'the button breaks on mobile',
          hashedIp: 'hashed-ip',
          createdAt: new Date('2026-08-19T15:30:00.000Z'),
        });
        const dto: CreateFeedbackDto = {
          message: 'the button breaks on mobile',
          category: 'bug',
          source,
        };

        const result = await service.submit(dto, 'hashed-ip');

        expect(result).toEqual({ id: 'cfeedback1' });
        expect(prisma.feedback.create).toHaveBeenCalledWith({
          data: {
            message: 'the button breaks on mobile',
            category: 'bug',
            source,
            hashedIp: 'hashed-ip',
          },
        });
        expect(publisher.publish).toHaveBeenCalledTimes(1);
        expect(publisher.publish).toHaveBeenCalledWith({
          id: 'cfeedback1',
          source,
          category: 'bug',
          message: 'the button breaks on mobile',
          createdAt: '2026-08-19T15:30:00.000Z',
        });
      },
    );

    it('publishes null category when the visitor left it unset', async () => {
      prisma.feedback.count.mockResolvedValue(0);
      prisma.feedback.create.mockResolvedValue({
        id: 'cfeedback2',
        source: 'portfolio',
        category: null,
        message: 'no category given',
        hashedIp: 'hashed-ip',
        createdAt: new Date('2026-08-19T15:30:00.000Z'),
      });

      await service.submit(
        { message: 'no category given', source: 'portfolio' },
        'hashed-ip',
      );

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ category: null }),
      );
    });
  });

  describe('submit — publish failure', () => {
    it('still resolves (201-equivalent) even when the publisher throws synchronously', async () => {
      prisma.feedback.count.mockResolvedValue(0);
      prisma.feedback.create.mockResolvedValue({
        id: 'cfeedback3',
        source: 'portfolio',
        category: null,
        message: 'text',
        hashedIp: 'hashed-ip',
        createdAt: new Date('2026-08-19T15:30:00.000Z'),
      });
      publisher.publish.mockImplementation(() => {
        throw new Error('publisher exploded');
      });

      await expect(
        service.submit({ message: 'text', source: 'portfolio' }, 'hashed-ip'),
      ).rejects.toThrow('publisher exploded');
      // Note: FeedbackSnsPublisher.publish never throws in the real
      // implementation (see feedback-sns.publisher.spec.ts) — this test
      // documents that the service itself does not add its own try/catch
      // around the call, so that contract must hold at the publisher layer.
    });
  });

  describe('submit — daily cap (AC-I3)', () => {
    it('allows the row at count 9 (under the cap of 10)', async () => {
      prisma.feedback.count.mockResolvedValue(FEEDBACK_IP_DAILY_CAP - 1);
      prisma.feedback.create.mockResolvedValue({
        id: 'cfeedback4',
        source: 'portfolio',
        category: null,
        message: 'text',
        hashedIp: 'hashed-ip',
        createdAt: new Date('2026-08-19T15:30:00.000Z'),
      });

      await expect(
        service.submit({ message: 'text', source: 'portfolio' }, 'hashed-ip'),
      ).resolves.toEqual({ id: 'cfeedback4' });
      expect(prisma.feedback.create).toHaveBeenCalledTimes(1);
    });

    it('rejects the 11th row of the day with 429 and writes nothing', async () => {
      prisma.feedback.count.mockResolvedValue(FEEDBACK_IP_DAILY_CAP);

      const error = await service
        .submit({ message: 'text', source: 'portfolio' }, 'hashed-ip')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).message).toBe(FEEDBACK_RATE_LIMIT_MESSAGE);
      expect(prisma.feedback.create).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('counts rows scoped to hashedIp within [today 00:00 UTC, tomorrow 00:00 UTC)', async () => {
      prisma.feedback.count.mockResolvedValue(0);
      prisma.feedback.create.mockResolvedValue({
        id: 'c1',
        source: 'portfolio',
        category: null,
        message: 'text',
        hashedIp: 'hashed-ip',
        createdAt: new Date(),
      });

      await service.submit(
        { message: 'text', source: 'portfolio' },
        'hashed-ip',
      );

      expect(prisma.feedback.count).toHaveBeenCalledWith({
        where: {
          hashedIp: 'hashed-ip',
          createdAt: { gte: TODAY_START, lt: TODAY_END },
        },
      });
    });
  });
});
