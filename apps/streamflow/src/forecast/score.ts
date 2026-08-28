import { config as loadEnvFile } from 'dotenv';

import { BACKFILL_START } from '../config';
import { observationsAsOf } from '../asof/observations.repository';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import type { StoredObservation } from '../types';
import { classifyRegime } from './regime';
import type { Regime } from './regime';
import { flowFloorCfs, scorablePredictions } from './score.repository';
import type { ScorableRow } from './score.repository';

/** One score, ready to be written. Field names match the columns. */
export interface ScoreDraft {
  predictionId: string;
  scoredAt: Date;
  actualCfs: number;
  actualRecordedAt: Date;
  absError: number;
  pctError: number;
  withinInterval: boolean;
  regime: Regime | null;
}

/**
 * Judges one prediction against one revision of the truth.
 *
 * `regime` is the river at the target instant, which is a different question
 * from the one `Prediction.issueRegime` answers. That one is what the river
 * was doing when the forecast was made, and it is all a forecaster can see.
 * This one is what the river turned out to be doing, and it is what decides
 * whether the forecast was any good. Reporting splits by this; intervals draw
 * on the other. The gap between the two is the forecasting problem itself.
 *
 * It is nullable because the classifier can legitimately refuse, and a forced
 * guess of BASEFLOW would file storm errors under the easy regime and flatter
 * every summary built on top.
 */
export function draftScore(
  row: ScorableRow,
  regime: Regime | null,
  floorCfs: number,
  scoredAt: Date,
): ScoreDraft {
  const absError = Math.abs(row.actualCfs - row.centralCfs);

  return {
    predictionId: row.predictionId,
    scoredAt,
    actualCfs: row.actualCfs,
    actualRecordedAt: row.actualRecordedAt,
    absError,
    // The floor is what stops a near zero reading turning a small miss into a
    // meaningless percentage.
    pctError: absError / Math.max(row.actualCfs, floorCfs),
    withinInterval:
      row.actualCfs >= row.lowerCfs && row.actualCfs <= row.upperCfs,
    regime,
  };
}

/**
 * Scores every prediction that needs it, one draft per row.
 *
 * Separate from the job that writes them so the whole judgement is testable
 * without a database. `history` must be the as of reconstruction at the
 * scoring instant; the regime at each target is read from it.
 */
export function draftScores(
  rows: readonly ScorableRow[],
  history: readonly StoredObservation[],
  floorCfs: number,
  scoredAt: Date,
): ScoreDraft[] {
  return rows.map((row) =>
    draftScore(
      row,
      classifyRegime(history, row.targetTime, row.actualCfs, floorCfs),
      floorCfs,
      scoredAt,
    ),
  );
}

export interface ScoreDeps {
  prisma: PrismaClient;
  /** Injected in tests, and by the hindcast to score at a simulated instant. */
  now?: () => Date;
  /** The hindcast scores its own rows; the live job scores only live ones. */
  hindcast?: boolean;
}

export interface ScoreResult {
  runId: string;
  status: RunStatus;
  rowsWritten: number;
  scoredAt: Date;
}

/**
 * The hourly scoring pass.
 *
 * Scores against whatever revision is current, provisional readings included.
 * Waiting for USGS to approve a reading would leave the dashboard months
 * stale, and a provisional score is not wrong: when the reading is revised,
 * this job writes a second score naming the newer revision rather than
 * correcting the first, so the record keeps both and every score can be
 * explained by the revision it names.
 */
export async function scorePredictions(deps: ScoreDeps): Promise<ScoreResult> {
  const { prisma } = deps;
  const clock = deps.now ?? (() => new Date());
  const hindcast = deps.hindcast ?? false;

  const startedAt = clock();

  const run = await prisma.pipelineRun.create({
    data: {
      job: 'SCORE',
      startedAt,
      status: 'FAILED',
      rowsWritten: 0,
      windowEnd: startedAt,
    },
  });

  let rowsWritten = 0;

  try {
    const gauge = await prisma.gauge.findFirst({ where: { active: true } });
    if (!gauge) {
      throw new Error('no active gauge to score against');
    }

    const rows = await scorablePredictions(
      prisma,
      gauge.id,
      startedAt,
      hindcast,
    );

    if (rows.length > 0) {
      const floorCfs = await flowFloorCfs(prisma, gauge);
      const history = await observationsAsOf(
        prisma,
        gauge.id,
        BACKFILL_START,
        startedAt,
        startedAt,
      );

      const drafts = draftScores(rows, history, floorCfs, clock());

      // Skips duplicates for the same reason the prediction write does: a
      // retried run must not write a second score naming a revision that is
      // already recorded. The unique key on (predictionId, actualRecordedAt)
      // is what makes a re-score an append rather than an edit.
      const written = await prisma.score.createMany({
        data: drafts,
        skipDuplicates: true,
      });
      rowsWritten = written.count;
    }

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { finishedAt: clock(), status: 'OK', rowsWritten },
    });

    return { runId: run.id, status: 'OK', rowsWritten, scoredAt: startedAt };
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

  scorePredictions({ prisma })
    .then((result) => {
      console.log(
        `score ${result.status}: ${result.rowsWritten} rows, run ${result.runId}`,
      );
    })
    .catch((cause: unknown) => {
      console.error(`score failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
