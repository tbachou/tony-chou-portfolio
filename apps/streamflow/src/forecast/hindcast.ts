import { config as loadEnvFile } from 'dotenv';

import { asOfWalk } from '../asof/as-of';
import { BACKFILL_START } from '../config';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient } from '../generated/prisma/client';
import type { KnowabilityAxis } from '../types';
import { draftPredictions, ensureBaselines } from './predict';
import { draftScores } from './score';
import { flowFloorCfs, scorablePredictions } from './score.repository';
import { issueSlots } from './schedule';

/**
 * Seeds every baseline's error distribution across the backfilled record, so
 * intervals exist on day one instead of arriving months later.
 *
 * It walks six hourly issue slots from the start of the record forward,
 * predicting and scoring each slot before moving to the next. That order is
 * the whole point and it is what makes this slow. Doing it in bulk, all
 * predictions and then all scores, would give every seeded row the fixed
 * placeholder band, because no bucket would have filled at the moment its
 * prediction was built. The calibration view would then show near perfect
 * coverage across most of the record, which would be a comfortable lie.
 *
 * Rows are written with `hindcast` true. They are ordinary in every other
 * respect: they feed the interval buckets, and only the public read helper
 * filters them out. Storing bare quantiles instead would leave every early
 * interval resting on a number nobody could recompute.
 *
 * Safe to re-run and safe to interrupt. Both writes skip duplicates, so a
 * second pass over ground already covered writes nothing.
 *
 * It is the only caller of the loose knowability axis, and everything it reads
 * is on that axis. Over the archive the strict axis returns nothing at all,
 * because the whole record was imported in one pass and shares one
 * `recordedAt`, so a strict walk asks what was knowable in October 2024 and
 * correctly answers that the pipeline did not exist yet. A second caller
 * appearing on this axis is a review failure rather than a style preference.
 *
 * What the axis costs is stated in the spec and worth repeating here: over the
 * archive the walk reads USGS readings that have already been reviewed, while
 * a live forecast only ever sees provisional ones. Seeded intervals are drawn
 * from slightly cleaner inputs than the live system gets. That is disclosed on
 * the dashboard rather than corrected.
 *
 * The soundness rests on a measured property of today's store, that no
 * `validTime` in it has more than one revision, so there is no corrected value
 * a loose walk could reach for. Re measure it before re running this against a
 * store that has moved on.
 */
export interface HindcastDeps {
  prisma: PrismaClient;
  /**
   * Where to start. Left out, the walk resumes from the newest slot it has
   * already written, or from the start of the record when it has written
   * none.
   */
  from?: Date;
  /** Defaults to now. */
  to?: Date;
  onProgress?: (done: number, total: number, written: number) => void;
}

export interface HindcastResult {
  slots: number;
  from: Date;
  predictionsWritten: number;
  scoresWritten: number;
  /**
   * Rows the walk drafted that the store already held.
   *
   * Expected, and equal to the whole draft, when ground is walked twice. Not
   * expected on fresh ground, where it means a live run reached the same
   * issue slot first: the unique key on (gauge, model, issuedAt, targetTime)
   * does not include `hindcast`, so whichever write lands first wins and the
   * other disappears. Counted rather than ignored so that collision is
   * visible while someone is still watching the run, instead of surfacing
   * months later as a prediction stuck on the placeholder band.
   */
  predictionsSkipped: number;
  scoresSkipped: number;
}

/**
 * The slot to pick up from, so an interrupted walk does not start over.
 *
 * Returns the newest slot already written rather than the one after it. That
 * slot may have been interrupted between its prediction write and its score
 * write, and redoing a complete slot costs one round trip while skipping a
 * half done one would leave its scores missing for good.
 */
async function resumeFrom(
  prisma: PrismaClient,
  gaugeId: string,
): Promise<Date | null> {
  const newest = await prisma.prediction.findFirst({
    where: { gaugeId, hindcast: true },
    orderBy: { issuedAt: 'desc' },
    select: { issuedAt: true },
  });

  return newest?.issuedAt ?? null;
}

