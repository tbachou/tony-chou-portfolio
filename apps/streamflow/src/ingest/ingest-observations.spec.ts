import { ingestObservations } from './ingest-observations';
import type { PrismaClient } from '../generated/prisma/client';
import type { Reading, StoredObservation } from '../types';

const GAUGE_ID = 'gauge_darby';

interface FakeOptions {
  latestValidTime?: Date | null;
  known?: StoredObservation[];
}

/**
 * A stand in for the Prisma client that records what the job asked it to do.
 * Fully in memory: these tests never reach a database.
 */
function fakePrisma(options: FakeOptions = {}) {
  const createMany = jest.fn(async (args: unknown) => ({
    count: (args as { data: unknown[] }).data.length,
  }));
  const runUpdates: { where: { id: string }; data: Record<string, unknown> }[] =
    [];
  const runUpdate = jest.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      runUpdates.push(args);
      return {};
    },
  );
  const runCreate = jest.fn(async () => ({ id: 'run_1' }));

  const prisma = {
    gauge: {
      upsert: jest.fn(async () => ({
        id: GAUGE_ID,
        usgsSiteId: '03230500',
      })),
    },
    observation: {
      findFirst: jest.fn(async () =>
        options.latestValidTime === undefined || options.latestValidTime === null
          ? null
          : { validTime: options.latestValidTime },
      ),
      createMany,
    },
    pipelineRun: { create: runCreate, update: runUpdate },
    $queryRaw: jest.fn(async () => options.known ?? []),
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    createMany,
    runCreate,
    runUpdate,
    runUpdates,
  };
}

function reading(
  validTime: string,
  valueCfs: number,
  qualifier: Reading['qualifier'] = 'PROVISIONAL',
): Reading {
  return { validTime: new Date(validTime), valueCfs, qualifier };
}

/**
 * A full complement of readings for the window an ingest asks for after a
 * normal six hour cycle: 15:45 through 18:00 at a quarter hour, which is what
 * a healthy gauge returns and therefore what an OK run looks like.
 */
function fullWindow(): Reading[] {
  const readings: Reading[] = [];
  for (let minutes = 0; minutes <= 135; minutes += 15) {
    readings.push(
      reading(
        new Date(
          new Date('2026-08-23T15:45:00Z').getTime() + minutes * 60 * 1000,
        ).toISOString(),
        1060 - minutes,
      ),
    );
  }
  return readings;
}

/** Run start, then the instant after the fetch returns, then the finish. */
function clockOf(...times: string[]) {
  const dates = times.map((time) => new Date(time));
  let index = 0;
  return () => dates[Math.min(index++, dates.length - 1)];
}

const NOW = '2026-08-23T18:00:00Z';
const AFTER_FETCH = '2026-08-23T18:00:04Z';

