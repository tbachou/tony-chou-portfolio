import { config as loadEnvFile } from 'dotenv';

import { createPrismaClient } from '../src/db';
import { sanitizeError } from '../src/errors';
import { runHindcast } from '../src/forecast/hindcast';

/**
 * Rebuilds the seeded error history under the current regime taxonomy.
 *
 * Adding a regime changes how past slots are labelled, and the seeded
 * quantiles were built under the old labels, so the flaw the falling regime
 * fixes is already inside them. Re running the walk is the only way to move
 * it: a prediction's bounds are written once and never recomputed, so nothing
 * updates in place.
 *
 * What it does, in the order AC-F6 fixes:
 *
 *   1. Re measures the zero revision property, because the walk reads the
 *      loose validTime axis and that axis is only sound while it holds.
 *      Non zero halts before anything is deleted.
 *   2. Deletes hindcast scores, then hindcast predictions. That order is
 *      required: the foreign key from Score to Prediction has no cascade, so
 *      predictions cannot go first.
 *   3. Re runs the walk.
 *
 * It never touches a row where `hindcast` is false. Live predictions keep the
 * bounds they were written with and keep the `issueRegime` they were written
 * with (AC-F7, AC-F10), including the forty eight issued during the first
 * recession under the three state taxonomy. Rewriting those would edit a
 * public record to make it look better, which is worse than carrying the
 * noise.
 *
 * Destructive, so it refuses to run without `--confirm`. Sequencing matters
 * beyond that flag and this script cannot enforce it: turn the forecasting
 * switch off first, because the prediction unique key does not include
 * `hindcast`, so a live run reaching the same issue slot wins and the walk's
 * row disappears. Skipped rows are counted and reported, so a collision is
 * visible while someone is still watching.
 *
 * Expect thirty to sixty minutes of sequential round trips. Watch it.
 */
async function main() {
  const confirmed = process.argv.includes('--confirm');

  loadEnvFile();
  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.findFirstOrThrow();

    const [revisions] = await prisma.$queryRaw<{ revised: bigint }[]>`
      SELECT COUNT(*) FILTER (WHERE revisions > 1) AS revised
      FROM (
        SELECT "validTime", COUNT(*) AS revisions
        FROM "observations"
        WHERE "gaugeId" = ${gauge.id}
        GROUP BY "validTime"
      ) per_valid_time
    `;

    const revised = Number(revisions.revised);
    if (revised !== 0) {
      console.error(
        `HALT: ${revised.toLocaleString()} validTime values carry more than one revision.`,
      );
      console.error(
        'The walk reads the loose validTime axis, which holds only while that count is',
      );
      console.error(
        'zero. Revisit the axis decision in the hindcast seeding child before re seeding.',
      );
      process.exitCode = 1;
      return;
    }

    const predictions = await prisma.prediction.count({
      where: { gaugeId: gauge.id, hindcast: true },
    });
    const scores = await prisma.score.count({
      where: { prediction: { gaugeId: gauge.id, hindcast: true } },
    });
    const live = await prisma.prediction.count({
      where: { gaugeId: gauge.id, hindcast: false },
    });

    console.log(`gauge                : ${gauge.name}`);
    console.log(`revised validTimes   : 0, so the loose axis still holds`);
    console.log(`hindcast predictions : ${predictions.toLocaleString()}  (will be deleted and rebuilt)`);
    console.log(`hindcast scores      : ${scores.toLocaleString()}  (will be deleted and rebuilt)`);
    console.log(`live predictions     : ${live.toLocaleString()}  (untouched)`);
    console.log('');

    if (!confirmed) {
      console.log('Dry run. Nothing was deleted and nothing was written.');
      console.log('');
      console.log('Before re running for real:');
      console.log('  1. Turn the forecasting switch off, so no live run collides with the walk');
      console.log('     (repository variable STREAMFLOW_FORECASTING, set to anything but true).');
      console.log('  2. Re run this with --confirm, and watch it. Thirty to sixty minutes.');
      console.log('  3. Report the buckets: npm run report:buckets --workspace=apps/streamflow');
      console.log('  4. Turn the forecasting switch back on.');
      return;
    }

    // Scores first. The foreign key from Score to Prediction has no cascade,
    // so deleting predictions first fails on every score still pointing at
    // one, and a partial delete would leave the walk to resume from rows it
    // cannot reconcile.
    console.log('deleting hindcast scores...');
    const deletedScores = await prisma.score.deleteMany({
      where: { prediction: { gaugeId: gauge.id, hindcast: true } },
    });
    console.log(`  ${deletedScores.count.toLocaleString()} scores deleted`);

    console.log('deleting hindcast predictions...');
    const deletedPredictions = await prisma.prediction.deleteMany({
      where: { gaugeId: gauge.id, hindcast: true },
    });
    console.log(`  ${deletedPredictions.count.toLocaleString()} predictions deleted`);

    const stillLive = await prisma.prediction.count({
      where: { gaugeId: gauge.id, hindcast: false },
    });
    if (stillLive !== live) {
      throw new Error(
        `live predictions changed from ${live} to ${stillLive} during the delete; stopping before the walk`,
      );
    }
    console.log(`  ${stillLive.toLocaleString()} live predictions untouched, as counted before`);

    console.log('');
    console.log('re running the hindcast...');
    const result = await runHindcast({
      prisma,
      onProgress: (done, total, written) => {
        if (done % 100 === 0 || done === total) {
          console.log(`  ${done}/${total} slots, ${written} predictions`);
        }
      },
    });

    console.log('');
    console.log(
      `re seed done: ${result.slots} slots from ${result.from.toISOString()}, ${result.predictionsWritten} predictions, ${result.scoresWritten} scores`,
    );

    if (result.predictionsSkipped > 0 || result.scoresSkipped > 0) {
      console.warn(
        `skipped rows the store already held: ${result.predictionsSkipped} predictions, ${result.scoresSkipped} scores. On ground just cleared this means a live run reached the same issue slot, so the forecasting switch was probably still on.`,
      );
    }

    console.log('');
    console.log('Now report the buckets, which AC-F5 asks to be measured rather than assumed:');
    console.log('  npm run report:buckets --workspace=apps/streamflow');
  } catch (cause: unknown) {
    console.error(`re seed failed: ${sanitizeError(cause)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

/* istanbul ignore next -- CLI entry, run by hand rather than by a workflow */
if (require.main === module) {
  void main();
}
