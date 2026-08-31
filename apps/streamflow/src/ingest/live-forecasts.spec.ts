import type { PrismaClient } from '../generated/prisma/client';
import type { ForecastValue, StoredForecast } from '../types';
import { ingestLiveForecasts } from './live-forecasts';

const NOW = new Date('2026-08-31T06:00:00.000Z');
const HOUR_MS = 3_600_000;

/**
 * A prisma stub that counts statements and remembers the run rows written.
 *
 * The same shape `ingest-forecasts.spec.ts` uses, and for the same reason: the
 * cost of this job is an acceptance criterion, and it runs four times a day
 * for ever, so a per hour statement here is a standing bill rather than a one
 * off one.
 */
function countingPrisma(edge: { leadHours: number; lastValidTime: Date }[] = []) {
  const statements: string[] = [];
  const runs: Record<string, unknown>[] = [];
  const written: Record<string, unknown>[] = [];

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
        return { id: `run${runs.length}`, ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        statements.push('pipelineRun.update');
        runs.push(data);
        return { id: 'run', ...data };
      }),
    },
    weatherForecast: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        statements.push('weatherForecast.createMany');
        written.push(...data);
        return { count: data.length };
      }),
    },
    // The first raw query is the grouped edge read; every later one is a
    // chunk's comparison set.
    $queryRaw: jest.fn(async () => {
      statements.push('$queryRaw');
      return statements.filter((s) => s === '$queryRaw').length === 1
        ? edge
        : ([] as StoredForecast[]);
    }),
  } as unknown as PrismaClient;

  return { prisma, statements, runs, written };
}

/** Answers every request with a full window of hours, whatever was asked for. */
function fullWindows() {
  const asked: { start: Date; end: Date; leadHours: number }[] = [];

  const fetchForecasts = jest.fn(
    async (window: { start: Date; end: Date }, leadHours: number) => {
      asked.push({ ...window, leadHours });

      const first = Math.ceil(window.start.getTime() / HOUR_MS) * HOUR_MS;
      const last = Math.floor(window.end.getTime() / HOUR_MS) * HOUR_MS;
      const values: ForecastValue[] = [];

      for (let at = first; at <= last; at += HOUR_MS) {
        values.push({ validTime: new Date(at), leadHours, precipMm: 0, tempC: 1 });
      }

      return values;
    },
  );

  return { fetchForecasts, asked };
}

const deps = (prisma: PrismaClient, fetchForecasts: unknown) =>
  ({ prisma, fetchForecasts, now: () => NOW }) as never;

