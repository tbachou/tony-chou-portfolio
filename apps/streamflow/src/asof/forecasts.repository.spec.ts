import { forecastsAsOf } from './forecasts.repository';
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

function reader() {
  const sent: Statement[] = [];
  const $queryRaw = jest.fn((sql: Statement) => {
    sent.push(sql);
    return Promise.resolve([]);
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
