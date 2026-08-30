import type { PrismaClient } from '../generated/prisma/client';
import type { ForecastValue, StoredForecast } from '../types';
import { ingestForecastMonth } from './ingest-forecasts';
import { monthWindow } from './forecast-window';

const FEBRUARY = new Date('2024-02-01T00:00:00.000Z');
const FEB_HOURS = 696;

/**
 * A prisma stub that counts every statement it is asked to issue.
 *
 * The count is the point. A correct ingest that issues one statement per hour
 * still costs a third of the free tier's monthly allowance in a single
 * backfill, so AC-R16 makes the count itself an acceptance criterion and this
 * stub is what makes it observable.
 */
function countingPrisma(known: StoredForecast[] = []) {
  const statements: string[] = [];
  const runs: Record<string, unknown>[] = [];

  const prisma = {
    gauge: {
      upsert: jest.fn(async () => {
        statements.push('gauge.upsert');
        return { id: 'g1', usgsSiteId: '03230500' };
      }),
    },
    pipelineRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        statements.push('pipelineRun.create');
        runs.push(data);
        return { id: 'run1', ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        statements.push('pipelineRun.update');
        runs.push(data);
        return { id: 'run1', ...data };
      }),
    },
    weatherForecast: {
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => {
        statements.push('weatherForecast.createMany');
        return { count: data.length };
      }),
    },
    $queryRaw: jest.fn(async () => {
      statements.push('$queryRaw');
      return known;
    }),
  } as unknown as PrismaClient;

  return { prisma, statements, runs };
}

function hours(count: number, leadHours = 24): ForecastValue[] {
  return Array.from({ length: count }, (_, hour) => ({
    validTime: new Date(FEBRUARY.getTime() + hour * 3_600_000),
    leadHours,
    precipMm: hour % 4,
    tempC: 1,
  }));
}

const fetching = (values: ForecastValue[]) => jest.fn(async () => values);

describe('ingestForecastMonth', () => {
  it('records a PipelineRun for the month with its boundaries', async () => {
    const { prisma, runs } = countingPrisma();

    const result = await ingestForecastMonth(
      { prisma, fetchForecasts: fetching(hours(FEB_HOURS)) as never },
      FEBRUARY,
      24,
    );

    expect(runs[0]).toMatchObject({
      job: 'OPEN_METEO_INGEST',
      // Created already saying FAILED, so a process killed halfway leaves a row
      // that tells the truth.
      status: 'FAILED',
      windowStart: monthWindow(FEBRUARY).start,
      windowEnd: monthWindow(FEBRUARY).end,
    });
    expect(result.status).toBe('OK');
    expect(result.rowsWritten).toBe(FEB_HOURS);
  });

  // AC-R16. The number that matters: a month is a handful of statements.
  it('ingests a full month in a statement count in the low tens, not hundreds', async () => {
    const { prisma, statements } = countingPrisma();

    await ingestForecastMonth(
      { prisma, fetchForecasts: fetching(hours(FEB_HOURS)) as never },
      FEBRUARY,
      24,
    );

    expect(statements.length).toBeLessThan(20);
    expect(
      statements.filter((s) => s === 'weatherForecast.createMany'),
    ).toHaveLength(1);
    expect(statements.filter((s) => s === '$queryRaw')).toHaveLength(1);
  });

  it('reads the comparison set in exactly one query regardless of month length', async () => {
    const { prisma, statements } = countingPrisma();

    await ingestForecastMonth(
      { prisma, fetchForecasts: fetching(hours(744)) as never },
      new Date('2024-01-01T00:00:00.000Z'),
      24,
    );

    expect(statements.filter((s) => s === '$queryRaw')).toHaveLength(1);
  });

  // AC-R14: expected at the start of the archive, not a failure.
  it('records PARTIAL when the response falls short of the window', async () => {
    const { prisma } = countingPrisma();

    const result = await ingestForecastMonth(
      { prisma, fetchForecasts: fetching(hours(200)) as never },
      FEBRUARY,
      24,
    );

    expect(result.status).toBe('PARTIAL');
    expect(result.hoursReturned).toBe(200);
    expect(result.hoursExpected).toBe(FEB_HOURS);
  });

  // AC-R5: re-running a completed month writes zero rows.
  it('writes nothing when the month is already stored unchanged', async () => {
    const values = hours(FEB_HOURS);
    const known: StoredForecast[] = values.map((value) => ({
      gaugeId: 'g1',
      validTime: value.validTime,
      leadHours: value.leadHours,
      issuedAt: new Date(value.validTime.getTime() - 24 * 3_600_000),
      recordedAt: new Date('2026-08-30T00:00:00.000Z'),
      precipMm: value.precipMm,
      tempC: 1,
      model: 'gfs_seamless',
    }));
    const { prisma, statements } = countingPrisma(known);

    const result = await ingestForecastMonth(
      { prisma, fetchForecasts: fetching(values) as never },
      FEBRUARY,
      24,
    );

    expect(result.rowsWritten).toBe(0);
    expect(result.status).toBe('OK');
    expect(statements).not.toContain('weatherForecast.createMany');
  });

  it('records the run FAILED when the fetch throws, and rethrows', async () => {
    const { prisma, runs } = countingPrisma();
    const failing = jest.fn(async () => {
      throw new Error('open-meteo exploded');
    });

    await expect(
      ingestForecastMonth({ prisma, fetchForecasts: failing as never }, FEBRUARY, 24),
    ).rejects.toThrow('open-meteo exploded');

    expect(runs.at(-1)).toMatchObject({ status: 'FAILED', rowsWritten: 0 });
  });

  it('refuses a lead the store may never hold before touching the database', async () => {
    const { prisma, statements } = countingPrisma();

    await expect(
      ingestForecastMonth({ prisma, fetchForecasts: fetching([]) as never }, FEBRUARY, 0),
    ).rejects.toThrow(/at least 24/);
    expect(statements).toHaveLength(0);
  });

  it('stamps rows with a recordedAt captured after the fetch, never the run start', async () => {
    const { prisma } = countingPrisma();
    const ticks = [
      new Date('2026-08-30T00:00:00.000Z'),
      new Date('2026-08-30T00:00:05.000Z'),
      new Date('2026-08-30T00:00:09.000Z'),
    ];
    let tick = 0;

    await ingestForecastMonth(
      {
        prisma,
        fetchForecasts: fetching(hours(FEB_HOURS)) as never,
        now: () => ticks[Math.min(tick++, ticks.length - 1)],
      },
      FEBRUARY,
      24,
    );

    const createMany = (prisma.weatherForecast.createMany as jest.Mock).mock.calls[0][0];
    // The second tick, taken after the fetch returned, not the first.
    expect(createMany.data[0].recordedAt).toEqual(ticks[1]);
  });
});