export async function runHindcast(
  deps: HindcastDeps,
): Promise<HindcastResult> {
  const { prisma } = deps;
  const to = deps.to ?? new Date();

  // The only place this is chosen, named once so every read below is on it.
  const axis: KnowabilityAxis = 'validTime';

  const gauge = await prisma.gauge.findFirst({ where: { active: true } });
  if (!gauge) {
    throw new Error('no active gauge to hindcast for');
  }

  const from =
    deps.from ?? (await resumeFrom(prisma, gauge.id)) ?? BACKFILL_START;

  // Active only, matching the live job. Seeding buckets for a forecaster
  // that will never issue again would be work nothing reads.
  const models = (await ensureBaselines(prisma)).filter((model) => model.active);
  const floorCfs = await flowFloorCfs(prisma, gauge);
  const slots = issueSlots(from, to);

  // The whole record once. Reconstructing the as of view per slot with a
  // database round trip would be thousands of reads of a table that does not
  // change while this runs, and `asOfWalk` carries the same reconstruction
  // forward in memory for the price of one pass over the rows.
  const everything = await prisma.observation.findMany({
    where: { gaugeId: gauge.id },
    select: {
      gaugeId: true,
      validTime: true,
      recordedAt: true,
      valueCfs: true,
      qualifier: true,
    },
  });

  const historyAt = asOfWalk(everything, axis);

  let predictionsWritten = 0;
  let scoresWritten = 0;
  let predictionsSkipped = 0;
  let scoresSkipped = 0;

  for (const [index, slot] of slots.entries()) {
    // Slots walk forward, which is the one thing `asOfWalk` needs and cannot
    // check: its cursor never goes back.
    const history = historyAt(slot);

    const { drafts } = await draftPredictions(prisma, {
      gaugeId: gauge.id,
      timeZone: gauge.timezone,
      models,
      history,
      issuedAt: slot,
      hindcast: true,
      axis,
      flowFloorCfs: floorCfs,
    });

    if (drafts.length > 0) {
      const written = await prisma.prediction.createMany({
        data: drafts,
        skipDuplicates: true,
      });
      predictionsWritten += written.count;
      predictionsSkipped += drafts.length - written.count;
    }

    // Scored at the simulated instant, not at the real one, so a hindcast
    // score can only ever judge a forecast whose target had already passed by
    // the moment being simulated.
    const scorable = await scorablePredictions(
      prisma,
      gauge.id,
      slot,
      true,
      axis,
    );
    if (scorable.length > 0) {
      const scoreDrafts = draftScores(scorable, history, floorCfs, slot);
      const written = await prisma.score.createMany({
        data: scoreDrafts,
        skipDuplicates: true,
      });
      scoresWritten += written.count;
      scoresSkipped += scoreDrafts.length - written.count;
    }

    deps.onProgress?.(index + 1, slots.length, predictionsWritten);
  }

  return {
    slots: slots.length,
    from,
    predictionsWritten,
    scoresWritten,
    predictionsSkipped,
    scoresSkipped,
  };
}

/**
 * Reads `--from=<iso>` and `--to=<iso>` off the command line.
 *
 * Both are optional. Leaving `--from` out is the ordinary case and lets the
 * walk resume where it stopped; passing it is how an operator redoes a
 * stretch on purpose, `--from=2024-01-01T00:00:00Z` to start over.
 */
/* istanbul ignore next -- CLI entry, run by hand rather than by a workflow */
function instantArg(name: string): Date | undefined {
  const raw = process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

  if (raw === undefined) return undefined;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--${name} is not a date this can read: ${raw}`);
  }
  return parsed;
}

/* istanbul ignore next -- CLI entry, run by hand rather than by a workflow */
if (require.main === module) {
  loadEnvFile();

  const prisma = createPrismaClient();

  runHindcast({
    prisma,
    from: instantArg('from'),
    to: instantArg('to'),
    onProgress: (done, total, written) => {
      // Every hundredth slot, so a walk of thousands stays readable.
      if (done % 100 === 0 || done === total) {
        console.log(`  ${done}/${total} slots, ${written} predictions`);
      }
    },
  })
    .then((result) => {
      console.log(
        `hindcast done: ${result.slots} slots from ${result.from.toISOString()}, ${result.predictionsWritten} predictions, ${result.scoresWritten} scores`,
      );

      // Loud, because on ground this walk has not covered before it means a
      // live run took the same issue slot and one of the two writes is gone.
      // Silent on a re-run, where every skip is the walk recognising its own
      // earlier work.
      if (result.predictionsSkipped > 0 || result.scoresSkipped > 0) {
        console.warn(
          `hindcast skipped rows the store already held: ${result.predictionsSkipped} predictions, ${result.scoresSkipped} scores. Expected when re-walking covered ground; on fresh ground it means a live run reached the same issue slot first.`,
        );
      }
    })
    .catch((cause: unknown) => {
      console.error(`hindcast failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
