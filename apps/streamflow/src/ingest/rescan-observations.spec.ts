import { rescanObservations } from './rescan-observations';
import type { PrismaClient } from '../generated/prisma/client';
import type { Reading, StoredObservation } from '../types';

const GAUGE_ID = 'gauge_darby';

interface FakeOptions {
  provisional?: string[];
  known?: StoredObservation[];
}

function fakePrisma(options: FakeOptions = {}) {
  const createMany = jest.fn(async (args: { data: unknown[] }) => ({
    count: args.data.length,
  }));
  const runUpdates: { where: { id: string }; data: Record<string, unknown> }[] =
    [];
  const runUpdate = jest.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      runUpdates.push(args);
      return {};
    },
  );
  const runCreate = jest.fn(
    async (args: { data: Record<string, unknown> }) => {
      runCreates.push(args);
      return { id: 'run_rescan' };
    },
  );
  const runCreates: { data: Record<string, unknown> }[] = [];

  // provisionalValidTimes and observationsAsOf both come through $queryRaw.
  // The first call of a run is the provisional list, the rest are snapshots.
  let queryCall = 0;
  const queryRaw = jest.fn(async () => {
    queryCall += 1;
    if (queryCall === 1) {
      return (options.provisional ?? []).map((at) => ({
        validTime: new Date(at),
      }));
    }
    return options.known ?? [];
  });

  const prisma = {
    gauge: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: GAUGE_ID,
        usgsSiteId: '03230500',
      })),
    },
    observation: { createMany },
    pipelineRun: { create: runCreate, update: runUpdate },
    $queryRaw: queryRaw,
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    createMany,
    runCreates,
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

function stored(
  validTime: string,
  valueCfs: number,
  qualifier: Reading['qualifier'] = 'PROVISIONAL',
): StoredObservation {
  return {
    gaugeId: GAUGE_ID,
    validTime: new Date(validTime),
    recordedAt: new Date('2025-11-26T12:05:00Z'),
    valueCfs,
    qualifier,
  };
}

const NOW = '2026-08-23T18:00:00Z';
const clockOf = () => {
  const at = new Date(NOW);
  return () => at;
};

describe('rescanObservations', () => {
  it('records itself as a rescan, pessimistically failed', async () => {
    const { prisma, runCreates } = fakePrisma();

    await rescanObservations({
      prisma,
      now: clockOf(),
      fetchReadings: async () => [],
    });

    expect(runCreates[0].data).toMatchObject({
      job: 'USGS_RESCAN',
      status: 'FAILED',
    });
  });

  it('reaches back to a provisional reading the forward ingest could never see', async () => {
    const { prisma } = fakePrisma({ provisional: ['2025-11-26T00:00:00Z'] });
    const asked: { start: Date; end: Date }[] = [];

    await rescanObservations({
      prisma,
      now: clockOf(),
      fetchReadings: async (_site, span) => {
        asked.push(span);
        return [];
      },
    });

    // The ordinary window would start two hours ago. This one reaches back to
    // the provisional reading itself, which is the entire point of the job.
    const stranded = new Date('2025-11-26T00:00:00Z');
    expect(asked[0].start.getTime()).toBeLessThanOrEqual(stranded.getTime());
    expect(asked[0].end.getTime()).toBeGreaterThanOrEqual(stranded.getTime());
  });

  it('writes a new row when a provisional reading has been approved', async () => {
    const { prisma, createMany } = fakePrisma({
      provisional: ['2025-11-26T12:00:00Z'],
      known: [stored('2025-11-26T12:00:00Z', 1060, 'PROVISIONAL')],
    });

    const result = await rescanObservations({
      prisma,
      now: clockOf(),
      fetchReadings: async () => [
        reading('2025-11-26T12:00:00Z', 1060, 'APPROVED'),
      ],
    });

    expect(result.rowsWritten).toBeGreaterThan(0);
    const rows = (createMany.mock.calls[0][0] as { data: unknown[] }).data;
    // Same value, new qualifier, new row. The old row is untouched.
    expect(rows[0]).toMatchObject({
      valueCfs: 1060,
      qualifier: 'APPROVED',
      ingestRunId: 'run_rescan',
    });
  });

  it('writes nothing when a re-poll finds everything unchanged', async () => {
    const { prisma, createMany } = fakePrisma({
      provisional: ['2025-11-26T12:00:00Z'],
      known: [stored('2025-11-26T12:00:00Z', 1060, 'PROVISIONAL')],
    });

    const result = await rescanObservations({
      prisma,
      now: clockOf(),
      fetchReadings: async () => [reading('2025-11-26T12:00:00Z', 1060)],
    });

    expect(result.rowsWritten).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('does not call a historical gap partial', async () => {
    const { prisma } = fakePrisma({
      provisional: ['2025-11-26T12:00:00Z'],
      known: [stored('2025-11-26T12:00:00Z', 1060)],
    });

    const result = await rescanObservations({
      prisma,
      now: clockOf(),
      fetchReadings: async () => [reading('2025-11-26T12:00:00Z', 1060)],
    });

    expect(result.status).toBe('OK');
  });

  it('reports PARTIAL when the source has less than the store holds', async () => {
    const { prisma } = fakePrisma({
      provisional: ['2025-11-26T12:00:00Z'],
      known: [
        stored('2025-11-26T12:00:00Z', 1060),
        stored('2025-11-26T12:15:00Z', 1050),
      ],
    });

    const result = await rescanObservations({
      prisma,
      now: clockOf(),
      fetchReadings: async () => [reading('2025-11-26T12:00:00Z', 1060)],
    });

    expect(result.status).toBe('PARTIAL');
  });

  it('records a failed rescan with a sanitized error, then rethrows', async () => {
    const { prisma, runUpdates } = fakePrisma();

    await expect(
      rescanObservations({
        prisma,
        now: clockOf(),
        fetchReadings: async () => {
          throw new Error('boom at postgres://u:p@db.example.com/x');
        },
      }),
    ).rejects.toThrow(/boom/);

    expect(runUpdates[0].data.status).toBe('FAILED');
    expect(runUpdates[0].data.error).not.toContain('db.example.com');
  });
});
