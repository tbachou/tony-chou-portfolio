import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import type { KnowabilityAxis, StoredForecast } from '../types';

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
 * `axis` moves the `asOf` bound and nothing else, exactly as it does in
 * `observationsAsOf`. The default `recordedAt` is the strict rule every live
 * read takes, and passing nothing leaves it in place so the live pipeline
 * cannot acquire the looser one by accident. Only the hindcast passes the
 * archive axis; a second caller on it is a review failure (AC-R8).
 *
 * **On the archive axis the bound is `issuedAt`, not the `validTime` the axis
 * name spells.** `KnowabilityAxis` names the knowability mode, not a column,
 * and for weather the archive mode column is when the forecast was issued. The
 * branch below is written out by hand for that reason (AC-R8a): the generic
 * `row[axis]` idiom `reconstructAsOf` uses would compile here, because a
 * weather row carries a `validTime` too, and would then bound on the wrong
 * clock. `forecastKnowableAt` in `forecast-as-of.ts` states the same mapping
 * in TypeScript and is the tested oracle for it.
 *
 * The window bounds stay on `validTime` under both axes. They ask which hours
 * the caller wants, which is a different question from which rows it may see,
 * and moving them with the axis would silently change the window instead of
 * the visibility.
 *
 * The index ends on `validTime` and so does not cover the archive bound, which
 * is filtered afterwards. That is cheap here because the four equality and
 * range clauses ahead of it have already narrowed the scan to one gauge, model
 * and lead over one window, and no path calls this per slot.
 */
export async function forecastsAsOf(
  prisma: ForecastReader,
  gaugeId: string,
  model: string,
  leadHours: number,
  from: Date,
  to: Date,
  asOf: Date,
  axis: KnowabilityAxis = 'recordedAt',
): Promise<StoredForecast[]> {
  // Written as one interchangeable clause in the position the strict bound
  // already occupied, so the parameters keep their order and the default still
  // produces the statement this query has always produced.
  const knowableBy =
    axis === 'validTime'
      ? Prisma.sql`AND "issuedAt" <= ${asOf}`
      : Prisma.sql`AND "recordedAt" <= ${asOf}`;

  return prisma.$queryRaw<StoredForecast[]>(Prisma.sql`
    SELECT DISTINCT ON ("gaugeId", "validTime", "leadHours", "model")
      "gaugeId", "validTime", "leadHours", "issuedAt", "recordedAt",
      "precipMm", "tempC", "model"
    FROM "weather_forecasts"
    WHERE "gaugeId" = ${gaugeId}
      AND "model" = ${model}
      AND "leadHours" = ${leadHours}
      ${knowableBy}
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

/**
 * The latest `validTime` the store holds for each lead, at one gauge and model.
 *
 * This is what anchors the live ingest window (AC-R13). The window starts at
 * this value less the ingest overlap, so gap recovery falls out of the store
 * rather than out of the schedule: a job that has not run for two days asks for
 * two days, because nothing here consults the cron at all.
 *
 * Per lead, not one value for the whole table, because the three leads run to
 * different edges. A lead of 72 hours reaches three days further into the
 * future than a lead of 24 does, so a single maximum would drag the shorter
 * leads' windows forward past rows they never fetched and leave a permanent
 * hole behind them.
 *
 * The value is routinely in the future, which is correct and is worth saying
 * plainly because it looks wrong. A row's nominal `issuedAt` is `validTime`
 * minus `leadHours`, so a row at lead 24 whose `validTime` is a day ahead was
 * issued now, and the live ingest deliberately reaches that far to give a
 * prediction issued now a complete window (AC-R10). What it must never do is
 * reach further, which is a property of the window, not of this read.
 *
 * **Not knowability bounded**, exactly like `earliestStoredForecastValidTimes`
 * and unlike everything else in this module. It sees every row in the store
 * however recently it was fetched. That is right for deciding what to fetch
 * next and wrong for anything a prediction touches: at issue time `T` it
 * answers with rows recorded long after `T`. Never call it from a prediction or
 * a hindcast path.
 *
 * Grouped rather than asked once per lead, so the whole answer costs one
 * statement in the spirit of AC-R16. A lead with no rows is absent from the map
 * rather than carrying a fallback date, so the caller can tell "nothing stored
 * yet" from "stored up to here" instead of meeting an invented floor.
 *
 * `MAX` is safe over this append only table without a reduction first, for the
 * same reason `MIN` is: the reduction in AC-R7 exists because summing revisions
 * double counts, and an extreme is indifferent to how many rows share the hour
 * it picks.
 */
export async function latestStoredForecastValidTimes(
  prisma: ForecastReader,
  gaugeId: string,
  model: string,
): Promise<ReadonlyMap<number, Date>> {
  const rows = await prisma.$queryRaw<{ leadHours: number; lastValidTime: Date }[]>(
    Prisma.sql`
      SELECT "leadHours", MAX("validTime") AS "lastValidTime"
      FROM "weather_forecasts"
      WHERE "gaugeId" = ${gaugeId}
        AND "model" = ${model}
      GROUP BY "leadHours"
      ORDER BY "leadHours"
    `,
  );

  return new Map(rows.map((row) => [row.leadHours, row.lastValidTime]));
}
