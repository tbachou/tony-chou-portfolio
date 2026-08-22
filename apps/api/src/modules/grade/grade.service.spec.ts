import {
  GoneException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GradeService, normalizeHistogram } from './grade.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { GradeAnalysisService } from './grade-analysis.service';
import type { PhotoStorageService } from '../grade-photos/photo-storage.service';
import { publicIdFor, type GradePhoto } from './photo-pool';

// The real PrismaService pulls in the generated client and the pg adapter;
// these tests must never touch a database, so the module is stubbed and the
// service gets a hand-rolled prisma double instead (repo convention, see
// feedback.service.spec.ts).
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

const PHOTO: GradePhoto & { active: boolean } = {
  id: 'seed-a',
  objectKey: 'photos/9f2c4ab1d0e37b58.webp',
  contentType: 'image/webp',
  trueGrade: 5,
  source: 'own_photo',
  note: 'Placeholder gym, north wall',
  active: true,
};

/** The opaque id the outside world addresses PHOTO by (AC-23). */
const PUBLIC_ID = publicIdFor(PHOTO.objectKey);

function zeros(): number[] {
  return Array.from({ length: 9 }, () => 0);
}

function photo(
  id: string,
  objectKey: string,
  overrides: Partial<GradePhoto & { active: boolean }> = {},
): GradePhoto & { active: boolean } {
  return {
    id,
    objectKey,
    contentType: 'image/webp',
    trueGrade: 4,
    source: 'own_photo',
    active: true,
    ...overrides,
  };
}

/**
 * A hand-rolled Prisma double. `$queryRaw` is a tagged template, so the fake
 * takes the same shape and records the interpolated values — that is how the
 * histogram assertions read the grade the UPDATE would have incremented,
 * without a database.
 *
 * `gradePhoto.findUnique` resolves by `objectKey` rather than by id, because
 * that is the lookup the public id maps onto: the unique index that already
 * exists is what makes "no publicId column" work (AC-23).
 */
