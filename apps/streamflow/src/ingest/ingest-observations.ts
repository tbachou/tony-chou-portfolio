import {
  EXPECTED_INTERVAL_MINUTES,
  GAUGE,
} from '../config';
import { latestStoredValidTime, observationsAsOf } from '../asof/observations.repository';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import { fetchInstantaneousValues } from '../usgs/client';
import { selectChangedReadings } from './diff';
import { computeIngestWindow, judgeCompleteness, type IngestWindow } from './window';

export interface IngestDeps {
  prisma: PrismaClient;
  /** Injected in tests; production uses the real USGS client. */
  fetchReadings?: typeof fetchInstantaneousValues;
  /** Injected in tests so the two time axes can be driven apart. */
  now?: () => Date;
}

export interface IngestResult {
  runId: string;
  status: RunStatus;
  rowsWritten: number;
  window: IngestWindow;
}

/**
 * Makes sure the gauge row exists and matches the constants in `config.ts`.
 *
 * An upsert rather than a seed script, so a fresh database and a redeploy take
 * the same path and the gauge's own attributes stay owned by one place.
 */
async function ensureGauge(prisma: PrismaClient) {
  return prisma.gauge.upsert({
    where: { usgsSiteId: GAUGE.usgsSiteId },
    update: {
      name: GAUGE.name,
      lat: GAUGE.lat,
      lon: GAUGE.lon,
      timezone: GAUGE.timezone,
    },
    create: {
      usgsSiteId: GAUGE.usgsSiteId,
      name: GAUGE.name,
      lat: GAUGE.lat,
      lon: GAUGE.lon,
      timezone: GAUGE.timezone,
      active: true,
    },
  });
}

/**
 * Ingests one USGS window into the bitemporal store.
 *
 * The run row is created before any reading is fetched, and it is created
 * already saying FAILED. A process killed halfway then leaves behind a row
 * that tells the truth, which is the whole point of recording runs: only a run
 * that got to the end gets to call itself OK.
 *
 * Nothing here updates or deletes an observation. A changed reading is a new
 * row with a later `recordedAt`, and that is the only way the store ever
 * changes.
 */
export async function ingestObservations(deps: IngestDeps): Promise<IngestResult> {
  const { prisma } = deps;
  const clock = deps.now ?? (() => new Date());
  const fetchReadings = deps.fetchReadings ?? fetchInstantaneousValues;

  const startedAt = clock();
  const gauge = await ensureGauge(prisma);
  const window = computeIngestWindow(
    await latestStoredValidTime(prisma, gauge.id),
    startedAt,
  );

  const run = await prisma.pipelineRun.create({
    data: {
      job: 'USGS_INGEST',
      startedAt,
      status: 'FAILED',
      rowsWritten: 0,
      windowStart: window.start,
      windowEnd: window.end,
    },
  });

  try {
    const readings = await fetchReadings(gauge.usgsSiteId, window);

    // Captured after the fetch, not at run start. Every row a run writes shares
    // this one instant, and it has to be a time by which we genuinely held the
    // data: stamping rows with the run's start would claim we knew them before
    // the request came back, which is the direction that leaks.
    const recordedAt = clock();

    const known = await observationsAsOf(
      prisma,
      gauge.id,
      window.start,
      window.end,
      recordedAt,
    );
    const changed = selectChangedReadings(readings, known);

    const status: RunStatus = judgeCompleteness(
      readings.length,
      window,
      EXPECTED_INTERVAL_MINUTES,
    );

    await prisma.$transaction([
      prisma.observation.createMany({
        data: changed.map((reading) => ({
          gaugeId: gauge.id,
          validTime: reading.validTime,
          recordedAt,
          valueCfs: reading.valueCfs,
          qualifier: reading.qualifier,
          ingestRunId: run.id,
        })),
      }),
      prisma.pipelineRun.update({
        where: { id: run.id },
        data: { finishedAt: clock(), status, rowsWritten: changed.length },
      }),
    ]);

    return { runId: run.id, status, rowsWritten: changed.length, window };
  } catch (cause) {
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { finishedAt: clock(), status: 'FAILED', error: sanitizeError(cause) },
    });
    throw cause;
  }
}

/* istanbul ignore next -- CLI entry, exercised by the workflow rather than tests */
if (require.main === module) {
  const prisma = createPrismaClient();

  ingestObservations({ prisma })
    .then((result) => {
      // Counts and status only. No reading, no window content, nothing that
      // could carry the connection string into a public build log.
      console.log(
        `usgs ingest ${result.status}: ${result.rowsWritten} rows, run ${result.runId}`,
      );
    })
    .catch((cause: unknown) => {
      console.error(`usgs ingest failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
