import { config as loadEnvFile } from 'dotenv';

import { BACKFILL_START, HORIZON_HOURS, OPEN_METEO_MODEL } from '../config';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import { monthWindow, nextMonthWindow } from './forecast-window';
import {
  ingestForecastMonth,
  type ForecastIngestDeps,
  type ForecastIngestResult,
} from './ingest-forecasts';

/**
 * The reads this module needs, named structurally so a test can supply a plain
 * object, matching how `ObservationReader` is declared.
 */
export type RunReader = {
  pipelineRun: Pick<PrismaClient['pipelineRun'], 'findMany'>;
};

/** Identifies one backfill chunk: a calendar month at one lead. */
export function chunkKey(windowStart: Date, leadHours: number): string {
  return `${windowStart.getTime()}:${leadHours}`;
}

/**
 * Every calendar month from the one containing `from` to the one containing
 * `to`, inclusive at both ends, as month start instants in UTC.
 */
export function monthStartsBetween(from: Date, to: Date): Date[] {
  const starts: Date[] = [];
  let window = monthWindow(from);
  const last = monthWindow(to).start.getTime();

  while (window.start.getTime() <= last) {
    starts.push(window.start);
    window = nextMonthWindow(window);
  }

  return starts;
}

/**
 * The (month, lead) chunks already recorded `OK`, read in one query (AC-R5).
 *
 * `PARTIAL` is deliberately not treated as finished. The archive ramps in at
 * its start, so the earliest months legitimately return fewer hours than their
 * window implies, and a later re-run may find the service has since filled
 * them. Skipping a `PARTIAL` month would freeze that gap permanently. Re-running
 * a month that really is complete costs one request and writes nothing, which
 * is the cheap side of the trade.
 */
export async function completedForecastChunks(
  prisma: RunReader,
): Promise<Set<string>> {
  const runs = await prisma.pipelineRun.findMany({
    where: { job: 'OPEN_METEO_INGEST', status: 'OK' },
    select: { windowStart: true, leadHours: true },
  });

  const done = new Set<string>();
  for (const run of runs) {
    if (run.windowStart === null || run.leadHours === null) continue;
    done.add(chunkKey(run.windowStart, run.leadHours));
  }

  return done;
}

export interface BackfillOptions {
  /** Defaults to the configured backfill start. */
  from?: Date;
  /** Defaults to the clock's now, so the backfill reaches the live edge. */
  to?: Date;
  /** Defaults to every horizon the forecasters issue at. */
  leads?: readonly number[];
  model?: string;
  /** Called after each chunk, for progress on a run that takes minutes. */
  onChunk?: (result: ForecastIngestResult, index: number, total: number) => void;
}

export interface BackfillSummary {
  chunksTotal: number;
  chunksSkipped: number;
  chunksRun: number;
  rowsWritten: number;
  byStatus: Record<RunStatus, number>;
}

/**
 * Walks every calendar month at every lead, ingesting the ones not already done.
 *
 * The unit of work is `ingestForecastMonth`: one request, one `PipelineRun`, one
 * bounded handful of statements. This function only decides which chunks to run
 * and in what order, so the cost guarantee in AC-R16 is inherited rather than
 * restated.
 *
 * Resumability is read from the store, not from a cursor file or a schedule
 * (AC-R5). A chunk already recorded `OK` is skipped, so an interrupted backfill
 * re-run costs one query plus the chunks that genuinely remain. Re-running a
 * completed month writes zero rows even when it is not skipped, because the
 * diff finds nothing changed, so the skip is an optimisation over a guarantee
 * rather than the guarantee itself.
 *
 * A failing chunk stops the walk and propagates, rather than carrying on
 * through ninety more requests against a service that is evidently unhappy.
 * Nothing is lost: the chunks that finished recorded themselves, and the next
 * run resumes after them.
 *
 * Month major rather than lead major, so an interrupted run leaves a contiguous
 * prefix of fully covered months instead of one lead running far ahead of the
 * others.
 */
export async function backfillForecasts(
  deps: ForecastIngestDeps & { prisma: PrismaClient & RunReader },
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const clock = deps.now ?? (() => new Date());
  const from = options.from ?? BACKFILL_START;
  const to = options.to ?? clock();
  const leads = options.leads ?? HORIZON_HOURS;
  const model = options.model ?? OPEN_METEO_MODEL;

  const done = await completedForecastChunks(deps.prisma);
  const months = monthStartsBetween(from, to);

  const summary: BackfillSummary = {
    chunksTotal: months.length * leads.length,
    chunksSkipped: 0,
    chunksRun: 0,
    rowsWritten: 0,
    byStatus: { OK: 0, PARTIAL: 0, FAILED: 0 },
  };

  let index = 0;

  for (const month of months) {
    for (const leadHours of leads) {
      index += 1;

      if (done.has(chunkKey(month, leadHours))) {
        summary.chunksSkipped += 1;
        continue;
      }

      const result = await ingestForecastMonth(deps, month, leadHours, model);

      summary.chunksRun += 1;
      summary.rowsWritten += result.rowsWritten;
      summary.byStatus[result.status] += 1;
      options.onChunk?.(result, index, summary.chunksTotal);
    }
  }

  return summary;
}

/* istanbul ignore next -- CLI entry, exercised by the workflow rather than tests */
if (require.main === module) {
  loadEnvFile();

  const prisma = createPrismaClient();

  backfillForecasts(
    { prisma },
    {
      onChunk: (result, index, total) => {
        // Counts and status only, never a forecast value.
        console.log(
          `[${index}/${total}] ${result.window.start.toISOString().slice(0, 7)} ` +
            `lead ${result.leadHours}h  ${result.status}  ` +
            `${result.rowsWritten} rows  ${result.hoursReturned}/${result.hoursExpected} hours`,
        );
      },
    },
  )
    .then((summary) => {
      console.log(
        `backfill done: ${summary.chunksRun} run, ${summary.chunksSkipped} skipped, ` +
          `${summary.rowsWritten} rows, ` +
          `OK ${summary.byStatus.OK} PARTIAL ${summary.byStatus.PARTIAL}`,
      );
    })
    .catch((cause: unknown) => {
      console.error(`backfill failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
