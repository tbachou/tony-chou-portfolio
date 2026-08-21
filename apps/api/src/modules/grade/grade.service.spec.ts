import {
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GradeService, normalizeHistogram } from './grade.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { GradeAnalysisService } from './grade-analysis.service';
import type { PhotoStorageService } from '../grade-photos/photo-storage.service';
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
  objectKey: 'photos/9f2c4ab1d0e37b58.webp',
  contentType: 'image/webp',
  trueGrade: 5,
  source: 'own_photo',
  note: 'Placeholder gym, north wall',
};

/** What the storage double signs URLs as; see makeService below. */
const IMAGE_URL =
  'https://signed.example/photos/9f2c4ab1d0e37b58.webp?X-Amz-Expires=3600&X-Amz-Signature=sig';

const NOW = new Date('2026-08-20T12:00:00.000Z');
/** The UTC date NOW falls on, echoed back with every guess (AC-19). */
const TODAY = '2026-08-20';

function zeros(): number[] {
  return Array.from({ length: 9 }, () => 0);
}

/**
 * A hand-rolled Prisma double. `$queryRaw` is a tagged template, so the fake
 * takes the same shape and records the interpolated values — that is how the
 * histogram assertions read the grade the UPDATE would have incremented,
 * without a database.
 *
 * `pinned` is the GradeDay row findUnique returns: null means the date has no
 * row yet and the cycle decides, an object means it is already pinned (AC-20).
 */
