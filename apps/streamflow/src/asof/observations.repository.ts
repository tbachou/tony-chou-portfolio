import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import type { StoredObservation } from '../types';

/**
 * The reads this module needs, named structurally so tests can supply a plain
 * object and production can pass the real client or a transaction handle.
 */
export type ObservationReader = Pick<PrismaClient, '$queryRaw'> & {
  observation: Pick<PrismaClient['observation'], 'findFirst'>;
};

/**
 * The observations as known at `asOf`, over a `validTime` window.
 *
 * `DISTINCT ON` with a descending `recordedAt` keeps exactly one row per
 * (gauge, validTime): the newest revision that had been recorded by `asOf`.
 * Anything learned later is excluded by the `recordedAt` filter, which is what
 * makes AC-3 hold in the database rather than only in application code.
 *
 * Partitioning by `gaugeId` as well as `validTime` matters even with one
 * gauge in the table: omitting it stays correct until a second gauge is added
 * and then goes quietly wrong.
 *
 * `reconstructAsOf` in `as-of.ts` states the same rule in TypeScript and is
 * the oracle to compare this against once a database exists.
 */
export async function observationsAsOf(
  prisma: ObservationReader,
  gaugeId: string,
  from: Date,
  to: Date,
  asOf: Date,
): Promise<StoredObservation[]> {
  return prisma.$queryRaw<StoredObservation[]>(Prisma.sql`
    SELECT DISTINCT ON ("gaugeId", "validTime")
      "gaugeId", "validTime", "recordedAt", "valueCfs", "qualifier"
    FROM "observations"
    WHERE "gaugeId" = ${gaugeId}
      AND "recordedAt" <= ${asOf}
      AND "validTime" >= ${from}
      AND "validTime" <= ${to}
    ORDER BY "gaugeId", "validTime", "recordedAt" DESC
  `);
}

/**
 * The newest `validTime` the store holds for a gauge, or null when it holds
 * nothing. This anchors the next ingest window to what is stored rather than
 * to the schedule, which is what makes a missed run recoverable.
 */
export async function latestStoredValidTime(
  prisma: ObservationReader,
  gaugeId: string,
): Promise<Date | null> {
  const newest = await prisma.observation.findFirst({
    where: { gaugeId },
    orderBy: { validTime: 'desc' },
    select: { validTime: true },
  });

  return newest?.validTime ?? null;
}
