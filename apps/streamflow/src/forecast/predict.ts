import { config as loadEnvFile } from 'dotenv';

import { BACKFILL_START, HORIZON_HOURS, MIN_BUCKET_ERRORS } from '../config';
import { observationsAsOf } from '../asof/observations.repository';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient, RunStatus } from '../generated/prisma/client';
import type { StoredObservation } from '../types';
import { persistenceForecast } from './baselines';
import { bucketRatiosFromStore } from './bucket.repository';
import type { BucketReader } from './bucket.repository';
import { intervalFromErrors } from './interval';
import { BASELINE_MODELS } from './models';
import { classifyRegime } from './regime';
import type { Regime } from './regime';
import { mostRecentIssueSlot } from './schedule';

const HOUR_MS = 60 * 60 * 1000;

/** One prediction, ready to be written. Field names match the columns. */
export interface PredictionDraft {
  gaugeId: string;
  modelVersionId: string;
  issuedAt: Date;
  targetTime: Date;
  horizonHours: number;
  centralCfs: number;
  lowerCfs: number;
  upperCfs: number;
  intervalLevel: number;
  issueRegime: Regime | null;
  intervalSeeded: boolean;
  intervalClamped: boolean;
  q10Used: number | null;
  q90Used: number | null;
  bucketSize: number;
  hindcast: boolean;
}

export interface DraftContext {
  gaugeId: string;
  timeZone: string;
  models: readonly { id: string; name: string }[];
  history: readonly StoredObservation[];
  issuedAt: Date;
  hindcast: boolean;
}

/**
 * Every prediction one issue slot should produce, with its interval.
 *
 * Separate from the job that writes them so the whole decision, which model
 * can answer, which regime it was issued into, which bucket the bounds came
 * from, is testable against a stubbed reader rather than only against a live
 * database. The seeding hindcast calls this too, with `hindcast` true and a
 * history reconstructed at its simulated instant.
 *
 * A model that cannot honestly answer is skipped rather than filled in.
 * Climatology genuinely cannot answer during the first year of the record,
 * having no earlier year to average, and inventing a number there would put a
 * claim on the scorecard that no forecaster ever made.
 */
export async function draftPredictions(
  prisma: BucketReader,
  context: DraftContext,
): Promise<{ drafts: PredictionDraft[]; skipped: number }> {
  const { gaugeId, timeZone, models, history, issuedAt, hindcast } = context;

  // The regime is a property of the moment, not of the forecaster, so it is
  // judged once and shared by every row this slot writes.
  const valueAtIssue = persistenceForecast(history, issuedAt);
  const issueRegime =
    valueAtIssue === null
      ? null
      : classifyRegime(history, issuedAt, valueAtIssue);

  const drafts: PredictionDraft[] = [];
  let skipped = 0;

  for (const model of models) {
    const baseline = BASELINE_MODELS.find((known) => known.name === model.name);
    if (!baseline) {
      // A ModelVersion row with no forecaster behind it. Skipped rather than
      // guessed at, and the run's PARTIAL status is what surfaces it.
      skipped += HORIZON_HOURS.length;
      continue;
    }

    for (const horizonHours of HORIZON_HOURS) {
      const targetTime = new Date(issuedAt.getTime() + horizonHours * HOUR_MS);
      const centralCfs = baseline.central(
        history,
        issuedAt,
        targetTime,
        timeZone,
      );

      if (centralCfs === null) {
        skipped += 1;
        continue;
      }

      const criteria = {
        gaugeId,
        modelVersionId: model.id,
        horizonHours,
        issuedAt,
      };

      // Conditioned first, and pooled only when it is needed. An
      // unclassifiable regime has no conditioned bucket to ask for, which is
      // the whole of the unclassifiable path: an empty bucket cannot reach
      // the minimum, so the ladder falls to pooled by itself.
      const conditioned = issueRegime
        ? await bucketRatiosFromStore(prisma, { ...criteria, issueRegime })
        : [];
      const pooled =
        conditioned.length >= MIN_BUCKET_ERRORS
          ? []
          : await bucketRatiosFromStore(prisma, criteria);

      const interval = intervalFromErrors(centralCfs, conditioned, pooled);

      drafts.push({
        gaugeId,
        modelVersionId: model.id,
        issuedAt,
        targetTime,
        horizonHours,
        centralCfs,
        issueRegime,
        hindcast,
        ...interval,
      });
    }
  }

  return { drafts, skipped };
}

