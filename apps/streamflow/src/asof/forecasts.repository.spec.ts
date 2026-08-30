import {
  firstForecastValidTimes,
  forecastsAsOf,
} from './forecasts.repository';
import type { ForecastReader } from './forecasts.repository';

/**
 * These tests read the statement the query sends, not rows it returns.
 *
 * Mirrors `observations.repository.spec.ts` and for the same reason: a reader
 * handing back a canned array would agree with any `WHERE` clause at all, so a
 * mocked result set can prove nothing about this query. Transposing `from` and
 * `to`, or passing the run's start instead of its `recordedAt`, both compile and
 * both leave every consumer test green while production silently re-writes the
 * whole archive on every run. Comparing the generated SQL and the parameter
 * order is the only proof available without a database.
 */
const STATEMENT =
  'SELECT DISTINCT ON ("gaugeId", "validTime", "leadHours", "model") ' +
  '"gaugeId", "validTime", "leadHours", "issuedAt", "recordedAt", ' +
  '"precipMm", "tempC", "model" ' +
  'FROM "weather_forecasts" ' +
  'WHERE "gaugeId" = $1 AND "model" = $2 AND "leadHours" = $3 ' +
  'AND "recordedAt" <= $4 AND "validTime" >= $5 AND "validTime" <= $6 ' +
  'ORDER BY "gaugeId", "validTime", "leadHours", "model", "recordedAt" DESC';

const FROM = new Date('2024-02-01T00:00:00.000Z');
const TO = new Date('2024-02-29T23:00:00.000Z');
const AS_OF = new Date('2026-08-30T00:00:00.000Z');

interface Statement {
  text: string;
  values: unknown[];
}

function reader(rows: unknown[] = []) {
  const sent: Statement[] = [];
  const $queryRaw = jest.fn((sql: Statement) => {
    sent.push(sql);
    return Promise.resolve(rows);
  });

  return {
    prisma: { $queryRaw } as unknown as ForecastReader,
    statement: () => {
      const sql = sent[sent.length - 1];
      return { text: sql.text.replace(/\s+/g, ' ').trim(), values: sql.values };
    },
    count: () => sent.length,
  };
}

describe('forecastsAsOf', () => {
  it('sends the reduction on all four key columns, bounded on recordedAt', async () => {
    const { prisma, statement } = reader();

    await forecastsAsOf(prisma, 'gauge-darby', 'gfs_seamless', 24, FROM, TO, AS_OF);

    expect(statement()).toEqual({
      text: STATEMENT,
      values: ['gauge-darby', 'gfs_seamless', 24, AS_OF, FROM, TO],
    });
  });

  // The transposition the suite could not previously see.
  it('binds from before to, so the window cannot be inverted unnoticed', async () => {
    const { prisma, statement } = reader();

    await forecastsAsOf(prisma, 'g', 'gfs_seamless', 48, FROM, TO, AS_OF);
    const { values } = statement();

    expect(values[4]).toEqual(FROM);
    expect(values[5]).toEqual(TO);
    expect((values[4] as Date).getTime()).toBeLessThan((values[5] as Date).getTime());
  });

  it('binds asOf against recordedAt, not against the window', async () => {
    const { prisma, statement } = reader();

    await forecastsAsOf(prisma, 'g', 'gfs_seamless', 24, FROM, TO, AS_OF);

    expect(statement().values[3]).toEqual(AS_OF);
    expect(statement().text).toContain('"recordedAt" <= $4');
  });

  it('carries the lead and model into the filter, not just the projection', async () => {
    const { prisma, statement } = reader();

    await forecastsAsOf(prisma, 'g', 'icon_seamless', 72, FROM, TO, AS_OF);
    const { text, values } = statement();

    expect(text).toContain('"model" = $2');
    expect(text).toContain('"leadHours" = $3');
    expect(values[1]).toBe('icon_seamless');
    expect(values[2]).toBe(72);
  });

  // AC-R16's read half: one statement for the whole chunk.
  it('issues exactly one statement per call', async () => {
    const { prisma, count } = reader();

    await forecastsAsOf(prisma, 'g', 'gfs_seamless', 24, FROM, TO, AS_OF);

    expect(count()).toBe(1);
  });

  // DISTINCT ON requires its expressions to be a prefix of ORDER BY, or Postgres
  // rejects the statement outright.
  it('keeps the DISTINCT ON list a prefix of the ORDER BY', async () => {
    const { prisma, statement } = reader();

    await forecastsAsOf(prisma, 'g', 'gfs_seamless', 24, FROM, TO, AS_OF);
    const { text } = statement();

    const distinctOn = text.match(/DISTINCT ON \(([^)]+)\)/)?.[1];
    const orderBy = text.match(/ORDER BY (.+)$/)?.[1];

    expect(distinctOn).toBe('"gaugeId", "validTime", "leadHours", "model"');
    expect(orderBy).toBe(
      '"gaugeId", "validTime", "leadHours", "model", "recordedAt" DESC',
    );
    expect(orderBy?.startsWith(distinctOn as string)).toBe(true);
  });
});

