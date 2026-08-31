import type { RainCriteria } from './rain';
import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';

/**
 * The read this module needs, named structurally so tests can supply a plain
 * object and production can pass the real client or a transaction handle.
 */
export type RainReader = Pick<PrismaClient, '$queryRaw'>;

/**
 * Cumulative forecast rainfall over the lead window, straight out of Postgres,
 * or null when the window is not complete.
 *
 * `DISTINCT ON ("gaugeId", "validTime", "leadHours", "model")` with a
 * descending `recordedAt` keeps one row per hour, the newest revision the axis
 * lets the issue instant see. The three key columns beside `validTime` are
 * already pinned by equality above, so partitioning on them changes nothing
 * here; it is written the long way to match `forecastsAsOf`, because a reader
 * comparing the two reads should not have to work out why one states the key
 * and the other does not.
 *
 * **The count and the sum are both taken over the reduced set**, which is what
 * the subquery is for. Counting raw rows would let one revised hour stand in
 * for a missing one and pass a short window off as complete, and summing them
 * would double count that hour's rain (AC-R7, AC-R10).
 *
 * `COUNT(*)::int`, not a bare `COUNT(*)`. Postgres counts in `bigint` and
 * Prisma hands that back as a JavaScript `BigInt`, which is never `===` or
 * `==`-with-`!==` equal to a `number`. The completeness check below would then
 * be false for every window ever read, and every rain feature would come back
 * null with nothing to show for it. The cast is load bearing, not tidiness.
 *
 * `SUM` over no rows is null in SQL, so an empty window arrives here as a null
 * total and a zero count, and takes the same refusal path as a short one.
 *
 * The axis bound is written out by hand onto `issuedAt`, never reached through
 * the axis name, for the reason `forecastKnowableAt` carries in full (AC-R8a).
 *
 * `rainWindow` in `rain.ts` states the same rule in TypeScript, and
 * `scripts/verify-rain.ts` is what proves the two agree.
 */
export async function rainWindowFromStore(
  prisma: RainReader,
  criteria: RainCriteria,
): Promise<number | null> {
  const { gaugeId, model, horizonHours, issuedAt, axis = 'recordedAt' } = criteria;

  const targetTime = new Date(issuedAt.getTime() + horizonHours * 3600 * 1000);

  const knowableBy =
    axis === 'validTime'
      ? Prisma.sql`AND "issuedAt" <= ${issuedAt}`
      : Prisma.sql`AND "recordedAt" <= ${issuedAt}`;

  const rows = await prisma.$queryRaw<{ precipMm: number | null; hours: number }[]>(
    Prisma.sql`
      SELECT SUM(latest."precipMm") AS "precipMm", COUNT(*)::int AS hours
      FROM (
        SELECT DISTINCT ON ("gaugeId", "validTime", "leadHours", "model")
          "validTime", "precipMm"
        FROM "weather_forecasts"
        WHERE "gaugeId" = ${gaugeId}
          AND "model" = ${model}
          AND "leadHours" = ${horizonHours}
          ${knowableBy}
          AND "validTime" > ${issuedAt}
          AND "validTime" <= ${targetTime}
        ORDER BY "gaugeId", "validTime", "leadHours", "model", "recordedAt" DESC
      ) latest
    `,
  );

  const [result] = rows;
  if (!result || result.hours !== horizonHours) return null;

  return result.precipMm;
}