export interface PredictDeps {
  prisma: PrismaClient;
  /** Injected in tests so the issue slot can be driven. */
  now?: () => Date;
}

export interface PredictResult {
  runId: string;
  status: RunStatus;
  rowsWritten: number;
  issuedAt: Date;
  skipped: number;
}

/**
 * Makes sure both baselines exist as rows, and returns them.
 *
 * An upsert for the same reason the gauge is one: a fresh database and a
 * redeploy take the same path, and the row's attributes stay owned by one
 * place. This is where AC-7 actually holds, since a baseline that exists only
 * as a function is not something a prediction can point at.
 */
export async function ensureBaselines(prisma: PrismaClient) {
  const rows = [];
  for (const model of BASELINE_MODELS) {
    rows.push(
      await prisma.modelVersion.upsert({
        where: { name: model.name },
        update: {},
        create: { name: model.name, kind: 'BASELINE', active: true },
      }),
    );
  }
  return rows;
}

/**
 * Issues one slot's predictions: every active forecaster, every horizon.
 *
 * Like the ingest job, the run row is created before any work and created
 * already saying FAILED, so a process killed halfway leaves behind a row that
 * tells the truth.
 *
 * The write skips duplicates rather than updating them. A retried run lands
 * on the same issue slot, and a prediction's bounds are written once and
 * never recomputed: re-deriving them from a bucket that has grown since would
 * quietly rewrite history in the forecaster's favour.
 */
export async function issuePredictions(
  deps: PredictDeps,
): Promise<PredictResult> {
  const { prisma } = deps;
  const clock = deps.now ?? (() => new Date());

  const startedAt = clock();
  const issuedAt = mostRecentIssueSlot(startedAt);

  const run = await prisma.pipelineRun.create({
    data: {
      job: 'PREDICT',
      startedAt,
      status: 'FAILED',
      rowsWritten: 0,
      windowStart: issuedAt,
      windowEnd: issuedAt,
    },
  });

  let rowsWritten = 0;

  try {
    const gauge = await prisma.gauge.findFirst({ where: { active: true } });
    if (!gauge) {
      throw new Error('no active gauge to forecast for');
    }

    const models = await ensureBaselines(prisma);

    // The whole record as known at the issue instant. Climatology needs every
    // earlier year, so this cannot be a short window, and reading it once per
    // slot rather than once per forecaster keeps six predictions to one read.
    const history = await observationsAsOf(
      prisma,
      gauge.id,
      BACKFILL_START,
      issuedAt,
      issuedAt,
    );

    const { drafts, skipped } = await draftPredictions(prisma, {
      gaugeId: gauge.id,
      timeZone: gauge.timezone,
      models,
      history,
      issuedAt,
      hindcast: false,
    });

    const written = await prisma.prediction.createMany({
      data: drafts,
      skipDuplicates: true,
    });
    rowsWritten = written.count;

    // PARTIAL carries the same meaning it does for ingestion: the run
    // completed but produced fewer rows than the request implies. For this
    // job that is a forecaster which could not honestly answer, which is
    // expected through the first year, when climatology has no earlier year.
    const status: RunStatus = skipped > 0 ? 'PARTIAL' : 'OK';

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { finishedAt: clock(), status, rowsWritten },
    });

    return { runId: run.id, status, rowsWritten, issuedAt, skipped };
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

  issuePredictions({ prisma })
    .then((result) => {
      // Counts and status only, never a forecast value or a connection string.
      console.log(
        `predict ${result.status}: ${result.rowsWritten} rows, ${result.skipped} skipped, issued ${result.issuedAt.toISOString()}, run ${result.runId}`,
      );
    })
    .catch((cause: unknown) => {
      console.error(`predict failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
