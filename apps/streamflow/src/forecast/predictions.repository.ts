import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import type { ScoredError } from './skill';

/**
 * The one way the public read path is allowed to see predictions.
 *
 * The seeding hindcast writes thousands of retrospectively computed forecasts
 * as ordinary rows, because a seed nobody can recompute is a number of
 * unknown provenance sitting under every early prediction. They are real in
 * every respect except one: the scorecard's claim is that it scores every
 * prediction it has ever *made*, and letting hindcast rows into a public read
 * would quietly turn that into something much weaker while looking, from the
 * outside, considerably more impressive.
 *
 * So the filter lives in one function rather than in each endpoint. A hand
 * written `where` clause on predictions anywhere in the read path is a review
 * failure, not a style preference: a forgotten filter fails in the flattering
 * direction, which is the kind of bug nobody reports. Extending this helper
 * with what a new endpoint needs is the right move; going around it is not.
 *
 * The interval bucket query deliberately does not use this. Hindcast rows
 * exist to fill that bucket, and `bucket.repository.ts` reads them on purpose.
 */

export type PredictionReader = {
  prediction: Pick<PrismaClient['prediction'], 'findMany'>;
};

export type ScoredErrorReader = Pick<PrismaClient, '$queryRaw'>;

/**
 * What "public" means, said once.
 *
 * Both reads in this file are the same rule in two dialects, because one is a
 * Prisma query and the other an aggregate join that Prisma's query API cannot
 * express. Keeping them in one file is what makes the pair reviewable: if this
 * rule ever changes, both are on the same screen.
 */
const PUBLIC_PREDICTIONS_ONLY = Prisma.sql`p."hindcast" = false`;

export interface PublicPredictionFilter {
  gaugeId: string;
  /** 24, 48 or 72. Omit for every horizon. */
  horizonHours?: number;
  modelVersionId?: string;
  /** Bounds on when the claim was made. */
  issuedFrom?: Date;
  issuedTo?: Date;
  /** Bounds on what the claim was about. */
  targetFrom?: Date;
  targetTo?: Date;
  limit?: number;
}

/**
 * Predictions a visitor is allowed to see, newest claim first.
 *
 * Every bound is optional except the gauge, which is not: scoping by gauge is
 * correct with one in the table and silently wrong with two, the same reason
 * the as of reconstruction partitions by it.
 */
export async function publicPredictions(
  prisma: PredictionReader,
  filter: PublicPredictionFilter,
) {
  const issuedAt =
    filter.issuedFrom || filter.issuedTo
      ? { gte: filter.issuedFrom, lte: filter.issuedTo }
      : undefined;

  const targetTime =
    filter.targetFrom || filter.targetTo
      ? { gte: filter.targetFrom, lte: filter.targetTo }
      : undefined;

  return prisma.prediction.findMany({
    where: {
      // The whole reason this function exists. Never make it conditional.
      hindcast: false,
      gaugeId: filter.gaugeId,
      horizonHours: filter.horizonHours,
      modelVersionId: filter.modelVersionId,
      issuedAt,
      targetTime,
    },
    // The forecaster's name travels with the row. Every caller wants it, and
    // a second query to resolve ids is how a reader ends up joining by hand.
    include: { modelVersion: { select: { name: true, kind: true } } },
    orderBy: [{ issuedAt: 'desc' }, { horizonHours: 'asc' }],
    take: filter.limit,
  });
}

/**
 * Every live prediction's error, over a window of target instants.
 *
 * One error per prediction, never two. A prediction re-scored after a
 * revision would otherwise weigh twice in the average, and the predictions
 * most likely to be re-polled are the ones during storms, which is exactly
 * where the extra weight would distort what the chart says. The rule is the
 * same one the interval bucket applies, for the same reason: greatest
 * `actualRecordedAt`, ties broken on the greater id.
 *
 * Hindcast rows are excluded, so this stays sparse until the pipeline has
 * accumulated its own scored history. That is the honest answer rather than
 * an unfortunate one: the scorecard's claim is that it shows how the
 * forecasters have done live, and thousands of retrospectively computed
 * results would quietly turn a modest record into an impressive looking one.
 */
export async function publicScoredErrors(
  prisma: ScoredErrorReader,
  gaugeId: string,
  from: Date,
  to: Date,
): Promise<ScoredError[]> {
  return prisma.$queryRaw<ScoredError[]>(Prisma.sql`
    SELECT
      m."name"             AS "modelName",
      latest."horizonHours",
      latest."targetTime",
      latest."pctError"
    FROM (
      SELECT DISTINCT ON (s."predictionId")
        s."pctError",
        p."horizonHours",
        p."targetTime",
        p."modelVersionId"
      FROM "scores" s
      JOIN "predictions" p ON p."id" = s."predictionId"
      WHERE p."gaugeId" = ${gaugeId}
        AND ${PUBLIC_PREDICTIONS_ONLY}
        AND p."targetTime" >= ${from}
        AND p."targetTime" <= ${to}
      ORDER BY s."predictionId", s."actualRecordedAt" DESC, s."id" DESC
    ) latest
    JOIN "model_versions" m ON m."id" = latest."modelVersionId"
    ORDER BY latest."targetTime"
  `);
}
