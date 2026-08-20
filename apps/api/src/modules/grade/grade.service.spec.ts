import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { GradeService, normalizeHistogram } from './grade.service';
import type { PrismaService } from '../prisma/prisma.service';
import * as pool from './photo-pool';
import type { GradePhoto } from './photo-pool';

// The real PrismaService pulls in the generated client and the pg adapter;
// these tests must never touch a database, so the module is stubbed and the
// service gets a hand-rolled prisma double instead (repo convention, see
// feedback.service.spec.ts).
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

const PHOTO: GradePhoto = {
  id: 'seed-a',
  file: 'seed-a.png',
  trueGrade: 5,
  note: 'Placeholder gym, north wall',
};

const NOW = new Date('2026-08-20T12:00:00.000Z');

function zeros(): number[] {
  return Array.from({ length: 9 }, () => 0);
}

/**
 * A hand-rolled Prisma double. `$queryRaw` is a tagged template, so the fake
 * takes the same shape and records the interpolated values — that is how the
 * histogram assertions read the grade the UPDATE would have incremented,
 * without a database.
 */
function makePrisma(options: { row?: Record<string, unknown> } = {}) {
  const state = {
    createCalls: [] as Record<string, unknown>[],
    queryValues: [] as unknown[][],
    createError: null as unknown,
    rowOverride: options.row,
  };

  const prisma = {
    gradeDay: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        state.createCalls.push(args.data);
        if (state.createError) return Promise.reject(state.createError);
        return Promise.resolve(args.data);
      }),
    },
    $queryRaw: jest.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      state.queryValues.push(values);
      const guess = values[0] as number;
      const counts = zeros();
      counts[guess] = 1;
      return Promise.resolve([
        {
          date: '2026-08-20',
          photoId: PHOTO.id,
          modelGrade: null,
          modelConfidence: null,
          observations: [],
          reasoning: null,
          guessCounts: counts,
          plays: 1,
          ...state.rowOverride,
        },
      ]);
    }),
  };

  return { prisma: prisma as unknown as PrismaService, state };
}

