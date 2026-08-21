import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GradeAnalysisService } from './grade-analysis.service';
import {
  GRADE_SLOTS,
  gradeGameEnabled,
  photoObjectUrl,
  type GradeConfidence,
} from './grade.constants';
import {
  partitionPool,
  photoForDate,
  utcDateKey,
  type GradePhoto,
} from './photo-pool';

/**
 * The pre-guess surface. Deliberately carries no `trueGrade` and no model
 * field of any kind: the answer is only obtainable by submitting a guess
 * (AC-2), so this type is the contract that keeps it that way.
 */
export type GradeToday = {
  /** UTC `YYYY-MM-DD`. */
  date: string;
  imageUrl: string;
  /** Location or credit line. The page holds it back until the reveal. */
  note?: string;
  poolSize: number;
};

export type GradeModelAnalysis = {
  grade: number;
  confidence: GradeConfidence;
  observations: string[];
  reasoning: string;
};

export type GradeReveal = {
  date: string;
  trueGrade: number;
  /** Null while the day's vision call has not landed yet (AC-5). */
  model: GradeModelAnalysis | null;
  guessCounts: number[];
  plays: number;
  yourGuess: number;
  yourDistance: number;
  /** Null whenever `model` is. */
  modelDistance: number | null;
  note?: string;
};

/** The subset of the GradeDay row the guess path reads back. */
type GradeDayRow = {
  date: string;
  photoId: string;
  modelGrade: number | null;
  modelConfidence: string | null;
  observations: string[];
  reasoning: string | null;
  guessCounts: number[];
  plays: number;
};

