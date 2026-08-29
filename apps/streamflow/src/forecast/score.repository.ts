import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import type { KnowabilityAxis } from '../types';

export type ScoreReader = Pick<PrismaClient, '$queryRaw'>;

/** A prediction whose target has passed, with the truth it should be judged against. */
export interface ScorableRow {
  predictionId: string;
  targetTime: Date;
  centralCfs: number;
  lowerCfs: number;
  upperCfs: number;
  actualCfs: number;
  actualRecordedAt: Date;
}

/**
 * Predictions that need scoring, or need scoring again.
 *
 * "Again" is the interesting half. When USGS revises a reading, the truth a
 * prediction was judged against changes, and the old score is not corrected:
 * a second row is written naming the newer revision. So the question this
 * asks is not "which predictions lack a score" but "which lack a score
 * against the revision that is current now", which is what the NOT EXISTS
 * clause says. A prediction settles down and stops appearing here once its
 * reading is approved and stops changing.
 *
 * The lateral join takes the newest revision of the reading at the target
 * instant that the axis lets `asOf` see. Live scoring passes the current time
 * on the default `recordedAt` axis, so a score can never be built from a
 * revision that had not been learned yet, which is what keeps the interval
 * buckets honest downstream.
 *
 * On the `validTime` axis that bound is dropped rather than moved, and this is
 * the one place the axis does more than swap a column. The bound is what makes
 * the query degenerate over an archive imported in one pass: every reading was
 * learned two days ago, so simulating January 2024 finds no truth for anything
 * and nothing is ever scored. Once the target instant has passed there is also
 * nothing left for the bound to protect, since the reading was true before the
 * forecast was even judged. What survives is `targetTime <= asOf`, which is
 * the whole of the leakage rule that still means something there, and the
 * truth stays the greatest `recordedAt` for that target either way.
 *
 * A prediction whose target instant has no reading at all simply does not
 * appear: the join drops it, and it will appear on a later run if the gap is
 * ever filled.
 */
export async function scorablePredictions(
  prisma: ScoreReader,
  gaugeId: string,
  asOf: Date,
  hindcast: boolean,
  axis: KnowabilityAxis = 'recordedAt',
): Promise<ScorableRow[]> {
  const knowableBy =
    axis === 'validTime'
      ? Prisma.empty
      : Prisma.sql`AND o."recordedAt" <= ${asOf}`;

  return prisma.$queryRaw<ScorableRow[]>(Prisma.sql`
    SELECT
      p."id"        AS "predictionId",
      p."targetTime",
      p."centralCfs",
      p."lowerCfs",
      p."upperCfs",
      truth."valueCfs"   AS "actualCfs",
      truth."recordedAt" AS "actualRecordedAt"
    FROM "predictions" p
    JOIN LATERAL (
      SELECT o."valueCfs", o."recordedAt"
      FROM "observations" o
      WHERE o."gaugeId" = p."gaugeId"
        AND o."validTime" = p."targetTime"
        ${knowableBy}
      ORDER BY o."recordedAt" DESC
      LIMIT 1
    ) truth ON true
    WHERE p."gaugeId" = ${gaugeId}
      AND p."targetTime" <= ${asOf}
      AND p."hindcast" = ${hindcast}
      AND NOT EXISTS (
        SELECT 1 FROM "scores" s
        WHERE s."predictionId" = p."id"
          AND s."actualRecordedAt" = truth."recordedAt"
      )
    ORDER BY p."targetTime"
  `);
}

export type FloorStore = Pick<PrismaClient, '$queryRaw'> & {
  gauge: Pick<PrismaClient['gauge'], 'update'>;
};

/**
 * The flow the percentage error divides by when the reading itself is tiny.
 *
 * Percentage error divides by the actual value, and this creek's actual value
 * can approach zero in a dry September, where a two cubic foot miss would
 * read as a two hundred percent error and drown every real result around it.
 * The parent spec sets the floor at the 5th percentile of the gauge's
 * historical flow, and calls it a constant.
 *
 * So it behaves like one. The first run derives it from the store and freezes
 * it on the gauge; every run after reads that value. Recomputing it each time
 * would have been simpler and quietly wrong: a score written today and its
 * replacement written in December, after a revision changed the truth under
 * it, would divide by different numbers, and neither row would record which.
 * The append only record is supposed to make a score explainable forever, and
 * a moving denominator takes that away.
 *
 * Every revision counts toward the percentile, not the as of reconstruction:
 * this is a rough floor on the scale of the river, and the extra rows a
 * revision adds cannot shift a percentile of a hundred thousand readings
 * anywhere that matters.
 */
/**
 * A floor is only usable if it is finitely positive.
 *
 * Checked on both paths, the one that derives it and the one that reads it
 * back, because the column is meant to be hand correctable and a hand can
 * type a zero. A zero floor makes the percentage error divide by the reading
 * itself, and this gauge can genuinely read zero, since parsing only drops
 * USGS's own missing value sentinel. That produces NaN, the column accepts
 * it, and one NaN then blanks every rolling mean built on top of it. Failing
 * loudly here costs one run; a NaN in the record is permanent.
 */
export function usableFloor(floor: number | null, source: string): number {
  if (floor === null || !Number.isFinite(floor) || floor <= 0) {
    throw new Error(
      `unusable flow floor (${String(floor)}) ${source}: it must be a positive number of cubic feet per second`,
    );
  }
  return floor;
}

export async function flowFloorCfs(
  prisma: FloorStore,
  gauge: { id: string; flowFloorCfs: number | null },
): Promise<number> {
  if (gauge.flowFloorCfs !== null) {
    return usableFloor(gauge.flowFloorCfs, 'frozen on the gauge');
  }

  const rows = await prisma.$queryRaw<{ floor: number | null }[]>(Prisma.sql`
    SELECT percentile_cont(0.05) WITHIN GROUP (ORDER BY "valueCfs") AS floor
    FROM "observations"
    WHERE "gaugeId" = ${gauge.id}
  `);

  // Unreachable once ingestion has run: it means the store holds no positive
  // flow history to take a percentile of.
  const floor = usableFloor(rows[0]?.floor ?? null, 'derived from the store');

  await prisma.gauge.update({
    where: { id: gauge.id },
    data: { flowFloorCfs: floor },
  });

  return floor;
}
