import { rainWindowFromStore } from './rain.repository';
import type { RainReader } from './rain.repository';
import type { RainCriteria } from './rain';

/**
 * These tests read the statement the query sends and the shape it makes of
 * what comes back.
 *
 * Same reasoning as the other repository suites: a reader handing back a
 * canned row would agree with any `WHERE` clause at all. What a mock can prove
 * is that the reduction is in the statement, that the window is half open in
 * the right direction, that the axis moves the bound it is supposed to move,
 * and that a short window is refused rather than summed. Whether the query
 * means the same as `rainWindow` needs a database, which is
 * `scripts/verify-rain.ts`.
 */
const STATEMENT =
  'SELECT SUM(latest."precipMm") AS "precipMm", COUNT(*)::int AS hours ' +
  'FROM ( ' +
  'SELECT DISTINCT ON ("gaugeId", "validTime", "leadHours", "model") ' +
  '"validTime", "precipMm" ' +
  'FROM "weather_forecasts" ' +
  'WHERE "gaugeId" = $1 AND "model" = $2 AND "leadHours" = $3 ' +
  'AND "recordedAt" <= $4 AND "validTime" > $5 AND "validTime" <= $6 ' +
  'ORDER BY "gaugeId", "validTime", "leadHours", "model", "recordedAt" DESC ' +
  ') latest';

const T = new Date('2026-08-19T00:00:00.000Z');
const TARGET = new Date('2026-08-20T00:00:00.000Z');

const CRITERIA: RainCriteria = {
  gaugeId: 'gauge-darby',
  model: 'gfs_seamless',
  horizonHours: 24,
  issuedAt: T,
};

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
    prisma: { $queryRaw } as unknown as RainReader,
    statement: () => {
      const sql = sent[sent.length - 1];
      return { text: sql.text.replace(/\s+/g, ' ').trim(), values: sql.values };
    },
    count: () => sent.length,
  };
}

