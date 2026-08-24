import type { BucketCriteria } from './bucket';
import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';

/**
 * The read this module needs, named structurally so tests can supply a plain
 * object and production can pass the real client or a transaction handle.
 */
export type BucketReader = Pick<PrismaClient, '$queryRaw'>;

/**
 * The bucket of past errors, straight out of Postgres.
 *
 * `DISTINCT ON (predictionId)` with a descending `actualRecordedAt` keeps
 * exactly one score per prediction, the newest revision of the truth it was
 * judged against, with the greater id breaking a tie that the unique
 * constraint on (predictionId, actualRecordedAt) already prevents.
 *
 * The `WHERE` runs before that reduction, which is the part worth reading
 * twice. A prediction whose newest score landed after the issue instant still
 * contributes its earlier one, because the filter removes rows and then the
 * reduction picks from what survives. Reversing the two would drop such a
 * prediction from the bucket entirely.
 *
 * Hindcast rows are included on purpose. They exist to fill this bucket, and
 * only the public read helper filters them out.
 *
 * `bucketRatios` in `bucket.ts` states the same rule in TypeScript, and
 * `scripts/verify-bucket.ts` is what proves the two agree.
 */
export async function bucketRatiosFromStore(
  prisma: BucketReader,
  criteria: BucketCriteria,
): Promise<number[]> {
  // Dropped entirely for the pooled bucket. Matching `issueRegime` against
  // null would be a different question, and not one anything asks.
  const conditionOnRegime = criteria.issueRegime
    ? Prisma.sql`AND p."issueRegime" = ${criteria.issueRegime}::"Regime"`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<{ ratio: number }[]>(Prisma.sql`
    SELECT latest."actualCfs" / latest."centralCfs" AS ratio
    FROM (
      SELECT DISTINCT ON (s."predictionId")
        s."predictionId", s."actualCfs", p."centralCfs"
      FROM "scores" s
      JOIN "predictions" p ON p."id" = s."predictionId"
      WHERE p."gaugeId" = ${criteria.gaugeId}
        AND p."modelVersionId" = ${criteria.modelVersionId}
        AND p."horizonHours" = ${criteria.horizonHours}
        AND p."centralCfs" > 0
        AND s."actualRecordedAt" <= ${criteria.issuedAt}
        ${conditionOnRegime}
      ORDER BY s."predictionId", s."actualRecordedAt" DESC, s."id" DESC
    ) latest
    ORDER BY latest."predictionId"
  `);

  return rows.map((row) => row.ratio);
}