describe('ingestObservations', () => {
  it('records the run before fetching, and records it as failed', async () => {
    const { prisma, runCreate } = fakePrisma();

    await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => [],
    });

    // A process killed mid run then leaves a row that tells the truth.
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ job: 'USGS_INGEST', status: 'FAILED' }),
      }),
    );
  });

  it('writes the changed readings and closes the run as OK', async () => {
    const { prisma, createMany, runUpdate } = fakePrisma({
      latestValidTime: new Date('2026-08-23T17:45:00Z'),
    });

    const result = await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => fullWindow(),
    });

    expect(result.status).toBe('OK');
    expect(result.rowsWritten).toBe(10);
    expect(createMany.mock.calls[0][0]).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ gaugeId: GAUGE_ID, valueCfs: 1060 }),
      ]),
    });
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run_1' },
        data: expect.objectContaining({ status: 'OK', rowsWritten: 10 }),
      }),
    );
  });

  it('stamps every row of a run with one recordedAt, taken after the fetch', async () => {
    const { prisma, createMany } = fakePrisma({
      latestValidTime: new Date('2026-08-23T17:45:00Z'),
    });

    await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => fullWindow(),
    });

    const rows = (createMany.mock.calls[0][0] as { data: { recordedAt: Date }[] })
      .data;
    const stamps = new Set(rows.map((row) => row.recordedAt.toISOString()));

    expect(stamps.size).toBe(1);
    // After the fetch, never at run start: claiming we held data before the
    // request returned is the direction that leaks.
    expect([...stamps][0]).toBe('2026-08-23T18:00:04.000Z');
  });

  it('writes nothing when the window is unchanged', async () => {
    const { prisma, createMany, runUpdate } = fakePrisma({
      latestValidTime: new Date('2026-08-23T17:45:00Z'),
      known: fullWindow().map((entry) => ({
        gaugeId: GAUGE_ID,
        validTime: entry.validTime,
        recordedAt: new Date('2026-08-23T17:50:00Z'),
        valueCfs: entry.valueCfs,
        qualifier: entry.qualifier,
      })),
    });

    const result = await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => fullWindow(),
    });

    expect(result.rowsWritten).toBe(0);
    // Nothing changed, so no insert is issued at all.
    expect(createMany).not.toHaveBeenCalled();
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OK', rowsWritten: 0 }),
      }),
    );
  });

  it('writes a row when only the qualifier settled', async () => {
    const { prisma, createMany } = fakePrisma({
      latestValidTime: new Date('2026-08-23T17:45:00Z'),
      known: [
        {
          gaugeId: GAUGE_ID,
          validTime: new Date('2026-08-23T17:45:00Z'),
          recordedAt: new Date('2026-08-23T17:50:00Z'),
          valueCfs: 1060,
          qualifier: 'PROVISIONAL',
        },
      ],
    });

    await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => [
        reading('2026-08-23T17:45:00Z', 1060, 'APPROVED'),
      ],
    });

    expect(createMany.mock.calls[0][0]).toMatchObject({
      data: [expect.objectContaining({ qualifier: 'APPROVED', valueCfs: 1060 })],
    });
  });

  it('asks for the whole gap after a missed run', async () => {
    const { prisma } = fakePrisma({
      latestValidTime: new Date('2026-08-22T12:00:00Z'),
    });
    const seen: { start: Date; end: Date }[] = [];

    const result = await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async (_site, window) => {
        seen.push(window);
        return [];
      },
    });

    expect(seen[0].start.toISOString()).toBe('2026-08-22T10:00:00.000Z');
    expect(result.window.end.toISOString()).toBe('2026-08-23T18:00:00.000Z');
  });

  it('reads the store as of the same instant it stamps the rows with', async () => {
    const { prisma } = fakePrisma({
      latestValidTime: new Date('2026-08-23T17:45:00Z'),
    });

    await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => [],
    });

    const queryArgs = (prisma.$queryRaw as unknown as jest.Mock).mock.calls[0];
    expect(JSON.stringify(queryArgs)).toContain('2026-08-23T18:00:04.000Z');
  });

  it('reports PARTIAL when the sensor returned fewer readings than the window implies', async () => {
    const { prisma } = fakePrisma({
      latestValidTime: new Date('2026-08-23T17:45:00Z'),
    });

    // The window implies ten readings; one arriving means the gauge is down.
    const result = await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => [reading('2026-08-23T17:45:00Z', 1060)],
    });

    expect(result.status).toBe('PARTIAL');
  });

  it('records a failed run with a sanitized error, then rethrows', async () => {
    const { prisma, runUpdates } = fakePrisma();

    await expect(
      ingestObservations({
        prisma,
        now: clockOf(NOW, AFTER_FETCH),
        fetchReadings: async () => {
          throw new Error(
            'connect failed for postgresql://pipeline:hunter2@db.example.com/streamflow',
          );
        },
      }),
    ).rejects.toThrow(/connect failed/);

    const [update] = runUpdates;
    expect(update.data.status).toBe('FAILED');
    expect(update.data.error).not.toContain('hunter2');
    expect(update.data.error).toContain('[redacted connection string]');
  });

  it('writes a large backfill in batches rather than one statement', async () => {
    const { prisma, createMany } = fakePrisma();
    // Twelve thousand readings at a quarter hour, as a real backfill produces.
    const many = Array.from({ length: 12_000 }, (_, index) =>
      reading(
        new Date(
          new Date('2024-01-01T00:00:00Z').getTime() + index * 15 * 60 * 1000,
        ).toISOString(),
        800 + (index % 50),
      ),
    );

    const result = await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => many,
    });

    expect(result.rowsWritten).toBe(12_000);
    expect(createMany).toHaveBeenCalledTimes(3);
    const sizes = createMany.mock.calls.map(
      (call) => (call[0] as { data: unknown[] }).data.length,
    );
    expect(sizes).toEqual([5_000, 5_000, 2_000]);
  });

  it('writes batches in ascending validTime, so a stopped run leaves a prefix', async () => {
    const { prisma, createMany } = fakePrisma();
    const shuffled = [
      reading('2024-01-01T00:30:00Z', 800),
      reading('2024-01-01T00:00:00Z', 810),
      reading('2024-01-01T00:15:00Z', 805),
    ];

    await ingestObservations({
      prisma,
      now: clockOf(NOW, AFTER_FETCH),
      fetchReadings: async () => shuffled,
    });

    const rows = (
      createMany.mock.calls[0][0] as { data: { validTime: Date }[] }
    ).data;
    expect(rows.map((row) => row.validTime.toISOString())).toEqual([
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:15:00.000Z',
      '2024-01-01T00:30:00.000Z',
    ]);
  });

  it('records how far it got when a batch fails partway', async () => {
    const { prisma, runUpdates } = fakePrisma();
    let batch = 0;
    (prisma.observation as unknown as {
      createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
    }).createMany = async (args) => {
      batch += 1;
      if (batch === 2) throw new Error('connection reset');
      return { count: args.data.length };
    };

    const many = Array.from({ length: 8_000 }, (_, index) =>
      reading(
        new Date(
          new Date('2024-01-01T00:00:00Z').getTime() + index * 15 * 60 * 1000,
        ).toISOString(),
        800,
      ),
    );

    await expect(
      ingestObservations({
        prisma,
        now: clockOf(NOW, AFTER_FETCH),
        fetchReadings: async () => many,
      }),
    ).rejects.toThrow(/connection reset/);

    const [update] = runUpdates;
    expect(update.data.status).toBe('FAILED');
    // The first batch landed and the row says so, rather than claiming zero.
    expect(update.data.rowsWritten).toBe(5_000);
  });
});
