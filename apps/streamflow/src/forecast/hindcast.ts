import { config as loadEnvFile } from 'dotenv';

import { BACKFILL_START } from '../config';
import { createPrismaClient } from '../db';
import { sanitizeError } from '../errors';
import type { PrismaClient } from '../generated/prisma/client';
import type { StoredObservation } from '../types';
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
 */
export interface HindcastDeps {
  prisma: PrismaClient;
  /** Defaults to the start of the record. */
  from?: Date;
  /** Defaults to now. */
  to?: Date;
  onProgress?: (done: number, total: number, written: number) => void;
}

export interface HindcastResult {
  slots: number;
  predictionsWritten: number;
  scoresWritten: number;
}

export async function runHindcast(
  deps: HindcastDeps,
): Promise<HindcastResult> {
  const { prisma } = deps;
  const from = deps.from ?? BACKFILL_START;
  const to = deps.to ?? new Date();

  const gauge = await prisma.gauge.findFirst({ where: { active: true } });
  if (!gauge) {
    throw new Error('no active gauge to hindcast for');
  }

  // Active only, matching the live job. Seeding buckets for a forecaster
  // that will never issue again would be work nothing reads.
  const models = (await ensureBaselines(prisma)).filter((model) => model.active);
  const floorCfs = await flowFloorCfs(prisma, gauge);
  const slots = issueSlots(from, to);

  // The whole record once, ordered by when we learned each row. Reconstructing
  // the as of view per slot with a database round trip would be thousands of
  // reads of a table that does not change while this runs; ordering by
  // recordedAt instead lets one forward pass maintain the same view in memory.
  const everything = await prisma.observation.findMany({
    where: { gaugeId: gauge.id },
    select: {
      gaugeId: true,
      validTime: true,
      recordedAt: true,
      valueCfs: true,
      qualifier: true,
    },
    orderBy: [{ recordedAt: 'asc' }, { validTime: 'asc' }],
  });

  // validTime to the newest revision learned so far. Because the rows arrive
  // in recordedAt order, a later row for a validTime is always the newer
  // revision, so assigning it is the same rule the as of reconstruction
  // applies, carried forward one slot at a time.
  const known = new Map<number, StoredObservation>();
  let cursor = 0;

  let predictionsWritten = 0;
  let scoresWritten = 0;

  for (const [index, slot] of slots.entries()) {
    while (
      cursor < everything.length &&
      everything[cursor].recordedAt.getTime() <= slot.getTime()
    ) {
      const row = everything[cursor];
      known.set(row.validTime.getTime(), row);
      cursor += 1;
    }

    const history = [...known.values()];

    const { drafts } = await draftPredictions(prisma, {
      gaugeId: gauge.id,
      timeZone: gauge.timezone,
      models,
      history,
      issuedAt: slot,
      hindcast: true,
    });

    if (drafts.length > 0) {
      const written = await prisma.prediction.createMany({
        data: drafts,
        skipDuplicates: true,
      });
      predictionsWritten += written.count;
    }

    // Scored at the simulated instant, not at the real one, so a hindcast
    // score can never name a revision that had not been learned by then.
    const scorable = await scorablePredictions(prisma, gauge.id, slot, true);
    if (scorable.length > 0) {
      const written = await prisma.score.createMany({
        data: draftScores(scorable, history, floorCfs, slot),
        skipDuplicates: true,
      });
      scoresWritten += written.count;
    }

    deps.onProgress?.(index + 1, slots.length, predictionsWritten);
  }

  return { slots: slots.length, predictionsWritten, scoresWritten };
}

/* istanbul ignore next -- CLI entry, run by hand rather than by a workflow */
if (require.main === module) {
  loadEnvFile();

  const prisma = createPrismaClient();

  runHindcast({
    prisma,
    onProgress: (done, total, written) => {
      // Every hundredth slot, so a walk of thousands stays readable.
      if (done % 100 === 0 || done === total) {
        console.log(`  ${done}/${total} slots, ${written} predictions`);
      }
    },
  })
    .then((result) => {
      console.log(
        `hindcast done: ${result.slots} slots, ${result.predictionsWritten} predictions, ${result.scoresWritten} scores`,
      );
    })
    .catch((cause: unknown) => {
      console.error(`hindcast failed: ${sanitizeError(cause)}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
