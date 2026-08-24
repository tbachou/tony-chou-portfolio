import { config as loadEnvFile } from 'dotenv';

import { GAUGE } from '../config';
import { observationsAsOf, provisionalValidTimes } from '../asof/observations.repository';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import { fetchInstantaneousValues } from '../usgs/client';
import { selectChangedReadings } from './diff';
import { judgeRescanCompleteness, spansForRescan } from './rescan-window';
import { writeObservations } from './write';
import type { IngestWindow } from './window';

export interface RescanDeps {
  prisma: PrismaClient;
  fetchReadings?: typeof fetchInstantaneousValues;
  now?: () => Date;
}

export interface RescanResult {
  runId: string;
  status: RunStatus;
  rowsWritten: number;
  spans: IngestWindow[];
}

/**
 * Re-polls the stretches of river USGS may still change its mind about (AC-19).
 *
 * The forward ingest only ever looks at the live edge, because its window is
 * anchored to the newest reading it holds. That is the right shape for keeping
 * up, and it is structurally blind to the event this whole store exists to
 * capture: an approval landing on a reading from months back, with the value
 * possibly corrected on the way. This job is what makes those visible.
 *
 * It writes through exactly the same comparison the forward ingest uses, so a
 * re-poll that finds nothing changed writes nothing, and a re-poll that finds a
 * settled reading writes a new row rather than touching the old one.
 */
export async function rescanObservations(deps: RescanDeps): Promise<RescanResult> {
  const { prisma } = deps;
  const clock = deps.now ?? (() => new Date());
  const fetchReadings = deps.fetchReadings ?? fetchInstantaneousValues;

  const startedAt = clock();
  const gauge = await prisma.gauge.findUniqueOrThrow({
    where: { usgsSiteId: GAUGE.usgsSiteId },
  });

  const spans = spansForRescan(
    await provisionalValidTimes(prisma, gauge.id),
    startedAt,
  );

  const run = await prisma.pipelineRun.create({
    data: {
      job: 'USGS_RESCAN',
      startedAt,
      status: 'FAILED',
      rowsWritten: 0,
      // The outer bounds of what was asked for. The spans between them are not
      // necessarily contiguous, which the run row cannot express and does not
      // need to: what matters here is how far back the rescan reached.
      windowStart: spans[0]?.start,
      windowEnd: spans[spans.length - 1]?.end,
    },
  });

  let rowsWritten = 0;
  let received = 0;
  let alreadyStored = 0;

  try {
    for (const span of spans) {
      const readings = await fetchReadings(gauge.usgsSiteId, span);
      const recordedAt = clock();

      const known = await observationsAsOf(
        prisma,
        gauge.id,
        span.start,
        span.end,
        recordedAt,
      );

      received += readings.length;
      alreadyStored += known.length;

      rowsWritten += await writeObservations(
        prisma,
        gauge.id,
        run.id,
        recordedAt,
        selectChangedReadings(readings, known),
      );
    }

    const status: RunStatus = judgeRescanCompleteness(received, alreadyStored);

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { finishedAt: clock(), status, rowsWritten },
    });

    return { runId: run.id, status, rowsWritten, spans };
  } catch (cause) {
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        finishedAt: clock(),
        status: 'FAILED',
        rowsWritten,
        error: sanitizeError(cause),
      },
    });
    throw cause;
  }
}

/* istanbul ignore next -- CLI entry, exercised by the workflow rather than tests */
if (require.main === module) {
  loadEnvFile();

  const prisma = createPrismaClient();

  rescanObservations({ prisma })
    .then((result) => {
      console.log(
        `usgs rescan ${result.status}: ${result.rowsWritten} rows over ${result.spans.length} span(s), run ${result.runId}`,
      );
    })
    .catch((cause: unknown) => {
      console.error(`usgs rescan failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