describe('GradeService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // The empty-pool cases log a deployment error on purpose; keep it out of
    // the run's output rather than letting a passing suite look like a failing one.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(pool, 'loadPhotoManifest').mockReturnValue([PHOTO]);
    jest.spyOn(pool, 'photoForDate').mockReturnValue(PHOTO);
    jest.spyOn(pool, 'sortedPool').mockReturnValue([PHOTO]);
    process.env.CORS_ORIGIN = 'https://tonychou.dev';
  });

  describe('getToday (AC-1, AC-2)', () => {
    it('returns the day, image, note and pool size', () => {
      const { prisma } = makePrisma();

      expect(new GradeService(prisma).getToday(NOW)).toEqual({
        date: '2026-08-20',
        imageUrl: 'https://tonychou.dev/grade/seed-a.png',
        note: 'Placeholder gym, north wall',
        poolSize: 1,
      });
    });

    it('leaks no grade of any kind before a guess', () => {
      const { prisma } = makePrisma();
      const today = new GradeService(prisma).getToday(NOW);

      // The leak check the spec asks for: the whole serialized pre-guess
      // payload must not contain the answer or anything derived from it.
      expect(Object.keys(today).sort()).toEqual([
        'date',
        'imageUrl',
        'note',
        'poolSize',
      ]);
      expect(JSON.stringify(today)).not.toContain(String(PHOTO.trueGrade));
      expect(JSON.stringify(today)).not.toMatch(/trueGrade|model|reasoning/i);
    });

    it('omits note entirely when the manifest entry has none', () => {
      const bare: GradePhoto = { id: 'b', file: 'b.png', trueGrade: 2 };
      jest.spyOn(pool, 'photoForDate').mockReturnValue(bare);
      const { prisma } = makePrisma();

      expect(new GradeService(prisma).getToday(NOW)).not.toHaveProperty('note');
    });

    it('builds the image URL from CORS_ORIGIN, taking the first entry', () => {
      process.env.CORS_ORIGIN = 'https://tonychou.dev,https://www.tonychou.dev';
      const { prisma } = makePrisma();

      expect(new GradeService(prisma).getToday(NOW).imageUrl).toBe(
        'https://tonychou.dev/grade/seed-a.png',
      );
    });

    it('serves 503 rather than a broken page when the pool is empty', () => {
      jest.spyOn(pool, 'photoForDate').mockReturnValue(null);
      const { prisma } = makePrisma();

      expect(() => new GradeService(prisma).getToday(NOW)).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('submitGuess (AC-3, AC-6)', () => {
    it('returns truth, distances and the histogram on a fresh day', async () => {
      const { prisma, state } = makePrisma();

      const reveal = await new GradeService(prisma).submitGuess(3, NOW);

      expect(reveal.trueGrade).toBe(5);
      expect(reveal.yourGuess).toBe(3);
      expect(reveal.yourDistance).toBe(2);
      expect(reveal.plays).toBe(1);
      expect(reveal.guessCounts).toHaveLength(9);
      expect(reveal.guessCounts[3]).toBe(1);
      expect(reveal.date).toBe('2026-08-20');
      expect(state.createCalls).toEqual([
        { date: '2026-08-20', photoId: 'seed-a' },
      ]);
    });

    it('reports the model as null while the day has no analysis (AC-5)', async () => {
      const { prisma } = makePrisma();

      const reveal = await new GradeService(prisma).submitGuess(4, NOW);

      expect(reveal.model).toBeNull();
      expect(reveal.modelDistance).toBeNull();
    });

    it('serves the cached analysis and its distance once the row has one', async () => {
      const { prisma } = makePrisma({
        row: {
          modelGrade: 7,
          modelConfidence: 'high',
          observations: ['small crimps', 'steep prow'],
          reasoning: 'Holds are tiny and the wall is past vertical.',
        },
      });

      const reveal = await new GradeService(prisma).submitGuess(4, NOW);

      expect(reveal.model).toEqual({
        grade: 7,
        confidence: 'high',
        observations: ['small crimps', 'steep prow'],
        reasoning: 'Holds are tiny and the wall is past vertical.',
      });
      // |7 - 5|, the model's own distance from truth.
      expect(reveal.modelDistance).toBe(2);
    });

    it('scores a perfect guess as distance zero', async () => {
      const { prisma } = makePrisma();

      const reveal = await new GradeService(prisma).submitGuess(5, NOW);

      expect(reveal.yourDistance).toBe(0);
    });

    it('increments the slot for the guessed grade, and plays, in one statement', async () => {
      const { prisma, state } = makePrisma();

      await new GradeService(prisma).submitGuess(6, NOW);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // The interpolated values are [guess, date] in template order.
      expect(state.queryValues[0]).toEqual([6, '2026-08-20']);
      const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0].join('?');
      expect(sql).toContain('"plays" = "plays" + 1');
      expect(sql).toContain('UPDATE "GradeDay"');
    });

    it('sends nothing a visitor supplied to the database beyond the integer', async () => {
      const { prisma, state } = makePrisma();

      await new GradeService(prisma).submitGuess(2, NOW);

      // AC-6: the only visitor-derived value that reaches Prisma at all is
      // the grade integer itself.
      const everything = [
        ...state.createCalls.flatMap((c) => Object.values(c)),
        ...state.queryValues.flat(),
      ];
      expect(everything).toEqual(['2026-08-20', 'seed-a', 2, '2026-08-20']);
    });

    it('serves 503 rather than writing anything when the pool is empty', async () => {
      jest.spyOn(pool, 'photoForDate').mockReturnValue(null);
      const { prisma } = makePrisma();

      await expect(new GradeService(prisma).submitGuess(1, NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(prisma.gradeDay.create).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('concurrent first guesses (AC-4)', () => {
    it('tolerates the losing insert and still tallies both guesses', async () => {
      const { prisma, state } = makePrisma();
      // The second request loses the primary-key race.
      let calls = 0;
      (prisma.gradeDay.create as jest.Mock).mockImplementation(
        (args: { data: Record<string, unknown> }) => {
          state.createCalls.push(args.data);
          calls += 1;
          if (calls === 2) {
            return Promise.reject(Object.assign(new Error('dup'), { code: 'P2002' }));
          }
          return Promise.resolve(args.data);
        },
      );

      const service = new GradeService(prisma);
      const [a, b] = await Promise.all([
        service.submitGuess(3, NOW),
        service.submitGuess(4, NOW),
      ]);

      // Neither request errors, and both get a consistent reveal.
      expect(a.trueGrade).toBe(5);
      expect(b.trueGrade).toBe(5);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('rethrows an insert failure that is not a duplicate key', async () => {
      const { prisma } = makePrisma();
      (prisma.gradeDay.create as jest.Mock).mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(
        new GradeService(prisma).submitGuess(1, NOW),
      ).rejects.toThrow('connection lost');
    });
  });
});

describe('normalizeHistogram', () => {
  it('always returns nine slots', () => {
    expect(normalizeHistogram(null)).toEqual(zeros());
    expect(normalizeHistogram([])).toHaveLength(9);
    expect(normalizeHistogram([1, 2])).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('drops anything past the ninth slot rather than widening the response', () => {
    const overlong = [...zeros(), 99];
    expect(normalizeHistogram(overlong)).toHaveLength(9);
  });
});