describe('ingestLiveForecasts', () => {
  it('records one OPEN_METEO_INGEST run per lead, each carrying its lead', async () => {
    const { prisma, runs } = countingPrisma();
    const { fetchForecasts } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24, 48, 72] });

    const created = runs.filter((run) => run.job === 'OPEN_METEO_INGEST');
    expect(created).toHaveLength(3);
    expect(created.map((run) => run.leadHours)).toEqual([24, 48, 72]);
    // Created already saying FAILED, so a process killed halfway leaves a row
    // that tells the truth.
    expect(created.every((run) => run.status === 'FAILED')).toBe(true);
  });

  // AC-R13's core property, and the parent's AC-6 restated for weather: the
  // start is read off the store, so nothing has to know when the last run was.
  it('starts each lead at the greatest validTime stored for it, less the overlap', async () => {
    const { prisma } = countingPrisma([
      { leadHours: 24, lastValidTime: new Date('2026-08-31T00:00:00.000Z') },
      { leadHours: 48, lastValidTime: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    const { fetchForecasts, asked } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24, 48] });

    expect(asked[0].start).toEqual(new Date('2026-08-30T22:00:00.000Z'));
    expect(asked[1].start).toEqual(new Date('2026-08-31T22:00:00.000Z'));
  });

  it('asks for the whole gap after a missed run, without consulting a schedule', async () => {
    const { prisma } = countingPrisma([
      { leadHours: 24, lastValidTime: new Date('2026-08-28T00:00:00.000Z') },
    ]);
    const { fetchForecasts, asked } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24] });

    expect(asked[0].start).toEqual(new Date('2026-08-27T22:00:00.000Z'));
    expect(asked[0].end.getTime() - asked[0].start.getTime()).toBeGreaterThan(
      4 * 24 * HOUR_MS,
    );
  });

  // The reason this job exists. A prediction issued now at horizon H needs
  // every hour up to now plus H, and those hours have not happened yet.
  it('reaches one lead ahead of now, so a prediction issued now has a full window', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts, asked } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24, 48, 72] });

    expect(asked[0].end).toEqual(new Date('2026-09-01T06:00:00.000Z'));
    expect(asked[1].end).toEqual(new Date('2026-09-02T06:00:00.000Z'));
    expect(asked[2].end).toEqual(new Date('2026-09-03T06:00:00.000Z'));
  });

  // The leak this job could introduce and must not. Beyond now plus the lead a
  // row's nominal issuedAt postdates the recordedAt it is written with, and
  // Open-Meteo answers such an hour from a fresher run than the lead claims.
  it('writes no row whose nominal issue time is after the run', async () => {
    const { prisma, written } = countingPrisma();
    const { fetchForecasts } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24, 48, 72] });

    expect(written.length).toBeGreaterThan(0);
    for (const row of written) {
      expect((row.issuedAt as Date).getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect((row.issuedAt as Date).getTime()).toBeLessThanOrEqual(
        (row.recordedAt as Date).getTime(),
      );
    }
  });

  it('records the window it actually asked for, not a month', async () => {
    const { prisma, runs } = countingPrisma();
    const { fetchForecasts, asked } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24] });

    const created = runs.find((run) => run.job === 'OPEN_METEO_INGEST');
    expect(created?.windowStart).toEqual(asked[0].start);
    expect(created?.windowEnd).toEqual(asked[0].end);
  });

  // A live window always ends in the future, so the backfill's rule that a
  // month in progress can never be OK would make this status meaningless.
  it('is OK on a full window even though the window ends in the future', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts } = fullWindows();

    const summary = await ingestLiveForecasts(deps(prisma, fetchForecasts), {
      leads: [24],
    });

    expect(summary.byStatus.OK).toBe(1);
    expect(summary.byStatus.PARTIAL).toBe(0);
  });

  it('is PARTIAL when the service returned fewer hours than the window implies', async () => {
    const { prisma } = countingPrisma();
    const short = jest.fn(async () => [
      { validTime: NOW, leadHours: 24, precipMm: 0, tempC: 1 },
    ]);

    const summary = await ingestLiveForecasts(deps(prisma, short), { leads: [24] });

    expect(summary.byStatus.PARTIAL).toBe(1);
    expect(summary.byStatus.OK).toBe(0);
  });

  // Three requests, three independent horizons. Stopping the cycle would deny
  // lead 72 its window for six hours to save one request.
  it('runs the remaining leads after one fails, and counts the failure', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts } = fullWindows();
    const flaky = jest.fn(async (window: never, leadHours: number) => {
      if (leadHours === 24) throw new Error('open-meteo said no');
      return fetchForecasts(window, leadHours);
    });

    const summary = await ingestLiveForecasts(deps(prisma, flaky), {
      leads: [24, 48, 72],
    });

    expect(summary.leadsFailed).toBe(1);
    expect(summary.leadsRun).toBe(2);
    expect(summary.byStatus.FAILED).toBe(1);
    expect(summary.byStatus.OK).toBe(2);
  });

  it('says which lead failed and why, rather than only counting it', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts } = fullWindows();
    const flaky = jest.fn(async (window: never, leadHours: number) => {
      if (leadHours === 48) throw new Error('open-meteo said no');
      return fetchForecasts(window, leadHours);
    });

    const summary = await ingestLiveForecasts(deps(prisma, flaky), {
      leads: [24, 48, 72],
    });

    expect(summary.failures).toEqual([
      { leadHours: 48, error: 'open-meteo said no' },
    ]);
  });

  // The case the run row cannot cover. `ingestForecastWindow` upserts the gauge
  // and creates the row before its own try block, so a failure in those first
  // steps leaves nothing in the database to read the reason off. Without the
  // reason carried out here, a red CI step would name no lead and no cause.
  it('reports a failure that happened before the run row existed', async () => {
    const { prisma, runs } = countingPrisma();
    const { fetchForecasts } = fullWindows();
    (prisma.pipelineRun.create as unknown as jest.Mock).mockImplementationOnce(
      async () => {
        throw new Error('could not reach postgres://user:pw@host/db');
      },
    );

    const summary = await ingestLiveForecasts(deps(prisma, fetchForecasts), {
      leads: [24, 48],
    });

    // No run row for the lead that failed, which is the whole point.
    expect(runs.filter((run) => run.leadHours === 24)).toHaveLength(0);
    expect(summary.leadsFailed).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].leadHours).toBe(24);
    // Sanitised on the way out, so a public build log cannot carry the
    // connection string this job holds.
    expect(summary.failures[0].error).toContain('[redacted connection string]');
    expect(summary.failures[0].error).not.toContain('user:pw');
    // And the other lead still ran.
    expect(summary.leadsRun).toBe(1);
  });

  it('reports no failures on a clean cycle', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts } = fullWindows();

    const summary = await ingestLiveForecasts(deps(prisma, fetchForecasts), {
      leads: [24, 48, 72],
    });

    expect(summary.failures).toEqual([]);
  });

  it('defaults to the horizons the forecasters issue at', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts, asked } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts));

    expect(asked.map((ask) => ask.leadHours)).toEqual([24, 48, 72]);
  });

  // AC-R16. This job runs four times a day for ever, so the statement count is
  // a standing bill rather than a one off.
  it('costs a handful of statements per cycle, never one per hour', async () => {
    const { prisma, statements } = countingPrisma();
    const { fetchForecasts } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24, 48, 72] });

    expect(statements.length).toBeLessThan(20);
    // One grouped read of the stored edge for every lead at once, plus one
    // comparison read per lead.
    expect(statements.filter((s) => s === '$queryRaw')).toHaveLength(4);
    expect(statements.filter((s) => s === 'weatherForecast.createMany')).toHaveLength(3);
  });

  it('reads the stored edge once for every lead, not once per lead', async () => {
    const { prisma } = countingPrisma();
    const { fetchForecasts } = fullWindows();

    await ingestLiveForecasts(deps(prisma, fetchForecasts), { leads: [24, 48, 72] });

    const raw = (prisma.$queryRaw as unknown as jest.Mock).mock.calls;
    // The first is the grouped MAX read; the rest are the per lead comparison
    // sets, which AC-R16 already bounds at one apiece.
    expect(raw[0][0].strings.join('')).toContain('MAX("validTime")');
    expect(raw.slice(1).every((call) => !call[0].strings.join('').includes('MAX('))).toBe(
      true,
    );
  });
});
