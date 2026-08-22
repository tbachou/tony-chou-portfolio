import {
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PhotoStorageService } from '../grade-photos/photo-storage.service';
import { GradeAnalysisService } from './grade-analysis.service';
import {
  GRADE_SLOTS,
  gradeGameEnabled,
  type GradeConfidence,
} from './grade.constants';
import {
  objectKeyFor,
  partitionPool,
  publicIdFor,
  UNLICENSED_TEST,
  type GradePhoto,
} from './photo-pool';

/**
 * One problem as the pre-guess list names it (AC-22, AC-23).
 *
 * A public id and nothing else. Not the slug, not the true grade, not a model
 * field, and not an image URL either — the image is minted per problem when
 * the page actually shows it (AC-25), so a visitor who reads two problems
 * mints two URLs rather than ten.
 */
export type GradeProblemSummary = {
  publicId: string;
};

export type GradeProblemList = {
  problems: GradeProblemSummary[];
  count: number;
};

/** One problem's image, minted at the moment it is shown (AC-25). */
export type GradeProblemImage = {
  /** Presigned S3 GET, one hour lifetime. */
  imageUrl: string;
};

export type GradeModelAnalysis = {
  grade: number;
  confidence: GradeConfidence;
  observations: string[];
  reasoning: string;
};

export type GradeReveal = {
  /** Echoed back so the page can match a reveal to the problem it holds (AC-24). */
  publicId: string;
  trueGrade: number;
  /** Null while this problem's vision call has not landed yet (AC-5). */
  model: GradeModelAnalysis | null;
  guessCounts: number[];
  plays: number;
  yourGuess: number;
  yourDistance: number;
  /** Null whenever `model` is. */
  modelDistance: number | null;
  note?: string;
};

/** The subset of the GradeProblem row the guess path reads back. */
type GradeProblemRow = {
  photoId: string;
  modelGrade: number | null;
  modelConfidence: string | null;
  observations: string[];
  reasoning: string | null;
  guessCounts: number[];
  plays: number;
};

const NO_SUCH_PROBLEM_MESSAGE = 'That problem does not exist.';

const INACTIVE_PROBLEM_MESSAGE = 'That problem has been retired.';

