import type { PrismaClient } from '../generated/prisma/client';

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
    orderBy: [{ issuedAt: 'desc' }, { horizonHours: 'asc' }],
    take: filter.limit,
  });
}
