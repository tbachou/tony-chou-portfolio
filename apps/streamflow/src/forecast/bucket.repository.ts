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
 * The time bound is the contributing prediction's `targetTime`, not its
 * score's `actualRecordedAt`. A prediction learns only from forecasts whose
 * outcome had already happened when it was issued, and `targetTime` is that
 * property stated on an axis that survives a bulk import: every score over the
 * imported archive names the same `recordedAt`, so a bound on it filters
 * either everything or nothing. `bucket.ts` carries the full reasoning and the
 * narrow race it costs on the live path.
 *
 * The bound reads the same on both knowability axes, which is why
 * `criteria.axis` reaches this query and changes nothing in it. It is here so
 * the axis stays visible at the call site next to the two reads it does move.
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
        AND p."targetTime" <= ${criteria.issuedAt}
        ${conditionOnRegime}
      ORDER BY s."predictionId", s."actualRecordedAt" DESC, s."id" DESC
    ) latest
    ORDER BY latest."predictionId"
  `);

  return rows.map((row) => row.ratio);
}
