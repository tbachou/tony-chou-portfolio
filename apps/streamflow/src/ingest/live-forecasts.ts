import { config as loadEnvFile } from 'dotenv';

import { HORIZON_HOURS, OPEN_METEO_MODEL } from '../config';
import { latestStoredForecastValidTimes } from '../asof/forecasts.repository';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import { judgeWindowCompleteness, liveForecastWindow } from './forecast-window';
import { ensureGauge } from './ingest-observations';
import {
  ingestForecastWindow,
  type ForecastIngestDeps,
  type ForecastWindowResult,
} from './ingest-forecasts';

export interface LiveForecastOptions {
  /** Defaults to every horizon the forecasters issue at. */
  leads?: readonly number[];
  /** Called after each lead, for a line of progress per run. */
  onLead?: (result: ForecastWindowResult) => void;
}

/** One lead that did not finish, with its error already made safe to print. */
export interface LeadFailure {
  leadHours: number;
  /** Sanitised, so a caller may log it. Never carries the connection string. */
  error: string;
}

export interface LiveForecastSummary {
  leadsRun: number;
  leadsFailed: number;
  rowsWritten: number;
  byStatus: Record<RunStatus, number>;
  /**
   * The leads that failed and why, carried out rather than logged here.
   *
   * Nothing in this workspace logs from a library function; the CLI entry does
   * the printing. Returning the reason keeps that split and makes the failure
   * path testable without spying on the console.
   */
  failures: LeadFailure[];
}

/**
 * Keeps the forecast store current, one `PipelineRun` per lead (AC-R13).
 *
 * This is the scheduled counterpart to the backfill. The backfill fills history
 * in calendar month chunks and stops; this runs at 00, 06, 12 and 18 UTC for
 * ever, ahead of the prediction job, so a forecaster issuing at those times has
 * a complete rain window to read rather than a null one.
 *
 * **The window comes from the store, never from the schedule**, which is what
 * AC-R13 asks for and what the parent's AC-6 already asks of the USGS ingest.
 * Nothing here consults the cron, so a missed run is not a special case: the
 * start is the greatest `validTime` already held at that lead, so a job that
 * has not run for two days asks for two days and the gap closes itself. That is
 * the whole reason the edge is measured rather than assumed, and it is why a
 * schedule GitHub runs late, or drops entirely after sixty quiet days, costs
 * nothing but latency.
 *
 * **One run per lead, three runs a cycle.** A `PipelineRun` carries a single
 * `leadHours`, and a run of this job written without one is a defect rather
 * than a variant, so the three leads cannot share a row. They are independent
 * anyway: each feeds one horizon, and AC-R10 skips a forecaster per horizon
 * rather than globally.
 *
 * **A failing lead does not stop the others.** The backfill takes the opposite
 * choice and stops its walk, because ninety more requests against a service
 * that is evidently unhappy help nobody. Here there are three requests, and
 * denying lead 72 its window because lead 24 failed would lose a horizon for
 * six hours to save one request. Each lead records its own run row, the summary
 * counts what failed, and the process still exits non zero, so a silent
 * degradation is not on the table.
 *
 * Cost is a handful of statements per cycle in the spirit of AC-R16: one gauge
 * upsert, one grouped read of the stored edge for every lead at once, then the
 * bounded handful `ingestForecastWindow` promises per lead. Four times a day
 * that is on the order of two thousand operations a month against an allowance
 * of two hundred thousand.
 */
export async function ingestLiveForecasts(
  deps: ForecastIngestDeps,
  options: LiveForecastOptions = {},
): Promise<LiveForecastSummary> {
  const { prisma } = deps;
  const leads = options.leads ?? HORIZON_HOURS;

  // Needed before any run starts, because the edge read is keyed on the gauge.
  // An upsert rather than a lookup so a fresh database takes the same path; the
  // core upserts again per lead, which is idempotent and costs one statement.
  const gauge = await ensureGauge(prisma);

  // One grouped query for every lead, not one per lead. The three leads run to
  // different edges, so a single maximum across the table would drag the
  // shorter leads forward past hours they never fetched.
  const storedEdge = await latestStoredForecastValidTimes(
    prisma,
    gauge.id,
    OPEN_METEO_MODEL,
  );

  const summary: LiveForecastSummary = {
    leadsRun: 0,
    leadsFailed: 0,
    rowsWritten: 0,
    byStatus: { OK: 0, PARTIAL: 0, FAILED: 0 },
    failures: [],
  };

  for (const leadHours of leads) {
    try {
      const result = await ingestForecastWindow(deps, leadHours, (startedAt) => {
        // Derived from the run's own start, so the window and the row that
        // records it cannot disagree.
        const window = liveForecastWindow(
          storedEdge.get(leadHours) ?? null,
          leadHours,
          startedAt,
        );

        return {
          requested: window,
          // The live run covers exactly what it asked for. There is no month
          // behind it, and recording one would put a chunk in the resume set
          // that nobody fetched.
          recorded: window,
          // The plain rule, without the backfill's refusal to call a month in
          // progress OK. A live window always ends one lead ahead of now, so
          // that refusal would mark every live run PARTIAL for ever.
          judge: judgeWindowCompleteness,
        };
      });

      summary.leadsRun += 1;
      summary.rowsWritten += result.rowsWritten;
      summary.byStatus[result.status] += 1;
      options.onLead?.(result);
    } catch (cause) {
      // Caught only so the remaining leads still run. The reason is carried out
      // in the summary rather than dropped, because the run row cannot be
      // relied on to hold it: `ingestForecastWindow` creates that row after it
      // has already upserted the gauge and read the clock, so a failure in
      // those first steps leaves no row at all. That is the narrow case where
      // swallowing the error bare would have left a red CI step with nothing in
      // it to diagnose from.
      summary.leadsFailed += 1;
      summary.byStatus.FAILED += 1;
      summary.failures.push({ leadHours, error: sanitizeError(cause) });
    }
  }

  return summary;
}

/* istanbul ignore next -- CLI entry, exercised by the workflow rather than tests */
if (require.main === module) {
  loadEnvFile();

  const prisma = createPrismaClient();

  ingestLiveForecasts({ prisma } as ForecastIngestDeps & { prisma: PrismaClient }, {
    onLead: (result) => {
      // Counts and status only, never a forecast value.
      console.log(
        `lead ${result.leadHours}h ${result.status}: ${result.rowsWritten} rows, ` +
          `${result.hoursReturned}/${result.hoursExpected} hours, run ${result.runId}`,
      );
    },
  })
    .then((summary) => {
      console.log(
        `open-meteo live ingest: ${summary.leadsRun} leads, ` +
          `${summary.rowsWritten} rows, OK ${summary.byStatus.OK} ` +
          `PARTIAL ${summary.byStatus.PARTIAL} FAILED ${summary.byStatus.FAILED}`,
      );

      // Named per lead, so a red step says which lead failed and why. Already
      // sanitised, so this cannot carry the connection string into a public
      // build log.
      for (const failure of summary.failures) {
        console.error(`lead ${failure.leadHours}h failed: ${failure.error}`);
      }

      // The other leads still ran, but the job as a whole did not do what it
      // was asked to.
      if (summary.leadsFailed > 0) process.exitCode = 1;
    })
    .catch((cause: unknown) => {
      console.error(`open-meteo live ingest failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