const NO_PHOTOS_MESSAGE =
  'The daily problem is not available right now. Please try again later.';

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  /**
   * The last UTC date the licence exclusion was logged for (AC-18).
   *
   * The count has to be fresh, so it cannot be computed at startup: a photo
   * toggled inactive without a redeploy would leave a boot-time number lying.
   * Logging on every cycle resolution would be fresh but repeat on every
   * request until the day's row exists, so it is emitted once per UTC date
   * per process instead. A redeploy re-logging the same day is fine.
   */
  private lastExclusionLogDate: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysis: GradeAnalysisService,
  ) {}

  /**
   * Today's problem, with nothing that gives the answer away (AC-1, AC-2).
   *
   * `now` is injectable so the deterministic date cycle is testable without
   * faking the clock globally; production always uses the server clock.
   */
  async getToday(now: Date = new Date()): Promise<GradeToday> {
    const date = utcDateKey(now);
    const { photo, eligible } = await this.resolveDayPhoto(date, now);

    return {
      date,
      imageUrl: photoObjectUrl(photo.objectKey),
      ...(photo.note ? { note: photo.note } : {}),
      poolSize: eligible.length,
    };
  }

  /**
   * Record one guess and reveal the day (AC-3).
   *
   * Order matters: the day row is created atomically first, then the
   * histogram and play count increment in a single statement, and only then
   * is the model analysis considered. The tally therefore lands exactly once
   * per request whatever the vision call does, which is what AC-6 asks for.
   */
  async submitGuess(
    guess: number,
    now: Date = new Date(),
  ): Promise<GradeReveal> {
    const date = utcDateKey(now);
    const { photo: candidate } = await this.resolveDayPhoto(date, now);

    await this.ensureDayRow(date, candidate.id);
    const row = await this.recordGuess(date, guess);

    // The row is the authority on which photo this date is graded against
    // (AC-20), not the candidate resolved above. The two differ only in a
    // narrow race — a concurrent first guess created the row while the pool
    // was changing underneath — but reading the row's own photo is what makes
    // that race harmless instead of grading two visitors against two
    // different problems under one histogram.
    const photo =
      row.photoId === candidate.id
        ? candidate
        : await this.requirePinnedPhoto(row.photoId);

    const model = await this.resolveAnalysis(row, photo);

    return {
      date,
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
   * The photo this UTC date is graded against, and the pool it was drawn from.
   *
   * Two sources, in strict order. An existing GradeDay row wins outright and
   * its photo is returned even if that photo has since been deactivated
   * (AC-20): uploading or retiring a photo mid-day must not change the answer
   * under visitors already playing. Only when no row exists does the
   * deterministic cycle choose (AC-1).
   *
   * The pool is loaded either way because `poolSize` is reported from it, and
   * it is the live eligible count rather than anything the row pinned.
   */
  private async resolveDayPhoto(
    date: string,
    now: Date,
  ): Promise<{ photo: GradePhoto; eligible: GradePhoto[] }> {
    const [pinned, active] = await Promise.all([
      this.prisma.gradeDay.findUnique({
        where: { date },
        select: { photo: true },
      }),
      this.prisma.gradePhoto.findMany({ where: { active: true } }),
    ]);

    const { eligible, excluded } = partitionPool(active, gradeGameEnabled());
    this.logExclusions(date, excluded.length);

    if (pinned?.photo) return { photo: pinned.photo, eligible };

    const photo = photoForDate(now, eligible);
    if (!photo) {
      // An empty pool is a deployment problem, not a visitor problem.
      this.logger.error(
        `No active photo available for ${date}; /grade is unplayable`,
      );
      throw new ServiceUnavailableException(NO_PHOTOS_MESSAGE);
    }
    return { photo, eligible };
  }

  /** The photo a GradeDay row pinned, whatever its current active state. */
  private async requirePinnedPhoto(photoId: string): Promise<GradePhoto> {
    const photo = await this.prisma.gradePhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo) {
      // The foreign key is onDelete: Restrict, so a row's photo cannot be
      // deleted out from under it. Reaching here means the constraint was
      // bypassed by hand.
      this.logger.error(`GradeDay row points at missing photo ${photoId}`);
      throw new ServiceUnavailableException(NO_PHOTOS_MESSAGE);
    }
    return photo;
  }

  /** One line per UTC date naming how many photos the licence gate kept out (AC-18). */
  private logExclusions(date: string, count: number): void {
    if (count === 0 || this.lastExclusionLogDate === date) return;
    this.lastExclusionLogDate = date;
    this.logger.log(
      `Grade photo licence gate: ${count} unlicensed_test photo(s) excluded from the ${date} cycle`,
    );
  }

  /**
   * The day's analysis: the cached one, or the day's single vision call.
   *
   * Lazy fill (spec 0006's chosen option): nothing runs on a schedule, so the
   * first guess of the day pays for the call and everyone after gets it from
   * the row. `ensureAnalysis` never throws, so a failed call simply leaves
   * this null and a later guess retries (AC-5).
   */
  private async resolveAnalysis(
    row: GradeDayRow,
    photo: GradePhoto,
  ): Promise<GradeModelAnalysis | null> {
    const cached = toAnalysis(row);
    if (cached) return cached;

    return this.analysis.ensureAnalysis({
      date: row.date,
      imageUrl: photoObjectUrl(photo.objectKey),
    });
  }

  /**
   * Create the day's row if it is not there, atomically (AC-4).
   *
   * The insert races by design: whichever concurrent first guess wins the
   * primary key creates the row and every other one takes the unique-violation
   * branch. Nothing downstream depends on *which* request won — the vision
   * call's single-caller guard is separate (GradeAnalysisService) — so this
   * only has to be safe, not informative.
   */
  private async ensureDayRow(date: string, photoId: string): Promise<void> {
    try {
      await this.prisma.gradeDay.create({ data: { date, photoId } });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
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
  private async recordGuess(date: string, guess: number): Promise<GradeDayRow> {
    const rows = await this.prisma.$queryRaw<GradeDayRow[]>`
      UPDATE "GradeDay"
      SET "guessCounts" = (
            SELECT array_agg(
              CASE WHEN ordinality = ${guess} + 1 THEN count + 1 ELSE count END
              ORDER BY ordinality
            )
            FROM unnest("GradeDay"."guessCounts") WITH ORDINALITY AS t(count, ordinality)
          ),
          "plays" = "plays" + 1
      WHERE "date" = ${date}
      RETURNING "date", "photoId", "modelGrade", "modelConfidence",
                "observations", "reasoning", "guessCounts", "plays"
    `;

    const row = rows[0];
    if (!row) {
      // ensureDayRow ran immediately above, so this means the row vanished
      // between the two statements — not a case any visitor can produce.
      throw new ServiceUnavailableException(NO_PHOTOS_MESSAGE);
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
