import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';

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
 * instant that had been recorded by `asOf`. Live scoring passes the current
 * time. The seeding hindcast passes the instant it is simulating, so a
 * hindcast score can never be built from a revision that had not been learned
 * yet, which is what keeps the interval buckets honest downstream.
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
): Promise<ScorableRow[]> {
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
        AND o."recordedAt" <= ${asOf}
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

/**
 * The flow the percentage error divides by when the reading itself is tiny.
 *
 * Percentage error divides by the actual value, and this creek's actual value
 * can approach zero in a dry September, where a two cubic foot miss would
 * read as a two hundred percent error and drown every real result around it.
 * The parent spec sets the floor at the 5th percentile of the gauge's
 * historical flow.
 *
 * Read from the store rather than pinned as a literal, because the number
 * cannot be written down before the backfill exists. It is computed once per
 * run rather than per score, and it moves only as the record grows.
 *
 * Every revision counts, not the as of reconstruction: this is a rough floor
 * on the scale of the river, and the extra rows a revision adds cannot shift
 * a percentile of a hundred thousand readings anywhere that matters.
 */
export async function flowFloorCfs(
  prisma: ScoreReader,
  gaugeId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ floor: number | null }[]>(Prisma.sql`
    SELECT percentile_cont(0.05) WITHIN GROUP (ORDER BY "valueCfs") AS floor
    FROM "observations"
    WHERE "gaugeId" = ${gaugeId}
  `);

  const floor = rows[0]?.floor ?? null;

  if (floor === null || !(floor > 0)) {
    // Unreachable once ingestion has run. Loud rather than silently dividing
    // by something meaningless.
    throw new Error(
      'cannot derive the flow floor: the store holds no positive flow history',
    );
  }

  return floor;
}