function makePrisma(
  options: {
    row?: Record<string, unknown>;
    pool?: (GradePhoto & { active: boolean })[];
  } = {},
) {
  const pool = options.pool ?? [PHOTO];
  const state = {
    createCalls: [] as Record<string, unknown>[],
    queryValues: [] as unknown[][],
    findManyArgs: [] as Record<string, unknown>[],
    rowOverride: options.row,
    /** photoIds that already have a GradeProblem row, as the table would. */
    rows: new Set<string>(),
  };

  const prisma = {
    gradeProblem: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const photoId = args.data.photoId as string;
        state.createCalls.push(args.data);
        if (state.rows.has(photoId)) {
          return Promise.reject(
            Object.assign(new Error('dup'), { code: 'P2002' }),
          );
        }
        state.rows.add(photoId);
        return Promise.resolve(args.data);
      }),
    },
    gradePhoto: {
      findMany: jest.fn((args: Record<string, unknown>) => {
        state.findManyArgs.push(args);
        return Promise.resolve(pool.filter((p) => p.active));
      }),
      findUnique: jest.fn((args: { where: { objectKey: string } }) =>
        Promise.resolve(
          pool.find((p) => p.objectKey === args.where.objectKey) ?? null,
        ),
      ),
    },
    $queryRaw: jest.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      state.queryValues.push(values);
      const guess = values[0] as number;
      const counts = zeros();
      counts[guess] = 1;
      return Promise.resolve([
        {
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
/** Records every object key the service read bytes from for the vision call. */
let getBytes: jest.Mock;

function makeService(prisma: PrismaService): GradeService {
  ensureAnalysis = jest.fn().mockResolvedValue(null);
  presignGet = jest.fn((key: string) =>
    Promise.resolve(
      `https://signed.example/${key}?X-Amz-Expires=3600&X-Amz-Signature=sig`,
    ),
  );
  getBytes = jest.fn(() => Promise.resolve(Buffer.from('image-bytes')));
  return new GradeService(
    prisma,
    { ensureAnalysis } as unknown as GradeAnalysisService,
    { presignGet, getBytes } as unknown as PhotoStorageService,
  );
}

describe('GradeService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    process.env.GRADE_PHOTO_BUCKET = 'portfolio-grade-photos-test';
    process.env.AWS_REGION = 'us-east-2';
    delete process.env.GRADE_GAME_ENABLED;
  });

  describe('listProblems (AC-22, AC-2)', () => {
    it('returns every eligible problem once, as public ids and a count', async () => {
      const { prisma } = makePrisma({
        pool: [
          photo('a', 'photos/aaaaaaaaaaaaaaaa.webp'),
          photo('b', 'photos/bbbbbbbbbbbbbbbb.webp'),
        ],
      });

      const list = await makeService(prisma).listProblems();

      expect(list.count).toBe(2);
      expect(list.problems).toEqual([
        { publicId: 'aaaaaaaaaaaaaaaa' },
        { publicId: 'bbbbbbbbbbbbbbbb' },
      ]);
    });

    it('orders by createdAt ascending, so additions append rather than reshuffle', async () => {
      // The ordering is the database's job, not a sort here: a visitor part
      // way through the set must not have positions move under them when the
      // owner uploads (AC-22).
      const { prisma, state } = makePrisma();

      await makeService(prisma).listProblems();

      expect(state.findManyArgs[0]).toMatchObject({
        where: { active: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('leaks no grade of any kind, and no slug', async () => {
      const { prisma } = makePrisma();

      const list = await makeService(prisma).listProblems();

      // Structural rather than a substring sweep: a public id is hex, so it
      // legitimately contains digits and "does the payload contain a 5" would
      // be meaningless. What matters is that a problem carries exactly one
      // field, and that neither the answer nor the slug is anywhere in it.
      expect(Object.keys(list.problems[0])).toEqual(['publicId']);
      const serialized = JSON.stringify(list);
      expect(serialized).not.toContain('trueGrade');
      expect(serialized).not.toContain('modelGrade');
      expect(serialized).not.toContain(PHOTO.id);
      expect(serialized).not.toContain(PHOTO.note);
    });

    it('never asks the database for the answer columns at all (AC-2)', async () => {
      // Cheaper than remembering to strip: the pre-guess path does not read
      // trueGrade, so it cannot return it by accident.
      const { prisma, state } = makePrisma();

      await makeService(prisma).listProblems();

      const select = (state.findManyArgs[0] as { select: Record<string, unknown> })
        .select;
      expect(Object.keys(select).sort()).toEqual(['objectKey', 'source']);
    });

    it('carries no image URL, so ten problems do not mint ten presigns (AC-25)', async () => {
      const { prisma } = makePrisma({
        pool: [
          photo('a', 'photos/aaaaaaaaaaaaaaaa.webp'),
          photo('b', 'photos/bbbbbbbbbbbbbbbb.webp'),
        ],
      });

      const list = await makeService(prisma).listProblems();

      expect(JSON.stringify(list)).not.toContain('http');
      expect(presignGet).not.toHaveBeenCalled();
    });

    it('creates nothing: the read is a pure read', async () => {
      // The daily version pinned a row here. A fixed set never asks which
      // photo is today, so there is nothing to pin (the dropped AC-21).
      const { prisma, state } = makePrisma();

      await makeService(prisma).listProblems();

      expect(state.createCalls).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('serves an empty set as 200 with an empty array, not an error', async () => {
      // An empty pool is the owner not having uploaded yet, not a server
      // fault, so the page says so rather than showing a failure.
      const { prisma } = makePrisma({ pool: [] });

      await expect(makeService(prisma).listProblems()).resolves.toEqual({
        problems: [],
        count: 0,
      });
    });

    it('omits an inactive photo from the set', async () => {
      const { prisma } = makePrisma({
        pool: [
          photo('a', 'photos/aaaaaaaaaaaaaaaa.webp'),
          photo('b', 'photos/bbbbbbbbbbbbbbbb.webp', { active: false }),
        ],
      });

      const list = await makeService(prisma).listProblems();

      expect(list.problems).toEqual([{ publicId: 'aaaaaaaaaaaaaaaa' }]);
    });
  });

  describe('the licence gate (AC-18)', () => {
    const borrowed = photo('borrowed', 'photos/cccccccccccccccc.webp', {
      source: 'unlicensed_test',
    });

    it('never serves an unlicensed test photo once the game is enabled', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const { prisma } = makePrisma({ pool: [PHOTO, borrowed] });

      const list = await makeService(prisma).listProblems();

      expect(list.problems).toEqual([{ publicId: PUBLIC_ID }]);
      expect(list.count).toBe(1);
    });

    it('serves it while the game is still hidden', async () => {
      const { prisma } = makePrisma({ pool: [PHOTO, borrowed] });

      const list = await makeService(prisma).listProblems();

      expect(list.count).toBe(2);
    });

    it('logs one line naming how many were excluded', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { prisma } = makePrisma({ pool: [PHOTO, borrowed] });

      await makeService(prisma).listProblems();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('1 unlicensed_test photo(s) excluded'),
      );
    });

    it('logs once per process rather than once per request', async () => {
      // Was throttled per UTC date, because the set resolved per day. There
      // are no days now, so the throttle is a plain flag — but it still is not
      // computed at startup, where a photo toggled without a redeploy would
      // leave the count lying.
      process.env.GRADE_GAME_ENABLED = 'true';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { prisma } = makePrisma({ pool: [PHOTO, borrowed] });
      const service = makeService(prisma);

      await service.listProblems();
      await service.listProblems();
      await service.listProblems();

      expect(log).toHaveBeenCalledTimes(1);
    });

    it('says nothing when the gate excluded nothing', async () => {
      process.env.GRADE_GAME_ENABLED = 'true';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { prisma } = makePrisma();

      await makeService(prisma).listProblems();

      expect(log).not.toHaveBeenCalled();
    });

    it('refuses to sign a borrowed photo\'s image, as a 404', async () => {
      // Indistinguishable from a problem that does not exist, rather than
      // confirming a hidden one is there.
      process.env.GRADE_GAME_ENABLED = 'true';
      const { prisma } = makePrisma({ pool: [PHOTO, borrowed] });

      await expect(
        makeService(prisma).getProblemImage(publicIdFor(borrowed.objectKey)),
      ).rejects.toThrow(NotFoundException);
      expect(presignGet).not.toHaveBeenCalled();
    });

    it('refuses to spend a vision call on a borrowed photo', async () => {
      // The deepest form of "reaching a released game" AC-18 exists to stop.
      process.env.GRADE_GAME_ENABLED = 'true';
      const { prisma, state } = makePrisma({ pool: [PHOTO, borrowed] });

      await expect(
        makeService(prisma).submitGuess(4, publicIdFor(borrowed.objectKey)),
      ).rejects.toThrow(NotFoundException);
      expect(state.createCalls).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(ensureAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('getProblemImage (AC-25, AC-14, AC-2)', () => {
    it('mints a presigned URL for exactly that problem', async () => {
      const { prisma } = makePrisma();

      const image = await makeService(prisma).getProblemImage(PUBLIC_ID);

      expect(presignGet).toHaveBeenCalledWith(PHOTO.objectKey);
      expect(image.imageUrl).toContain('X-Amz-Signature');
    });

    it('takes the URL from the presigner, building none of its own', async () => {
      const { prisma } = makePrisma();
      const service = makeService(prisma);
      presignGet.mockResolvedValue('https://signed.example/whatever');

      const image = await service.getProblemImage(PUBLIC_ID);

      expect(image.imageUrl).toBe('https://signed.example/whatever');
    });

    it('leaks nothing through the object key either', async () => {
      // The presigned URL contains the key, so a slug-derived key would hand
      // over the gym circuit colour — and with it the grade band — before the
      // guess. Random keys are what close that (AC-2).
      const { prisma } = makePrisma();

      const image = await makeService(prisma).getProblemImage(PUBLIC_ID);

      expect(image.imageUrl).not.toContain('seed-a');
      expect(image.imageUrl).not.toContain('blue');
      expect(JSON.stringify(image)).not.toContain('trueGrade');
    });

    it('404s an id that resolves to no photo', async () => {
      const { prisma } = makePrisma();

      await expect(
        makeService(prisma).getProblemImage('0000000000000000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('410s a photo the owner retired', async () => {
      const { prisma } = makePrisma({
        pool: [photo('a', 'photos/aaaaaaaaaaaaaaaa.webp', { active: false })],
      });

      await expect(
        makeService(prisma).getProblemImage('aaaaaaaaaaaaaaaa'),
      ).rejects.toThrow(GoneException);
    });

    it('looks the photo up by object key, which is the indexed unique column', async () => {
      const { prisma } = makePrisma();

      await makeService(prisma).getProblemImage(PUBLIC_ID);

      expect(prisma.gradePhoto.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { objectKey: PHOTO.objectKey },
        }),
      );
    });
  });

  describe('submitGuess (AC-3, AC-6, AC-23)', () => {
    it('returns truth, distances and the histogram on a fresh problem', async () => {
      const { prisma, state } = makePrisma();

      const reveal = await makeService(prisma).submitGuess(3, PUBLIC_ID);

      expect(reveal.trueGrade).toBe(5);
      expect(reveal.yourGuess).toBe(3);
      expect(reveal.yourDistance).toBe(2);
      expect(reveal.plays).toBe(1);
      expect(reveal.guessCounts).toHaveLength(9);
      expect(reveal.guessCounts[3]).toBe(1);
      expect(reveal.publicId).toBe(PUBLIC_ID);
      expect(state.createCalls).toEqual([{ photoId: 'seed-a' }]);
    });

    it('resolves the problem from the public id, never the slug', async () => {
      const { prisma } = makePrisma();

      await makeService(prisma).submitGuess(3, PUBLIC_ID);

      expect(prisma.gradePhoto.findUnique).toHaveBeenCalledWith({
        where: { objectKey: PHOTO.objectKey },
      });
    });

    it('404s a public id that matches no photo', async () => {
      const { prisma, state } = makePrisma();

      await expect(
        makeService(prisma).submitGuess(3, '0000000000000000'),
      ).rejects.toThrow(NotFoundException);
      expect(state.createCalls).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('still answers a guess on a photo retired since the set was loaded', async () => {
      // Only the list filters on `active`. A visitor who loaded the set and
      // guessed after the owner retired that photo is answered rather than
      // errored: the retirement is not their problem, and the answer is not
      // wrong.
      const { prisma } = makePrisma({
        pool: [
          photo('a', 'photos/aaaaaaaaaaaaaaaa.webp', {
            active: false,
            trueGrade: 6,
          }),
        ],
      });

      const reveal = await makeService(prisma).submitGuess(6, 'aaaaaaaaaaaaaaaa');

      expect(reveal.trueGrade).toBe(6);
      expect(reveal.yourDistance).toBe(0);
    });

    it('reports the model as null while the problem has no analysis (AC-5)', async () => {
      const { prisma } = makePrisma();

      const reveal = await makeService(prisma).submitGuess(4, PUBLIC_ID);

      expect(reveal.model).toBeNull();
      expect(reveal.modelDistance).toBeNull();
    });

    it('sends the image BYTES to the vision call, never a URL', async () => {
      const { prisma } = makePrisma();

      await makeService(prisma).submitGuess(4, PUBLIC_ID);

      // Bytes, not a URL (AC-15): read from the problem's own object and
      // base64 encoded, which is the form both providers accept.
      expect(getBytes).toHaveBeenCalledWith(PHOTO.objectKey);
      expect(ensureAnalysis).toHaveBeenCalledWith({
        photoId: PHOTO.id,
        publicId: PUBLIC_ID,
        image: {
          data: Buffer.from('image-bytes').toString('base64'),
          mediaType: PHOTO.contentType,
        },
      });
    });

    it('still reveals when the photo bytes cannot be read, without failing the counted guess', async () => {
      // The tally lands before the analysis is resolved, so an escaping error
      // here would 500 a guess that WAS counted, and the page tells the
      // visitor to retry, counting it again. A byte-read failure is just a
      // problem whose analysis has not landed yet (AC-5).
      const { prisma } = makePrisma();
      const service = makeService(prisma);
      getBytes.mockRejectedValueOnce(new Error('S3 unavailable'));

      const reveal = await service.submitGuess(4, PUBLIC_ID);

      expect(reveal.model).toBeNull();
      expect(reveal.modelDistance).toBeNull();
      expect(reveal.trueGrade).toBe(PHOTO.trueGrade);
      expect(ensureAnalysis).not.toHaveBeenCalled();
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

      const reveal = await service.submitGuess(4, PUBLIC_ID);

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

      const reveal = await makeService(prisma).submitGuess(4, PUBLIC_ID);

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

      const reveal = await makeService(prisma).submitGuess(5, PUBLIC_ID);

      expect(reveal.yourDistance).toBe(0);
    });

    it('increments the slot for the guessed grade, and plays, in one statement', async () => {
      const { prisma, state } = makePrisma();

      await makeService(prisma).submitGuess(6, PUBLIC_ID);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // The interpolated values are [guess, photoId] in template order.
      expect(state.queryValues[0]).toEqual([6, 'seed-a']);
      const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0].join('?');
      expect(sql).toContain('"plays" = "plays" + 1');
      expect(sql).toContain('UPDATE "GradeProblem"');
      expect(sql).toContain('WHERE "photoId"');
    });

    it('sends nothing a visitor supplied to the database beyond the integer', async () => {
      const { prisma, state } = makePrisma();

      await makeService(prisma).submitGuess(2, PUBLIC_ID);

      // AC-6: the only visitor-derived value that reaches Prisma at all is the
      // grade integer. The public id is resolved to a server-side row first,
      // and it is the row's own photoId that travels onward, never the string
      // the request supplied.
      const everything = [
        ...state.createCalls.flatMap((c) => Object.values(c)),
        ...state.queryValues.flat(),
      ];
      expect(everything).toEqual(['seed-a', 2, 'seed-a']);
    });

    it('counts the guess exactly once per request whatever the vision call does', async () => {
      const { prisma } = makePrisma();
      const service = makeService(prisma);
      ensureAnalysis.mockRejectedValueOnce(new Error('never thrown in practice'));

      await expect(service.submitGuess(4, PUBLIC_ID)).rejects.toThrow();
      // The tally still ran exactly once: the guard is that nothing below
      // recordGuess may throw, and this documents what happens if it ever did.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent first guesses (AC-4)', () => {
    it('tolerates the losing insert and still tallies both guesses', async () => {
      const { prisma } = makePrisma();
      const service = makeService(prisma);

      const [a, b] = await Promise.all([
        service.submitGuess(3, PUBLIC_ID),
        service.submitGuess(4, PUBLIC_ID),
      ]);

      // Neither request errors, and both get a consistent reveal. Unlike the
      // daily version, the loser has nothing to go and re-read: both requests
      // named the same problem, so they already hold the same photo.
      expect(a.trueGrade).toBe(5);
      expect(b.trueGrade).toBe(5);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('rethrows an insert failure that is not a duplicate key', async () => {
      const { prisma } = makePrisma();
      (prisma.gradeProblem.create as jest.Mock).mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(
        makeService(prisma).submitGuess(1, PUBLIC_ID),
      ).rejects.toThrow('connection lost');
    });

    it('does not count a guess whose row could not be created', async () => {
      const { prisma } = makePrisma();
      (prisma.gradeProblem.create as jest.Mock).mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(
        makeService(prisma).submitGuess(1, PUBLIC_ID),
      ).rejects.toThrow();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('serves 503 if the row vanishes between the insert and the tally', async () => {
      const { prisma } = makePrisma();
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(
        makeService(prisma).submitGuess(1, PUBLIC_ID),
      ).rejects.toThrow(ServiceUnavailableException);
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
