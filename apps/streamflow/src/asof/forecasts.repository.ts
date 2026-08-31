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

/**
 * The earliest `validTime` the store holds for each lead, at one gauge and
 * model. This is AC-R6's least `validTime` held, measured rather than pinned as
 * a constant.
 *
 * **This is the earliest row held, not the earliest date anything is usable at,
 * and the two are not the same.** A prediction needs a complete window of `H`
 * hourly rows (AC-R10), and the archive ramps in: `parse.ts` drops the hours
 * Open-Meteo returns null for, so an early month lands as scattered rows rather
 * than a contiguous prefix, which AC-R14 expects and records as PARTIAL. A
 * couple of stray hours therefore put this value weeks before any complete
 * window exists. It does not even order across leads: a stray hour at lead 48
 * can make that lead report earlier than lead 24, whatever the run cadence
 * implies. Anything that needs the usable date wants a different query, the
 * earliest `validTime` with `H` consecutive hourly slots behind it.
 *
 * **Not knowability bounded, unlike everything else in this module.**
 * `forecastsAsOf` takes an `asOf`, and AC-R8 gives it an axis. This takes
 * neither and sees every row in the store however recently it was fetched, so
 * it is an operator report and nothing else. Never call it from a prediction or
 * a hindcast path: at issue time `T` it answers with rows recorded long after
 * `T`, which is the leak the two axis design exists to prevent.
 *
 * Grouped rather than asked once per lead, so the whole answer costs one
 * statement in the spirit of AC-R16, and the leads are the ones the store
 * actually holds rather than the ones a constant expected. A lead with no rows
 * is absent from the map rather than carrying a fallback date.
 *
 * `MIN` is safe over this append only table without a reduction first. The
 * reduction in AC-R7 exists because summing revisions double counts, and a
 * minimum is indifferent to how many rows share the hour it picks.
 */
export async function earliestStoredForecastValidTimes(
  prisma: ForecastReader,
  gaugeId: string,
  model: string,
): Promise<ReadonlyMap<number, Date>> {
  const rows = await prisma.$queryRaw<{ leadHours: number; firstValidTime: Date }[]>(
    Prisma.sql`
      SELECT "leadHours", MIN("validTime") AS "firstValidTime"
      FROM "weather_forecasts"
      WHERE "gaugeId" = ${gaugeId}
        AND "model" = ${model}
      GROUP BY "leadHours"
      ORDER BY "leadHours"
    `,
  );

  return new Map(rows.map((row) => [row.leadHours, row.firstValidTime]));
}
