import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GradeAnalysisService } from './grade-analysis.service';
import {
  GRADE_SLOTS,
  PHOTO_URL_PREFIX,
  resolveWebOrigin,
  type GradeConfidence,
} from './grade.constants';
import {
  loadPhotoManifest,
  photoForDate,
  sortedPool,
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
  getToday(now: Date = new Date()): GradeToday {
    const photo = this.requirePhoto(now);

    return {
      date: utcDateKey(now),
      imageUrl: this.imageUrlFor(photo),
      ...(photo.note !== undefined && { note: photo.note }),
      poolSize: sortedPool().length,
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
    const photo = this.requirePhoto(now);
    const date = utcDateKey(now);

    await this.ensureDayRow(date, photo.id);
    const row = await this.recordGuess(date, guess);

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
      ...(photo.note !== undefined && { note: photo.note }),
    };
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
      imageUrl: this.imageUrlFor(photo),
    });
  }

  /** The absolute URL both the page and the vision call resolve the photo at. */
  imageUrlFor(photo: GradePhoto): string {
    return `${resolveWebOrigin()}${PHOTO_URL_PREFIX}${photo.file}`;
  }

  private requirePhoto(now: Date): GradePhoto {
    const photo = photoForDate(now, loadPhotoManifest());
    if (!photo) {
      // An empty pool is a deployment problem, not a visitor problem.
      this.logger.error('Grade photo manifest is empty; /grade is unplayable');
      throw new ServiceUnavailableException(NO_PHOTOS_MESSAGE);
    }
    return photo;
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
