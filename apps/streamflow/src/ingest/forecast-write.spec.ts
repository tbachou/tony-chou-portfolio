import { WEATHER_INSERT_BATCH_SIZE } from '../config';
import type { PrismaClient } from '../generated/prisma/client';
import type { ForecastValue } from '../types';
import { issuedAtFor, writeForecasts } from './forecast-write';

const HOUR = new Date('2024-02-01T00:00:00.000Z');
const RECORDED_AT = new Date('2026-08-30T00:00:00.000Z');

/** Counts createMany calls and keeps the rows, so batching is observable. */
function countingPrisma() {
  const calls: { count: number }[] = [];
  const rows: Record<string, unknown>[] = [];

  const prisma = {
    weatherForecast: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        calls.push({ count: data.length });
        rows.push(...data);
        return { count: data.length };
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, calls, rows };
}

function month(hours: number): ForecastValue[] {
  return Array.from({ length: hours }, (_, hour) => ({
    validTime: new Date(HOUR.getTime() + hour * 3_600_000),
    leadHours: 24,
    precipMm: hour % 5,
    tempC: 2,
  }));
}

describe('issuedAtFor', () => {
  // AC-R4. A wrong sign or a wrong unit here is the defect that would poison
  // every row in the archive while still looking plausible.
  it('derives issuedAt as validTime minus leadHours', () => {
    expect(issuedAtFor(HOUR, 24).toISOString()).toBe('2024-01-31T00:00:00.000Z');
    expect(issuedAtFor(HOUR, 48).toISOString()).toBe('2024-01-30T00:00:00.000Z');
    expect(issuedAtFor(HOUR, 72).toISOString()).toBe('2024-01-29T00:00:00.000Z');
  });

  it('always lands before the hour it describes', () => {
    for (const lead of [24, 48, 72]) {
      expect(issuedAtFor(HOUR, lead).getTime()).toBeLessThan(HOUR.getTime());
    }
  });
});

describe('writeForecasts', () => {
  it('stores the derived issuedAt and the pinned model on every row', async () => {
    const { prisma, rows } = countingPrisma();

    await writeForecasts(prisma, 'g1', 'run1', RECORDED_AT, 'gfs_seamless', month(2));

    expect(rows[0]).toEqual({
      gaugeId: 'g1',
      validTime: HOUR,
      leadHours: 24,
      issuedAt: new Date('2024-01-31T00:00:00.000Z'),
      recordedAt: RECORDED_AT,
      precipMm: 0,
      tempC: 2,
      model: 'gfs_seamless',
      ingestRunId: 'run1',
    });
  });

  it('writes an absent tempC as null', async () => {
    const { prisma, rows } = countingPrisma();
    const [value] = month(1);
    delete value.tempC;

    await writeForecasts(prisma, 'g1', 'run1', RECORDED_AT, 'gfs_seamless', [value]);

    expect(rows[0].tempC).toBeNull();
  });

  // AC-R16: a month is a handful of statements, not one per hour.
  it('writes a 720 hour month in a single digit number of statements', async () => {
    const { prisma, calls } = countingPrisma();

    const written = await writeForecasts(
      prisma, 'g1', 'run1', RECORDED_AT, 'gfs_seamless', month(720),
    );

    expect(written).toBe(720);
    expect(calls).toHaveLength(1);
  });

  // AC-R16: the chunk is bounded, so a large batch becomes several statements
  // rather than one statement over Postgres's 65,535 parameter limit.
  it('splits more than the batch size into several statements', async () => {
    const { prisma, calls } = countingPrisma();
    const rows = WEATHER_INSERT_BATCH_SIZE + 250;

    await writeForecasts(prisma, 'g1', 'run1', RECORDED_AT, 'gfs_seamless', month(rows));

    expect(calls).toHaveLength(2);
    expect(calls[0].count).toBe(WEATHER_INSERT_BATCH_SIZE);
    expect(calls[1].count).toBe(250);
  });

  it('orders rows oldest first so a partial write is a complete prefix', async () => {
    const { prisma, rows } = countingPrisma();
    const shuffled = [...month(5)].reverse();

    await writeForecasts(prisma, 'g1', 'run1', RECORDED_AT, 'gfs_seamless', shuffled);

    const times = rows.map((r) => (r.validTime as Date).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('reports progress after each batch', async () => {
    const { prisma } = countingPrisma();
    const seen: number[] = [];

    await writeForecasts(
      prisma, 'g1', 'run1', RECORDED_AT, 'gfs_seamless',
      month(WEATHER_INSERT_BATCH_SIZE + 1), (written) => seen.push(written),
    );

    expect(seen).toEqual([WEATHER_INSERT_BATCH_SIZE, WEATHER_INSERT_BATCH_SIZE + 1]);
  });
});