const FIRST_LEAD_STATEMENT =
  'SELECT "leadHours", MIN("validTime") AS "firstValidTime" ' +
  'FROM "weather_forecasts" ' +
  'WHERE "gaugeId" = $1 AND "model" = $2 ' +
  'GROUP BY "leadHours" ' +
  'ORDER BY "leadHours"';

const LEAD_24_FROM = new Date('2024-01-20T00:00:00.000Z');
const LEAD_72_FROM = new Date('2024-01-22T00:00:00.000Z');

describe('firstForecastValidTimes', () => {
  it('asks for the least validTime per lead, at one gauge and model', async () => {
    const { prisma, statement } = reader();

    await firstForecastValidTimes(prisma, 'gauge-darby', 'gfs_seamless');

    expect(statement()).toEqual({
      text: FIRST_LEAD_STATEMENT,
      values: ['gauge-darby', 'gfs_seamless'],
    });
  });

  // AC-R6's whole point. A query that bound a date would be reading a constant
  // back to itself, however the constant reached it.
  it('binds no date at all, so no literal can slip in as a floor', async () => {
    const { prisma, statement } = reader();

    await firstForecastValidTimes(prisma, 'g', 'gfs_seamless');
    const { values } = statement();

    expect(values).toHaveLength(2);
    expect(values.some((value) => value instanceof Date)).toBe(false);
  });

  it('keys the answer by lead, so a staggered boundary reads per horizon', async () => {
    const { prisma } = reader([
      { leadHours: 24, firstValidTime: LEAD_24_FROM },
      { leadHours: 72, firstValidTime: LEAD_72_FROM },
    ]);

    const first = await firstForecastValidTimes(prisma, 'g', 'gfs_seamless');

    expect(first.get(24)).toEqual(LEAD_24_FROM);
    expect(first.get(72)).toEqual(LEAD_72_FROM);
    // The two really do differ: a lead of N days needs N days of runs behind it.
    expect(first.get(24)?.getTime()).toBeLessThan(first.get(72)?.getTime() as number);
  });

  // Absent, never a fallback date. A lead with no rows has nothing usable yet,
  // and saying so is the difference between a gap and a silent zero.
  it('omits a lead the store holds nothing for', async () => {
    const { prisma } = reader([{ leadHours: 24, firstValidTime: LEAD_24_FROM }]);

    const first = await firstForecastValidTimes(prisma, 'g', 'gfs_seamless');

    expect(first.has(48)).toBe(false);
    expect(first.get(48)).toBeUndefined();
    expect([...first.keys()]).toEqual([24]);
  });

  it('reports nothing at all on an empty store, rather than a floor', async () => {
    const { prisma } = reader();

    const first = await firstForecastValidTimes(prisma, 'g', 'gfs_seamless');

    expect(first.size).toBe(0);
  });

  // One grouped statement for every lead, in the spirit of AC-R16: the store
  // bills by operation, so a loop asking per lead is a defect even though it
  // would return the same answer.
  it('issues one statement for every lead, not one per lead', async () => {
    const { prisma, count } = reader([
      { leadHours: 24, firstValidTime: LEAD_24_FROM },
      { leadHours: 48, firstValidTime: LEAD_24_FROM },
      { leadHours: 72, firstValidTime: LEAD_72_FROM },
    ]);

    await firstForecastValidTimes(prisma, 'g', 'gfs_seamless');

    expect(count()).toBe(1);
  });
});
