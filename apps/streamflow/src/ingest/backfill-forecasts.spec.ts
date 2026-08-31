import type { PrismaClient } from '../generated/prisma/client';
import type { ForecastValue } from '../types';
import {
  backfillForecasts,
  chunkKey,
  completedForecastChunks,
  monthStartsBetween,
} from './backfill-forecasts';
import { monthWindow } from './forecast-window';

interface RunRow {
  id: string;
  job: string;
  status: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  leadHours: number | null;
  rowsWritten: number;
}

/**
 * An in-memory stand in for the store, so the driver is exercised through the
 * real `ingestForecastMonth` rather than a mock of it. The resume rule is the
 * thing under test and it reads rows this fake writes, so faking the ingest
 * would test nothing.
 */
/**
 * A seeded run stands for a real recorded backfill chunk, so a seed naming a
 * `windowStart` and no end gets the rest of that month, which is what
 * `ingestForecastMonth` writes. Left null, every seed would look like a run
 * over some other shape of window and `completedForecastChunks` would rightly
 * refuse to read it as a covered month. A seed may still state an end of its
 * own, which is how the live shaped runs below are built.
 */
function fakeStore(seed: Partial<RunRow>[] = []) {
  const runs: RunRow[] = seed.map((row, index) => ({
    id: `seed${index}`,
    job: 'OPEN_METEO_INGEST',
    status: 'OK',
    windowStart: null,
    windowEnd:
      row.windowStart && row.windowEnd === undefined
        ? monthWindow(row.windowStart).end
        : null,
    leadHours: null,
    rowsWritten: 0,
    ...row,
  }));
  const written: Record<string, unknown>[] = [];
  const queries: string[] = [];

  const prisma = {
    gauge: { upsert: jest.fn(async () => ({ id: 'g1', usgsSiteId: '03230500' })) },
    pipelineRun: {
      create: jest.fn(async ({ data }: { data: Partial<RunRow> }) => {
        const row: RunRow = {
          id: `run${runs.length}`,
          job: 'OPEN_METEO_INGEST',
          status: 'FAILED',
          windowStart: null,
          windowEnd: null,
          leadHours: null,
          rowsWritten: 0,
          ...data,
        };
        runs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<RunRow> }) => {
        const row = runs.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { job: string; status: string } }) => {
        queries.push('pipelineRun.findMany');
        return runs.filter((r) => r.job === where.job && r.status === where.status);
      }),
    },
    weatherForecast: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        written.push(...data);
        return { count: data.length };
      }),
    },
    $queryRaw: jest.fn(async () => []),
  } as unknown as PrismaClient;

  return { prisma, runs, written, queries };
}

const hours = (count: number, month: Date, leadHours: number): ForecastValue[] =>
  Array.from({ length: count }, (_, hour) => ({
    validTime: new Date(month.getTime() + hour * 3_600_000),
    leadHours,
    precipMm: 0,
    tempC: 1,
  }));

/** Always returns a full month, so every chunk lands OK. */
const fullMonths = () =>
  jest.fn(async (window: { start: Date; end: Date }, leadHours: number) =>
    hours(
      (window.end.getTime() - window.start.getTime()) / 3_600_000 + 1,
      window.start,
      leadHours,
    ),
  );

const JAN = new Date('2024-01-01T00:00:00.000Z');
const MAR = new Date('2024-03-15T00:00:00.000Z');

