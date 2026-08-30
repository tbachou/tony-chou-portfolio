import { config as loadEnvFile } from 'dotenv';

import { OPEN_METEO_MODEL } from '../config';
import { forecastsAsOf } from '../asof/forecasts.repository';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import { fetchPreviousRuns } from '../openmeteo/client';
import { assertStorableLead } from '../openmeteo/parse';
import { selectChangedForecasts } from './forecast-diff';
import {
  clampWindowTo,
  expectedHourCount,
  isWindowElapsed,
  judgeForecastCompleteness,
  monthWindow,
} from './forecast-window';
import { writeForecasts } from './forecast-write';
import { ensureGauge } from './ingest-observations';
import type { IngestWindow } from './window';

export interface ForecastIngestDeps {
  prisma: PrismaClient;
  /** Injected in tests; production uses the real Open-Meteo client. */
  fetchForecasts?: typeof fetchPreviousRuns;
  /** Injected in tests so the two time axes can be driven apart. */
  now?: () => Date;
}

export interface ForecastIngestResult {
  runId: string;
  status: RunStatus;
  rowsWritten: number;
  hoursReturned: number;
  hoursExpected: number;
  leadHours: number;
  /** The hours actually requested, clamped to exclude the future. */
  window: IngestWindow;
  /** The calendar month the chunk stands for, recorded on the run. */
  month: IngestWindow;
}

/**
 * Ingests one calendar month of one lead into the forecast store.
 *
 * This is the backfill's atomic chunk (AC-R5): one request, one `PipelineRun`
 * carrying the month's boundaries, one lead. The caller walks months and leads;
 * nothing here loops over either.
 *
 * The run row is created before anything is fetched and it is created already
 * saying FAILED, so a process killed halfway leaves a row that tells the truth.
 * Only a run that reached the end gets to call itself OK. Same contract as
 * `ingestObservations`.
 *
 * The whole chunk costs a bounded handful of statements (AC-R16): one gauge
 * upsert, one run insert, one read of everything already held for this
 * (month, lead), one insert per thousand changed rows, one run update. The
 * comparison happens in memory. Nothing here issues a statement per hour, and a
 * change that makes it do so is a defect even if the rows come out right, since
 * the store bills by operation.
 *
 * Nothing updates or deletes a forecast row. A revised value is a new row with
 * a later `recordedAt`, and that is the only way this store ever changes.
 */
export async function ingestForecastMonth(
  deps: ForecastIngestDeps,
  within: Date,
  leadHours: number,
): Promise<ForecastIngestResult> {
  assertStorableLead(leadHours);

  const { prisma } = deps;
  const clock = deps.now ?? (() => new Date());
  const fetchForecasts = deps.fetchForecasts ?? fetchPreviousRuns;

  const startedAt = clock();
  const month = monthWindow(within);
  // Never ask for an hour that has not happened yet: Open-Meteo either rejects
  // the request outright or answers with future hours that are not the fixed
  // lead they claim to be.
  const window = clampWindowTo(month, startedAt);
  const monthElapsed = isWindowElapsed(month, startedAt);
  const gauge = await ensureGauge(prisma);

  const run = await prisma.pipelineRun.create({
    data: {
      job: 'OPEN_METEO_INGEST',
      startedAt,
      status: 'FAILED',
      rowsWritten: 0,
      windowStart: month.start,
      windowEnd: month.end,
      // What makes a resumed backfill able to tell two runs for the same month
      // apart. Without it, this month at lead 24 and at lead 48 are identical
      // rows and AC-R5's skip has nothing to key on.
      leadHours,
    },
  });

  let rowsWritten = 0;

  try {
    const values = await fetchForecasts(window, leadHours);

    // Captured after the fetch, not at run start. Every row a run writes shares
    // this one instant, and it has to be a time by which we genuinely held the
    // data: stamping rows with the run's start would claim we knew them before
    // the request came back, which is the direction that leaks.
    const recordedAt = clock();

    // One query for the whole chunk. The diff below runs against this set in
    // memory (AC-R16).
    const known = await forecastsAsOf(
      prisma,
      gauge.id,
      OPEN_METEO_MODEL,
      leadHours,
      window.start,
      window.end,
      recordedAt,
    );

    const changed = selectChangedForecasts(values, known);
    const status: RunStatus = judgeForecastCompleteness(
      values.length,
      window,
      monthElapsed,
    );

    await writeForecasts(
      prisma,
      gauge.id,
      run.id,
      recordedAt,
      OPEN_METEO_MODEL,
      changed,
      (written) => {
        rowsWritten = written;
      },
    );

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { finishedAt: clock(), status, rowsWritten },
    });

    return {
      runId: run.id,
      status,
      rowsWritten,
      hoursReturned: values.length,
      hoursExpected: expectedHourCount(window),
      leadHours,
      window,
      month,
    };
  } catch (cause) {
    // rowsWritten carries whatever landed before the failure, so the run row
    // says how far it got rather than claiming nothing happened.
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
  // Only the entry point reads .env, never the library path.
  loadEnvFile();

  const [monthArg, leadArg] = process.argv.slice(2);
  if (!monthArg || !leadArg) {
    console.error('usage: tsx src/ingest/ingest-forecasts.ts <YYYY-MM> <leadHours>');
    process.exitCode = 1;
  } else {
    const prisma = createPrismaClient();

    ingestForecastMonth(
      { prisma },
      new Date(`${monthArg}-01T00:00:00.000Z`),
      Number(leadArg),
    )
      .then((result) => {
        // Counts and status only. No forecast value, nothing that could carry
        // the connection string into a public build log.
        console.log(
          `open-meteo ingest ${result.status}: ${result.rowsWritten} rows, ` +
            `${result.hoursReturned}/${result.hoursExpected} hours, ` +
            `lead ${result.leadHours}, run ${result.runId}`,
        );
      })
      .catch((cause: unknown) => {
        console.error(`open-meteo ingest failed: ${sanitizeError(cause)}`);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}
