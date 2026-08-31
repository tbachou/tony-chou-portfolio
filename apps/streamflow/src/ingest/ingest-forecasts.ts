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

export interface ForecastWindowResult {
  runId: string;
  status: RunStatus;
  rowsWritten: number;
  hoursReturned: number;
  hoursExpected: number;
  leadHours: number;
  /** The hours actually requested. */
  window: IngestWindow;
  /** What the run row says it covered, which is not always what was asked for. */
  recorded: IngestWindow;
}

export interface ForecastIngestResult extends Omit<ForecastWindowResult, 'recorded'> {
  /** The calendar month the chunk stands for, recorded on the run. */
  month: IngestWindow;
}

/** One unit of forecast ingest: what to ask for, what to record, how to judge it. */
export interface ForecastIngestPlan {
  /** The hours to request. */
  requested: IngestWindow;
  /**
   * What the `PipelineRun` row says it covered. The backfill records the whole
   * calendar month even when the request was clamped short at the live edge,
   * because the month is the resume key and a clamped window is not one.
   */
  recorded: IngestWindow;
  /** Turns the hours that came back into the run's status. */
  judge: (hoursReturned: number, requested: IngestWindow) => RunStatus;
}

/**
 * Ingests one window of one lead into the forecast store.
 *
 * The shared core behind both callers: the backfill's month chunk and the live
 * job's rolling window. They differ only in which hours they ask for, what the
 * run row says they covered, and how a short response is judged, so all three
 * arrive as the plan and nothing else is duplicated. Keeping one core matters
 * more than it looks: the run row lifecycle below is subtle in three separate
 * places, and two copies of it would drift.
 *
 * The plan arrives as a function of the run's start rather than as a value, so
 * that both callers derive their window from the same instant this run records
 * as `startedAt`. Reading the clock twice would let the window and the run row
 * disagree, which is the sort of skew that shows up as one missing hour a year.
 *
 * The run row is created before anything is fetched and it is created already
 * saying FAILED, so a process killed halfway leaves a row that tells the truth.
 * Only a run that reached the end gets to call itself OK. Same contract as
 * `ingestObservations`.
 *
 * The whole unit costs a bounded handful of statements (AC-R16): one gauge
 * upsert, one run insert, one read of everything already held for this
 * (window, lead), one insert per thousand changed rows, one run update. The
 * comparison happens in memory. Nothing here issues a statement per hour, and a
 * change that makes it do so is a defect even if the rows come out right, since
 * the store bills by operation.
 *
 * Nothing updates or deletes a forecast row. A revised value is a new row with
 * a later `recordedAt`, and that is the only way this store ever changes.
 */
export async function ingestForecastWindow(
  deps: ForecastIngestDeps,
  leadHours: number,
  planFor: (startedAt: Date) => ForecastIngestPlan,
): Promise<ForecastWindowResult> {
  assertStorableLead(leadHours);

  const { prisma } = deps;
  const clock = deps.now ?? (() => new Date());
  const fetchForecasts = deps.fetchForecasts ?? fetchPreviousRuns;

  const startedAt = clock();
  const { requested, recorded, judge } = planFor(startedAt);
  const gauge = await ensureGauge(prisma);

  const run = await prisma.pipelineRun.create({
    data: {
      job: 'OPEN_METEO_INGEST',
      startedAt,
      status: 'FAILED',
      rowsWritten: 0,
      windowStart: recorded.start,
      windowEnd: recorded.end,
      // What makes a resumed backfill able to tell two runs for the same month
      // apart. Without it, this month at lead 24 and at lead 48 are identical
      // rows and AC-R5's skip has nothing to key on.
      leadHours,
    },
  });

  let rowsWritten = 0;

  try {
    const values = await fetchForecasts(requested, leadHours);

    // Captured after the fetch, not at run start. Every row a run writes shares
    // this one instant, and it has to be a time by which we genuinely held the
    // data: stamping rows with the run's start would claim we knew them before
    // the request came back, which is the direction that leaks.
    const recordedAt = clock();

    // One query for the whole window. The diff below runs against this set in
    // memory (AC-R16).
    const known = await forecastsAsOf(
      prisma,
      gauge.id,
      OPEN_METEO_MODEL,
      leadHours,
      requested.start,
      requested.end,
      recordedAt,
    );

    const changed = selectChangedForecasts(values, known);
    const status = judge(values.length, requested);

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
      hoursExpected: expectedHourCount(requested),
      leadHours,
      window: requested,
      recorded,
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

/**
 * Ingests one calendar month of one lead into the forecast store.
 *
 * This is the backfill's atomic chunk (AC-R5): one request, one `PipelineRun`
 * carrying the month's boundaries, one lead. The caller walks months and leads;
 * nothing here loops over either.
 *
 * The run records the whole month even when the request was clamped short,
 * because the month is the resume key and recording the clamped window would
 * make the chunk unrecognisable to the next run.
 */
export async function ingestForecastMonth(
  deps: ForecastIngestDeps,
  within: Date,
  leadHours: number,
): Promise<ForecastIngestResult> {
  const month = monthWindow(within);

  const { recorded, ...result } = await ingestForecastWindow(
    deps,
    leadHours,
    (startedAt) => ({
      // Never ask for an hour that has not happened yet: Open-Meteo either
      // rejects the request outright or answers with future hours that are not
      // the fixed lead they claim to be.
      requested: clampWindowTo(month, startedAt),
      recorded: month,
      judge: (hoursReturned, window) =>
        judgeForecastCompleteness(hoursReturned, window, isWindowElapsed(month, startedAt)),
    }),
  );

  return { ...result, month: recorded };
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