function makePrisma(
  options: {
    row?: Record<string, unknown>;
    pool?: GradePhoto[];
    pinned?: { photo: GradePhoto } | null;
  } = {},
) {
  const pool = options.pool ?? [PHOTO];
  const state = {
    createCalls: [] as Record<string, unknown>[],
    queryValues: [] as unknown[][],
    rowOverride: options.row,
  };

  const prisma = {
    gradeDay: {
      findUnique: jest.fn(() => Promise.resolve(options.pinned ?? null)),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        state.createCalls.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
    gradePhoto: {
      findMany: jest.fn(() => Promise.resolve(pool)),
      findUnique: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(pool.find((p) => p.id === args.where.id) ?? null),
      ),
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

/**
 * The vision service stubbed to "no analysis available", which is the state
 * every test below except the cached-row one exercises. Tests that care about
 * the call itself live in grade-analysis.service.spec.ts.
 */
let ensureAnalysis: jest.Mock;

/** Records every object key the service asked to have signed. */
let presignGet: jest.Mock;

function makeService(prisma: PrismaService): GradeService {
  ensureAnalysis = jest.fn().mockResolvedValue(null);
  presignGet = jest.fn((key: string) =>
    Promise.resolve(
      `https://signed.example/${key}?X-Amz-Expires=3600&X-Amz-Signature=sig`,
    ),
  );
  return new GradeService(
    prisma,
    { ensureAnalysis } as unknown as GradeAnalysisService,
    { presignGet } as unknown as PhotoStorageService,
  );
}

describe('GradeService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // The empty-pool cases log a deployment error on purpose; keep it out of
    // the run's output rather than letting a passing suite look like a failing one.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    process.env.GRADE_PHOTO_BUCKET = 'portfolio-grade-photos-test';
    process.env.AWS_REGION = 'us-east-2';
    delete process.env.GRADE_GAME_ENABLED;
  });

  describe('getToday (AC-1, AC-2)', () => {
    it('returns the day, image, note and pool size', async () => {
      const { prisma } = makePrisma();

      await expect(makeService(prisma).getToday(NOW)).resolves.toEqual({
        date: '2026-08-20',
        imageUrl: IMAGE_URL,
        note: 'Placeholder gym, north wall',
        poolSize: 1,
      });
    });

    it('leaks no grade of any kind before a guess', async () => {
      const { prisma } = makePrisma();
      const today = await makeService(prisma).getToday(NOW);

      // The leak check the spec asks for: the whole serialized pre-guess
      // payload must not contain the answer or anything derived from it.
      expect(Object.keys(today).sort()).toEqual([
        'date',
        'imageUrl',
        'note',
        'poolSize',
      ]);
      // Scoped past imageUrl deliberately. The object key is opaque random
      // hex, so a digit inside it is a coincidence rather than a leak — and
      // asserting a bare digit against the whole payload is what made the
      // earlier version of this test pass by luck. What the key must not do
      // is DESCRIBE the photo, which the next test asserts directly.
      const rest: Record<string, unknown> = { ...today };
      delete rest.imageUrl;
      expect(JSON.stringify(rest)).not.toContain(String(PHOTO.trueGrade));
      expect(JSON.stringify(today)).not.toMatch(/trueGrade|model|reasoning/i);
      expect(Object.values(rest)).not.toContain(PHOTO.trueGrade);
    });

    it('leaks nothing through the object key either', async () => {
      // The spec's reason for random object keys: a key like
      // `north-gym-blue-prow` hands a climber a circuit-colour grade hint
      // before they guess, which breaks AC-2 in spirit with no grade field
      // present. The URL is part of the pre-guess surface, so it is asserted
      // on directly rather than only the response body.
      const { prisma } = makePrisma();
      const today = await makeService(prisma).getToday(NOW);

      expect(today.imageUrl).not.toContain(PHOTO.id);
      expect(today.imageUrl).toMatch(/photos\/[0-9a-f]+\.\w+/);
    });

    it('omits note entirely when the photo has none', async () => {
      const bare: GradePhoto = { ...PHOTO, id: 'b', note: null };
      const { prisma } = makePrisma({ pool: [bare] });

      await expect(
        makeService(prisma).getToday(NOW),
      ).resolves.not.toHaveProperty('note');
    });

    it('takes the image URL from the presigner, building none of its own', async () => {
      // R4 moved URL construction into PhotoStorageService, so the assertion
      // moved with it: the service's job is to hand over the right object key
      // and serve back whatever the signer returns.
      const { prisma } = makePrisma();

      const today = await makeService(prisma).getToday(NOW);

      expect(presignGet).toHaveBeenCalledTimes(1);
      expect(presignGet).toHaveBeenCalledWith(PHOTO.objectKey);
      expect(today.imageUrl).toBe(await presignGet.mock.results[0].value);
    });

    it('serves 503 rather than a broken page when no photo is active', async () => {
      const { prisma } = makePrisma({ pool: [] });

      await expect(makeService(prisma).getToday(NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('counts only eligible photos in poolSize once the game is enabled', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const { prisma } = makePrisma({
        pool: [PHOTO, { ...PHOTO, id: 'borrowed', source: 'unlicensed_test' }],
      });

      await expect(
        (await makeService(prisma).getToday(NOW)).poolSize,
      ).toBe(1);
    });

    it('asks the database only for active photos (AC-1)', async () => {
      const { prisma } = makePrisma();

      await makeService(prisma).getToday(NOW);

      expect(prisma.gradePhoto.findMany).toHaveBeenCalledWith({
        where: { active: true },
      });
    });
  });

  describe('the presigned image URL (AC-14, AC-2)', () => {
    it('signs the day photo rather than exposing a plain object URL', async () => {
      const { prisma } = makePrisma();

      const today = await makeService(prisma).getToday(NOW);

      expect(presignGet).toHaveBeenCalledWith(PHOTO.objectKey);
      expect(today.imageUrl).toContain('X-Amz-Signature');
    });

    it('signs exactly the pinned photo, not a recomputed one', async () => {
      const retired: GradePhoto = { ...PHOTO, id: 'retired', objectKey: 'photos/old.webp' };
      const { prisma } = makePrisma({
        pool: [{ ...PHOTO, id: 'newcomer', objectKey: 'photos/new.webp' }],
        pinned: { photo: retired },
      });

      await makeService(prisma).getToday(NOW);

      expect(presignGet).toHaveBeenCalledWith('photos/old.webp');
      expect(presignGet).not.toHaveBeenCalledWith('photos/new.webp');
    });

    it('still carries no grade anywhere, URL included', async () => {
      // AC-2 re-verified because the response shape changed in R4: the signed
      // URL is now part of the pre-guess surface, so it is asserted on rather
      // than only the body's own fields.
      const { prisma } = makePrisma();

      const today = await makeService(prisma).getToday(NOW);

      expect(today.imageUrl).not.toContain(PHOTO.id);
      expect(today.imageUrl).not.toMatch(/trueGrade|grade=|v[0-8]\b/i);
      expect(JSON.stringify(today)).not.toMatch(/trueGrade|model|reasoning/i);
    });
  });

  describe('the day rollover guard (AC-19)', () => {
    it('refuses a guess carrying yesterday\'s date, as a 409', async () => {
      // The status is the contract, not just the exception class: the web
      // client keys its "reload the day" branch on 409 specifically, so a
      // change to a different 4xx would silently turn the rollover recovery
      // into a plain error message.
      const { prisma } = makePrisma();

      const rejection = await makeService(prisma)
        .submitGuess(3, '2026-08-19', NOW)
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(ConflictException);
      expect((rejection as ConflictException).getStatus()).toBe(409);
    });

    it('refuses tomorrow\'s date too, not just an older one', async () => {
      const { prisma } = makePrisma();

      await expect(
        makeService(prisma).submitGuess(3, '2026-08-21', NOW),
      ).rejects.toThrow(ConflictException);
    });

    it('writes nothing at all when the date is stale', async () => {
      // The guess must not land in any histogram: not yesterday's, and not
      // today's. Refusing before the row is touched is what guarantees it.
      const { prisma } = makePrisma();

      await expect(
        makeService(prisma).submitGuess(3, '2026-08-19', NOW),
      ).rejects.toThrow(ConflictException);

      expect(prisma.gradeDay.create).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.gradePhoto.findMany).not.toHaveBeenCalled();
    });

    it('accepts a guess made at the very start of the UTC day', async () => {
      const firstMoment = new Date('2026-08-20T00:00:00.000Z');

      const { prisma } = makePrisma();
      const reveal = await makeService(prisma).submitGuess(5, TODAY, firstMoment);

      expect(reveal.date).toBe(TODAY);
    });

    it('accepts a guess made at the very end of the UTC day', async () => {
      const lastMoment = new Date('2026-08-20T23:59:59.999Z');

      const { prisma } = makePrisma();
      const reveal = await makeService(prisma).submitGuess(5, TODAY, lastMoment);

      expect(reveal.date).toBe(TODAY);
    });

    it('refuses the 23:55 open, 00:02 guess that AC-19 exists for', async () => {
      // Shown 2026-08-20 at 23:55, submitted two minutes after midnight. The
      // photo has changed underneath; grading it against the new one would
      // score the visitor on a problem they never saw.
      const justAfterMidnight = new Date('2026-08-21T00:02:00.000Z');

      const { prisma } = makePrisma();

      await expect(
        makeService(prisma).submitGuess(5, '2026-08-20', justAfterMidnight),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('the pinned day (AC-20)', () => {
    it('serves the row\'s photo even after that photo is deactivated', async () => {
      // The pool no longer contains the pinned photo at all, which is what a
      // mid-day deactivation looks like from here. The date must not move.
      const retired: GradePhoto = { ...PHOTO, id: 'retired', trueGrade: 8 };
      const { prisma } = makePrisma({
        pool: [{ ...PHOTO, id: 'newcomer', trueGrade: 1 }],
        pinned: { photo: retired },
      });

      const today = await makeService(prisma).getToday(NOW);

      expect(today.imageUrl).toContain(retired.objectKey);
      expect(prisma.gradePhoto.findMany).toHaveBeenCalled();
    });

    it('grades against the pinned photo, not a freshly recomputed cycle', async () => {
      const retired: GradePhoto = { ...PHOTO, id: 'retired', trueGrade: 8 };
      const { prisma } = makePrisma({
        pool: [{ ...PHOTO, id: 'newcomer', trueGrade: 1 }],
        pinned: { photo: retired },
        row: { photoId: 'retired' },
      });

      const reveal = await makeService(prisma).submitGuess(8, TODAY, NOW);

      // Truth comes from the pinned photo (V8), so a correct guess scores 0.
      // Against the newcomer (V1) this would have been a distance of 7.
      expect(reveal.trueGrade).toBe(8);
      expect(reveal.yourDistance).toBe(0);
    });

    it('re-reads the photo when the row pinned a different one than resolved', async () => {
      // The narrow race: a concurrent first guess created the row while the
      // pool was changing, so the row disagrees with what this request
      // resolved. The row wins.
      const other: GradePhoto = { ...PHOTO, id: 'other', trueGrade: 0 };
      const { prisma } = makePrisma({
        pool: [PHOTO, other],
        row: { photoId: 'other' },
      });

      const reveal = await makeService(prisma).submitGuess(0, TODAY, NOW);

      expect(prisma.gradePhoto.findUnique).toHaveBeenCalledWith({
        where: { id: 'other' },
      });
      expect(reveal.trueGrade).toBe(0);
    });

    it('does not re-read the photo when the row agrees with the cycle', async () => {
      const { prisma } = makePrisma();

      await makeService(prisma).submitGuess(3, TODAY, NOW);

      expect(prisma.gradePhoto.findUnique).not.toHaveBeenCalled();
    });

    it('serves 503 if the row points at a photo that is gone', async () => {
      const { prisma } = makePrisma({ row: { photoId: 'vanished' } });

      await expect(makeService(prisma).submitGuess(3, TODAY, NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('the licence gate (AC-18)', () => {
    it('never pins an unlicensed test photo once the game is enabled', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const borrowed: GradePhoto = {
        ...PHOTO,
        id: 'aaa-borrowed',
        source: 'unlicensed_test',
      };
      // Sorted first, so a cycle that ignored the gate would be likely to pick it.
      const { prisma, state } = makePrisma({ pool: [borrowed, PHOTO] });

      await makeService(prisma).submitGuess(3, TODAY, NOW);

      expect(state.createCalls).toEqual([
        { date: '2026-08-20', photoId: PHOTO.id },
      ]);
    });

    it('logs one line naming how many were excluded', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { prisma } = makePrisma({
        pool: [PHOTO, { ...PHOTO, id: 'b1', source: 'unlicensed_test' }],
      });

      await makeService(prisma).getToday(NOW);

      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain('1 unlicensed_test');
      expect(log.mock.calls[0][0]).toContain('2026-08-20');
    });

    it('logs once per UTC date rather than once per request', async () => {
      // The line has to be fresh (a boot-time count goes stale the moment a
      // photo is toggled), but repeating it on every request until the day's
      // row exists would be noise.
      process.env.GRADE_GAME_ENABLED = 'true';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { prisma } = makePrisma({
        pool: [PHOTO, { ...PHOTO, id: 'b1', source: 'unlicensed_test' }],
      });
      const service = makeService(prisma);

      await service.getToday(NOW);
      await service.getToday(NOW);
      await service.getToday(new Date('2026-08-21T12:00:00.000Z'));

      expect(log).toHaveBeenCalledTimes(2);
    });

    it('says nothing when the gate excluded nothing', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { prisma } = makePrisma();

      await makeService(prisma).getToday(NOW);

      expect(log).not.toHaveBeenCalled();
    });

    it('serves 503 when the gate empties the pool', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const { prisma } = makePrisma({
        pool: [{ ...PHOTO, source: 'unlicensed_test' }],
      });

      await expect(makeService(prisma).getToday(NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('submitGuess (AC-3, AC-6)', () => {
    it('returns truth, distances and the histogram on a fresh day', async () => {
      const { prisma, state } = makePrisma();

      const reveal = await makeService(prisma).submitGuess(3, TODAY, NOW);

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

      const reveal = await makeService(prisma).submitGuess(4, TODAY, NOW);

      expect(reveal.model).toBeNull();
      expect(reveal.modelDistance).toBeNull();
    });

    it('asks for the day\'s vision call when the row has no analysis', async () => {
      const { prisma } = makePrisma();

      await makeService(prisma).submitGuess(4, TODAY, NOW);

      expect(ensureAnalysis).toHaveBeenCalledWith({
        date: '2026-08-20',
        imageUrl: IMAGE_URL,
      });
    });

    it('serves a freshly produced analysis in the same response', async () => {
      const { prisma } = makePrisma();
      const service = makeService(prisma);
      ensureAnalysis.mockResolvedValue({
        grade: 6,
        confidence: 'low',
        observations: ['dark photo'],
        reasoning: 'Hard to read.',
      });

      const reveal = await service.submitGuess(4, TODAY, NOW);

      expect(reveal.model?.grade).toBe(6);
      expect(reveal.modelDistance).toBe(1);
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

      const reveal = await makeService(prisma).submitGuess(4, TODAY, NOW);

      expect(reveal.model).toEqual({
        grade: 7,
        confidence: 'high',
        observations: ['small crimps', 'steep prow'],
        reasoning: 'Holds are tiny and the wall is past vertical.',
      });
      // |7 - 5|, the model's own distance from truth.
      expect(reveal.modelDistance).toBe(2);
      // Cached means cached: no second call is made or paid for (AC-4).
      expect(ensureAnalysis).not.toHaveBeenCalled();
    });

    it('scores a perfect guess as distance zero', async () => {
      const { prisma } = makePrisma();

      const reveal = await makeService(prisma).submitGuess(5, TODAY, NOW);

      expect(reveal.yourDistance).toBe(0);
    });

    it('increments the slot for the guessed grade, and plays, in one statement', async () => {
      const { prisma, state } = makePrisma();

      await makeService(prisma).submitGuess(6, TODAY, NOW);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // The interpolated values are [guess, date] in template order.
      expect(state.queryValues[0]).toEqual([6, '2026-08-20']);
      const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0].join('?');
      expect(sql).toContain('"plays" = "plays" + 1');
      expect(sql).toContain('UPDATE "GradeDay"');
    });

    it('sends nothing a visitor supplied to the database beyond the integer', async () => {
      const { prisma, state } = makePrisma();

      await makeService(prisma).submitGuess(2, TODAY, NOW);

      // AC-6: the only visitor-derived value that reaches Prisma at all is
      // the grade integer itself.
      const everything = [
        ...state.createCalls.flatMap((c) => Object.values(c)),
        ...state.queryValues.flat(),
      ];
      expect(everything).toEqual(['2026-08-20', 'seed-a', 2, '2026-08-20']);
    });

    it('serves 503 rather than writing anything when no photo is active', async () => {
      const { prisma } = makePrisma({ pool: [] });

      await expect(makeService(prisma).submitGuess(1, TODAY, NOW)).rejects.toThrow(
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

      const service = makeService(prisma);
      const [a, b] = await Promise.all([
        service.submitGuess(3, TODAY, NOW),
        service.submitGuess(4, TODAY, NOW),
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
        makeService(prisma).submitGuess(1, TODAY, NOW),
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
