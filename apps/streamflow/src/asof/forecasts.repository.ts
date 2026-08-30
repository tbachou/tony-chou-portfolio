import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import type { StoredForecast } from '../types';

/**
 * The reads this module needs, named structurally so tests can supply a plain
 * object and production can pass the real client or a transaction handle. The
 * same shape `ObservationReader` uses.
 */
export type ForecastReader = Pick<PrismaClient, '$queryRaw'>;

/**
 * The forecast rows as known at `asOf`, for one gauge, model and lead, over a
 * `validTime` window.
 *
 * `DISTINCT ON` with a descending `recordedAt` keeps exactly one row per
 * (gauge, validTime, lead, model): the newest revision `asOf` can see. The
 * table is append only, so without that reduction a revised hour would appear
 * more than once and every consumer that sums or counts would silently double
 * it (AC-R7).
 *
 * Partitioning on all four columns matters even with one gauge and one model in
 * the table: omitting any of them stays correct until a second one exists and
 * then goes quietly wrong.
 *
 * This is the whole comparison set for a (month, lead) chunk in **one** query.
 * The ingest diff then runs in memory against it. Nothing iterates hourly
 * values issuing a query each, which is what AC-R16 requires of the read half:
 * the store bills by operation, so a loop that works correctly can still be a
 * defect.
 *
 * The `asOf` bound is on `recordedAt` here, the strict axis every live read
 * uses. Spec task 7 adds the `KnowabilityAxis` parameter, and per AC-R8a it
 * maps the archive axis onto `issuedAt` by a hand written branch rather than a
 * `row[axis]` lookup, because for weather the archive column is `issuedAt` and
 * not the `validTime` the axis name spells.
 */
export async function forecastsAsOf(
  prisma: ForecastReader,
  gaugeId: string,
  model: string,
  leadHours: number,
  from: Date,
  to: Date,
  asOf: Date,
): Promise<StoredForecast[]> {
  return prisma.$queryRaw<StoredForecast[]>(Prisma.sql`
    SELECT DISTINCT ON ("gaugeId", "validTime", "leadHours", "model")
      "gaugeId", "validTime", "leadHours", "issuedAt", "recordedAt",
      "precipMm", "tempC", "model"
    FROM "weather_forecasts"
    WHERE "gaugeId" = ${gaugeId}
      AND "model" = ${model}
      AND "leadHours" = ${leadHours}
      AND "recordedAt" <= ${asOf}
      AND "validTime" >= ${from}
      AND "validTime" <= ${to}
    ORDER BY "gaugeId", "validTime", "leadHours", "model", "recordedAt" DESC
  `);
}