describe('monthStartsBetween', () => {
  it('includes both end months', () => {
    expect(monthStartsBetween(JAN, MAR).map((d) => d.toISOString().slice(0, 7))).toEqual([
      '2024-01', '2024-02', '2024-03',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(
      monthStartsBetween(new Date('2024-11-20T00:00:00.000Z'), new Date('2025-02-02T00:00:00.000Z'))
        .map((d) => d.toISOString().slice(0, 7)),
    ).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('returns a single month when both ends share one', () => {
    expect(monthStartsBetween(JAN, new Date('2024-01-31T23:00:00.000Z'))).toHaveLength(1);
  });
});

describe('completedForecastChunks', () => {
  it('keys on the month and the lead together, in one query', async () => {
    const { prisma, queries } = fakeStore([
      { windowStart: monthWindow(JAN).start, leadHours: 24 },
      { windowStart: monthWindow(JAN).start, leadHours: 48 },
    ]);

    const done = await completedForecastChunks(prisma);

    expect(done.has(chunkKey(monthWindow(JAN).start, 24))).toBe(true);
    expect(done.has(chunkKey(monthWindow(JAN).start, 48))).toBe(true);
    expect(done.has(chunkKey(monthWindow(JAN).start, 72))).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it('ignores a PARTIAL month, so a ramp in gap is not frozen forever', async () => {
    const { prisma } = fakeStore([
      { windowStart: monthWindow(JAN).start, leadHours: 24, status: 'PARTIAL' },
    ]);

    expect(await completedForecastChunks(prisma)).toEqual(new Set());
  });

  it('ignores a run carrying no lead, such as a USGS ingest', async () => {
    const { prisma } = fakeStore([
      { windowStart: monthWindow(JAN).start, leadHours: null },
    ]);

    expect(await completedForecastChunks(prisma)).toEqual(new Set());
  });

  // The live ingest writes runs of this same job carrying this same lead, over
  // windows that are not months. This one starts exactly on a month boundary,
  // which happens whenever the greatest stored validTime lands two hours into
  // the first of a month, so keying on the start alone would read it as a
  // finished January and leave a hole nothing ever fills.
  it('ignores a live run whose window happens to start on a month boundary', async () => {
    const { prisma } = fakeStore([
      {
        windowStart: monthWindow(JAN).start,
        windowEnd: new Date('2024-01-02T04:00:00.000Z'),
        leadHours: 24,
      },
    ]);

    expect(await completedForecastChunks(prisma)).toEqual(new Set());
  });

  it('still runs the month a live run only appeared to cover', async () => {
    const { prisma } = fakeStore([
      {
        windowStart: monthWindow(JAN).start,
        windowEnd: new Date('2024-01-02T04:00:00.000Z'),
        leadHours: 24,
      },
    ]);

    const summary = await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: JAN, leads: [24] },
    );

    expect(summary.chunksSkipped).toBe(0);
    expect(summary.chunksRun).toBe(1);
  });
});

describe('backfillForecasts', () => {
  it('runs every month at every lead', async () => {
    const { prisma } = fakeStore();

    const summary = await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: MAR, leads: [24, 48, 72] },
    );

    expect(summary.chunksTotal).toBe(9);
    expect(summary.chunksRun).toBe(9);
    expect(summary.chunksSkipped).toBe(0);
    expect(summary.byStatus.OK).toBe(9);
  });

  it('records each run against its own lead', async () => {
    const { prisma, runs } = fakeStore();

    await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: JAN, leads: [24, 48, 72] },
    );

    expect(runs.map((r) => r.leadHours).sort((a, b) => Number(a) - Number(b))).toEqual([
      24, 48, 72,
    ]);
    expect(runs.every((r) => r.windowStart?.getTime() === monthWindow(JAN).start.getTime()))
      .toBe(true);
  });

  it('skips a month already recorded OK for that lead', async () => {
    const { prisma } = fakeStore([
      { windowStart: monthWindow(JAN).start, leadHours: 24 },
    ]);

    const summary = await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: JAN, leads: [24, 48, 72] },
    );

    expect(summary.chunksSkipped).toBe(1);
    expect(summary.chunksRun).toBe(2);
  });

  // The reason PipelineRun.leadHours exists. Before it, these two chunks were
  // indistinguishable and finishing one would have skipped the other.
  it('still runs a month at lead 48 when only lead 24 is done', async () => {
    const { prisma, runs } = fakeStore([
      { windowStart: monthWindow(JAN).start, leadHours: 24 },
    ]);

    await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: JAN, leads: [24, 48] },
    );

    const fresh = runs.filter((r) => r.id !== 'seed0');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].leadHours).toBe(48);
  });

  it('runs nothing when the whole range is already done', async () => {
    const done = [24, 48, 72].map((leadHours) => ({
      windowStart: monthWindow(JAN).start,
      leadHours,
    }));
    const { prisma } = fakeStore(done);
    const fetchForecasts = fullMonths();

    const summary = await backfillForecasts(
      { prisma, fetchForecasts: fetchForecasts as never } as never,
      { from: JAN, to: JAN, leads: [24, 48, 72] },
    );

    expect(summary.chunksSkipped).toBe(3);
    expect(summary.chunksRun).toBe(0);
    expect(fetchForecasts).not.toHaveBeenCalled();
  });

  it('reads the completed set once, not once per chunk', async () => {
    const { prisma, queries } = fakeStore();

    await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: MAR, leads: [24, 48, 72] },
    );

    expect(queries.filter((q) => q === 'pipelineRun.findMany')).toHaveLength(1);
  });

  it('records PARTIAL for a short month without failing the walk', async () => {
    const { prisma } = fakeStore();
    const short = jest.fn(async (window: { start: Date }, leadHours: number) =>
      hours(10, window.start, leadHours),
    );

    const summary = await backfillForecasts(
      { prisma, fetchForecasts: short as never } as never,
      { from: JAN, to: JAN, leads: [24] },
    );

    expect(summary.byStatus.PARTIAL).toBe(1);
    expect(summary.chunksRun).toBe(1);
  });

  it('stops and propagates when a chunk fails, leaving earlier chunks recorded', async () => {
    const { prisma, runs } = fakeStore();
    let calls = 0;
    const failsOnThird = jest.fn(async (window: { start: Date; end: Date }, lead: number) => {
      calls += 1;
      if (calls === 3) throw new Error('open-meteo rate limited');
      return hours((window.end.getTime() - window.start.getTime()) / 3_600_000 + 1, window.start, lead);
    });

    await expect(
      backfillForecasts(
        { prisma, fetchForecasts: failsOnThird as never } as never,
        { from: JAN, to: MAR, leads: [24, 48, 72] },
      ),
    ).rejects.toThrow('rate limited');

    expect(calls).toBe(3);
    expect(runs.filter((r) => r.status === 'OK')).toHaveLength(2);
    expect(runs.filter((r) => r.status === 'FAILED')).toHaveLength(1);
  });

  it('resumes after a failure, skipping what already landed', async () => {
    const { prisma, runs } = fakeStore();
    let calls = 0;
    const flaky = jest.fn(async (window: { start: Date; end: Date }, lead: number) => {
      calls += 1;
      if (calls === 2) throw new Error('transient');
      return hours((window.end.getTime() - window.start.getTime()) / 3_600_000 + 1, window.start, lead);
    });

    await expect(
      backfillForecasts({ prisma, fetchForecasts: flaky as never } as never,
        { from: JAN, to: JAN, leads: [24, 48, 72] }),
    ).rejects.toThrow('transient');

    const resumed = await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      { from: JAN, to: JAN, leads: [24, 48, 72] },
    );

    // The first chunk landed OK before the failure and is skipped on resume.
    expect(resumed.chunksSkipped).toBe(1);
    expect(resumed.chunksRun).toBe(2);
    expect(runs.filter((r) => r.status === 'OK')).toHaveLength(3);
  });

  it('reports progress per chunk', async () => {
    const { prisma } = fakeStore();
    const seen: string[] = [];

    await backfillForecasts(
      { prisma, fetchForecasts: fullMonths() as never } as never,
      {
        from: JAN, to: JAN, leads: [24, 48],
        onChunk: (result, index, total) => seen.push(`${index}/${total}:${result.leadHours}`),
      },
    );

    expect(seen).toEqual(['1/2:24', '2/2:48']);
  });
});