const UNAVAILABLE_MESSAGE =
  'The game is not available right now. Please try again later.';

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  /**
   * Whether the licence exclusion has been logged by this process (AC-18).
   *
   * Was a UTC date until 2026-08-22, throttled per day because the set
   * resolved per day. There are no days now, so it is a plain once-per-process
   * flag. Still not computed at startup: a boot time count goes stale the
   * moment a photo is toggled without a redeploy, so it is emitted the first
   * time the set is actually resolved. A redeploy re-logging is fine.
   */
  private exclusionLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysis: GradeAnalysisService,
    private readonly storage: PhotoStorageService,
  ) {}

  /**
   * The whole playable set, in a stable order (AC-22).
   *
   * A pure read: it creates nothing. The daily version pinned a row here,
   * which existed only to answer "which photo is today", and a fixed set never
   * asks — the problem IS the identity now.
   *
   * `createdAt` ascending rather than by slug, so uploading a photo appends to
   * the end instead of reshuffling positions visitors may already be part way
   * through. Selects no `trueGrade` and no model field at all, so there is
   * nothing on this path to leak (AC-2).
   *
   * An empty set is 200 with an empty array, not an error: it means the owner
   * has not uploaded yet, which is not a server fault and which the page says
   * in words.
   */
  async listProblems(): Promise<GradeProblemList> {
    const active = await this.prisma.gradePhoto.findMany({
      where: { active: true },
      select: { objectKey: true, source: true },
      orderBy: { createdAt: 'asc' },
    });

    const { eligible, excluded } = partitionPool(active, gradeGameEnabled());
    this.logExclusions(excluded.length);

    return {
      problems: eligible.map((photo) => ({
        publicId: publicIdFor(photo.objectKey),
      })),
      count: eligible.length,
    };
  }

  /**
   * One problem's presigned image, minted on demand (AC-25).
   *
   * Split out of the list so the page mints a URL per problem it actually
   * shows. That keeps the count of signed URLs proportional to what is read
   * rather than to the pool size, and it keeps a one hour presign from
   * expiring under a visitor who sits on the page — each is minted at the
   * moment its problem goes on screen.
   *
   * Filters on `active` (410) and on the licence gate (404), because both
   * questions are "may this photo be shown", and this route shows it just as
   * much as the list does (AC-18).
   */
  async getProblemImage(publicId: string): Promise<GradeProblemImage> {
    const photo = await this.prisma.gradePhoto.findUnique({
      where: { objectKey: objectKeyFor(publicId) },
      select: { objectKey: true, source: true, active: true },
    });

    if (!photo || this.licenceExcluded(photo)) {
      // Same 404 for both, deliberately: an unlicensed test photo should be
      // indistinguishable from one that does not exist, rather than confirming
      // that some hidden problem is there.
      throw new NotFoundException(NO_SUCH_PROBLEM_MESSAGE);
    }
    if (!photo.active) {
      throw new GoneException(INACTIVE_PROBLEM_MESSAGE);
    }

    return { imageUrl: await this.storage.presignGet(photo.objectKey) };
  }

  /**
   * Record one guess against one problem and reveal it (AC-3).
   *
   * Order matters: the problem's row is created atomically first, then the
   * histogram and play count increment in a single statement, and only then is
   * the model analysis considered. The tally therefore lands exactly once per
   * request whatever the vision call does, which is what AC-6 asks for.
   *
   * Every fallible step belongs above `recordGuess`, because the tally is the
   * point of no return: once guessCounts and plays are incremented, an error
   * escaping this method returns a 500 for a guess that was in fact counted,
   * and the page treats a failure as "the guess never counted, so let them
   * retry", which counts it again.
   *
   * Simpler than the daily version by construction. That one had to settle
   * which photo the date was graded against, and race a concurrent first guess
   * for the answer. The guess names its own problem now, so there is nothing
   * to resolve and nothing to re-read (the dropped AC-19 and AC-20).
   */
  async submitGuess(guess: number, publicId: string): Promise<GradeReveal> {
    const photo = await this.requirePhoto(publicId);

    await this.ensureProblemRow(photo.id);
    const row = await this.recordGuess(photo.id, guess);

    // Nothing below may throw. resolveAnalysis is written not to.
    const model = await this.resolveAnalysis(row, photo, publicId);

    return {
      publicId,
      trueGrade: photo.trueGrade,
      model,
      guessCounts: normalizeHistogram(row.guessCounts),
      plays: row.plays,
      yourGuess: guess,
      yourDistance: Math.abs(guess - photo.trueGrade),
      modelDistance:
        model === null ? null : Math.abs(model.grade - photo.trueGrade),
      ...(photo.note ? { note: photo.note } : {}),
    };
  }

  /**
   * The photo a public id addresses, or a 404.
   *
   * Deliberately does NOT filter on `active`: only the list does. A visitor
   * who loaded the set and guessed after the owner retired that photo is
   * answered rather than errored, because the retirement is not their problem
   * and the answer is not wrong.
   *
   * It does apply the licence gate, which is a different question: `active` is
   * the owner curating, `unlicensed_test` is a photo that must never reach a
   * released game at all (AC-18). A guess is the one path that would spend a
   * vision call on the image, which is the deepest form of reaching it.
   */
  private async requirePhoto(publicId: string): Promise<GradePhoto> {
    const photo = await this.prisma.gradePhoto.findUnique({
      where: { objectKey: objectKeyFor(publicId) },
    });

    if (!photo || this.licenceExcluded(photo)) {
      throw new NotFoundException(NO_SUCH_PROBLEM_MESSAGE);
    }
    return photo;
  }

  /** AC-18's gate for a single row, the same question `partitionPool` asks of many. */
  private licenceExcluded(photo: { source: string }): boolean {
    return gradeGameEnabled() && photo.source === UNLICENSED_TEST;
  }

  /** One line per process naming how many photos the licence gate kept out (AC-18). */
  private logExclusions(count: number): void {
    if (count === 0 || this.exclusionLogged) return;
    this.exclusionLogged = true;
    this.logger.log(
      `Grade photo licence gate: ${count} unlicensed_test photo(s) excluded from the served set`,
    );
  }

  /**
   * This problem's analysis: the cached one, or its single vision call, ever.
   *
   * Lazy fill (spec 0006's chosen option): nothing runs on a schedule, so the
   * first guess on a problem pays for the call and everyone after gets it from
   * the row. `ensureAnalysis` never throws, so a failed call simply leaves this
   * null and a later guess retries (AC-5).
   *
   * Nothing in here may throw either, and that is load bearing rather than
   * tidy. The caller has already incremented this problem's histogram and play
   * count by the time it runs, so an escaping error returns a 500 for a guess
   * that was in fact counted, and the page invites a retry that counts it
   * again. `ensureAnalysis` was always safe; the S3 read added in R6 sat in
   * front of it and was not, so it is caught here and treated as exactly what
   * it is, a problem whose analysis has not landed yet (AC-5).
   */
  private async resolveAnalysis(
    row: GradeProblemRow,
    photo: GradePhoto,
    publicId: string,
  ): Promise<GradeModelAnalysis | null> {
    const cached = toAnalysis(row);
    if (cached) return cached;

    // Bytes, not a URL (AC-15). Read from S3 and base64 encoded here, so the
    // call works under either provider — Bedrock rejects URL sources, which is
    // why the vision path could never have run in production before R5. It
    // also means the model sees the same object the visitor's presigned URL
    // points at, without the model needing to reach a public origin.
    let bytes: Buffer;
    try {
      bytes = await this.storage.getBytes(photo.objectKey);
    } catch (error) {
      // Name only, never a raw SDK message (api logging convention), and the
      // opaque id rather than the slug, which would carry the circuit colour
      // into the log (AC-23). No visitor-supplied value exists on this path.
      this.logger.error(
        `Could not read photo bytes for problem ${publicId}: ${
          error instanceof Error ? error.name : 'unknown error'
        }`,
      );
      return null;
    }

    return this.analysis.ensureAnalysis({
      photoId: photo.id,
      publicId,
      image: {
        data: bytes.toString('base64'),
        mediaType: photo.contentType,
      },
    });
  }

  /**
   * Create this problem's row if it is not there, atomically (AC-4).
   *
   * The insert races by design: whichever concurrent first guess wins the
   * primary key creates the row and every other one takes the unique-violation
   * branch. Unlike the daily version, the loser has nothing to go and read —
   * both requests already hold the same photo, because the request named it.
   * The vision call's single-caller guard is separate (GradeAnalysisService).
   */
  private async ensureProblemRow(photoId: string): Promise<void> {
    try {
      await this.prisma.gradeProblem.create({ data: { photoId } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  /**
   * Increment one histogram slot and the play count in a single statement.
   *
   * Rebuilding the array with unnest/array_agg rather than assigning to a
   * subscript keeps the grade a bound parameter: Postgres accepts a parameter
   * in an assignment subscript only with the right inferred type, and the
   * rebuild form has no such dependency. It stays one atomic UPDATE either
   * way, so concurrent guesses cannot lose a count.
   */
  private async recordGuess(
    photoId: string,
    guess: number,
  ): Promise<GradeProblemRow> {
    const rows = await this.prisma.$queryRaw<GradeProblemRow[]>`
      UPDATE "GradeProblem"
      SET "guessCounts" = (
            SELECT array_agg(
              CASE WHEN ordinality = ${guess} + 1 THEN count + 1 ELSE count END
              ORDER BY ordinality
            )
            FROM unnest("GradeProblem"."guessCounts") WITH ORDINALITY AS t(count, ordinality)
          ),
          "plays" = "plays" + 1
      WHERE "photoId" = ${photoId}
      RETURNING "photoId", "modelGrade", "modelConfidence",
                "observations", "reasoning", "guessCounts", "plays"
    `;

    const row = rows[0];
    if (!row) {
      // ensureProblemRow ran immediately above, so this means the row vanished
      // between the two statements — not a case any visitor can produce.
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }
    return row;
  }
}

/** Widen or pad a stored histogram to the fixed 9 slots the client expects. */
export function normalizeHistogram(counts: number[] | null): number[] {
  const slots = Array.from({ length: GRADE_SLOTS }, () => 0);
  (counts ?? []).forEach((count, index) => {
    if (index < GRADE_SLOTS) slots[index] = count;
  });
  return slots;
}

/** The row's cached analysis as a response object, or null if it has none. */
export function toAnalysis(row: {
  modelGrade: number | null;
  modelConfidence: string | null;
  observations: string[] | null;
  reasoning: string | null;
}): GradeModelAnalysis | null {
  if (row.modelGrade === null) return null;
  return {
    grade: row.modelGrade,
    confidence: (row.modelConfidence ?? 'medium') as GradeConfidence,
    observations: row.observations ?? [],
    reasoning: row.reasoning ?? '',
  };
}

/** Prisma's unique-constraint error, duck-typed so no client class is imported. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