describe('rainWindowFromStore', () => {
  it('sends the reduced aggregate over the half open window', async () => {
    const { prisma, statement } = reader();

    await rainWindowFromStore(prisma, CRITERIA);

    expect(statement()).toEqual({
      text: STATEMENT,
      values: ['gauge-darby', 'gfs_seamless', 24, T, T, TARGET],
    });
  });

  // AC-R7. Both the count and the sum have to be taken over the reduced set,
  // which is what the subquery is for. An aggregate over the raw rows would
  // double count a revised hour and let it pad a short window.
  it('aggregates over the reduced subquery, not over raw rows', async () => {
    const { prisma, statement } = reader();

    await rainWindowFromStore(prisma, CRITERIA);
    const { text } = statement();

    expect(text).toContain('SUM(latest."precipMm")');
    expect(text).toContain('COUNT(*)::int AS hours');
    expect(text).toContain(
      'SELECT DISTINCT ON ("gaugeId", "validTime", "leadHours", "model")',
    );
    // The aggregate reads the alias, so it cannot reach the unreduced table.
    expect(text).not.toContain('SUM("precipMm")');
  });

  /**
   * The cast is load bearing. Postgres counts in `bigint` and Prisma hands
   * that back as a `BigInt`, which never compares equal to a `number`. Without
   * it the completeness check is false for every window ever read and every
   * rain feature comes back null with nothing to show for it.
   */
  it('casts the count to int, so it comes back as a number not a BigInt', async () => {
    const { prisma, statement } = reader();

    await rainWindowFromStore(prisma, CRITERIA);

    expect(statement().text).toContain('COUNT(*)::int');
    expect(statement().text).not.toMatch(/COUNT\(\*\) AS/);
  });

  // The window runs after T, up to and including the target. Two different
  // operators on the same column, and swapping them shifts the feature by an
  // hour at both ends.
  it('bounds the window open at the issue instant and closed at the target', async () => {
    const { prisma, statement } = reader();

    await rainWindowFromStore(prisma, CRITERIA);
    const { text, values } = statement();

    expect(text).toContain('AND "validTime" > $5 AND "validTime" <= $6');
    expect(values[4]).toEqual(T);
    expect(values[5]).toEqual(TARGET);
    expect((values[5] as Date).getTime() - (values[4] as Date).getTime()).toBe(
      24 * 3600 * 1000,
    );
  });

  it('matches the lead against the horizon, so a shorter lead cannot enter', async () => {
    const { prisma, statement } = reader();

    await rainWindowFromStore(prisma, { ...CRITERIA, horizonHours: 48 });
    const { text, values } = statement();

    expect(text).toContain('"leadHours" = $3');
    expect(values[2]).toBe(48);
  });

  // AC-R8a again, on this query. The archive bound is `issuedAt`, and the
  // window bounds stay on `validTime` where they belong.
  it('bounds on issuedAt under the archive axis, leaving the window alone', async () => {
    const { prisma, statement } = reader();

    await rainWindowFromStore(prisma, { ...CRITERIA, axis: 'validTime' });
    const { text, values } = statement();

    expect(text).toBe(STATEMENT.replace('"recordedAt" <= $4', '"issuedAt" <= $4'));
    expect(text).toContain('AND "validTime" > $5 AND "validTime" <= $6');
    expect(values).toEqual(['gauge-darby', 'gfs_seamless', 24, T, T, TARGET]);
  });

  it('sends the strict statement when no axis is given', async () => {
    const strict = reader();
    const explicit = reader();

    await rainWindowFromStore(strict.prisma, CRITERIA);
    await rainWindowFromStore(explicit.prisma, { ...CRITERIA, axis: 'recordedAt' });

    expect(strict.statement()).toEqual(explicit.statement());
  });

  // The reduction keeps picking the newest revision, whichever axis decided
  // which rows may be seen. Visibility and reduction are separate steps.
  it('keeps the reduction on recordedAt under both axes', async () => {
    const live = reader();
    const archive = reader();

    await rainWindowFromStore(live.prisma, CRITERIA);
    await rainWindowFromStore(archive.prisma, { ...CRITERIA, axis: 'validTime' });

    for (const sent of [live.statement(), archive.statement()]) {
      expect(sent.text).toContain(
        'ORDER BY "gaugeId", "validTime", "leadHours", "model", "recordedAt" DESC',
      );
    }
  });

  describe('what it makes of the answer', () => {
    it('returns the sum when the window is complete', async () => {
      const { prisma } = reader([{ precipMm: 12.5, hours: 24 }]);

      expect(await rainWindowFromStore(prisma, CRITERIA)).toBe(12.5);
    });

    it('returns 0 for a complete window that was forecast dry', async () => {
      const { prisma } = reader([{ precipMm: 0, hours: 24 }]);

      expect(await rainWindowFromStore(prisma, CRITERIA)).toBe(0);
    });

    // AC-R10. Null, never a partial sum, and never a zero standing in for one.
    it('returns null when an hour is missing, even with rain to report', async () => {
      const { prisma } = reader([{ precipMm: 12.5, hours: 23 }]);

      expect(await rainWindowFromStore(prisma, CRITERIA)).toBeNull();
    });

    // SUM over no rows is null in SQL, and an empty window takes the same
    // refusal path as a short one.
    it('returns null on an empty window', async () => {
      const { prisma } = reader([{ precipMm: null, hours: 0 }]);

      expect(await rainWindowFromStore(prisma, CRITERIA)).toBeNull();
    });

    it('returns null when the count somehow exceeds the horizon', async () => {
      const { prisma } = reader([{ precipMm: 40, hours: 25 }]);

      expect(await rainWindowFromStore(prisma, CRITERIA)).toBeNull();
    });

    it('returns null rather than throwing when nothing comes back at all', async () => {
      const { prisma } = reader([]);

      expect(await rainWindowFromStore(prisma, CRITERIA)).toBeNull();
    });

    it('reads the horizon it was given, not a fixed 24', async () => {
      const { prisma } = reader([{ precipMm: 30, hours: 48 }]);

      expect(await rainWindowFromStore(prisma, { ...CRITERIA, horizonHours: 48 })).toBe(
        30,
      );
    });
  });

  it('issues exactly one statement per call', async () => {
    const { prisma, count } = reader([{ precipMm: 1, hours: 24 }]);

    await rainWindowFromStore(prisma, CRITERIA);

    expect(count()).toBe(1);
  });
});
