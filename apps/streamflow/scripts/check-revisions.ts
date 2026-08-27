import { config as loadEnvFile } from 'dotenv';

import { createPrismaClient } from '../src/db';
import { sanitizeError } from '../src/errors';

/**
 * The gate the seeding hindcast rests on, re measured on demand.
 *
 * The hindcast is the only caller of the loose `validTime` knowability axis.
 * A loose walk asks what a reading says now rather than what it said at the
 * time, which is sound only while no reading has ever been revised: with no
 * corrected value in the store there is nothing for a loose walk to reach for
 * that a strict one would have hidden. That property was measured as 0 of
 * 86,509 on 2026-08-25, and it is not permanent, because a USGS review can
 * add a revision at any time.
 *
 * So it is re measured before any re run rather than assumed, which is what
 * the falling regime child's AC-F6 requires. A non zero count is not a
 * failure of this script. It means the loose axis decision needs revisiting
 * before the walk rather than after it.
 *
 * Read only. Safe against the live store, and that is where it is meant to
 * run: the live store is the only one whose answer matters. Exits non zero
 * when the property no longer holds, so it can gate a re seed in a shell.
 */
async function main() {
  loadEnvFile();
  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.findFirstOrThrow();

    // The unique key allows one row per (gauge, validTime, recordedAt), so
    // more than one row on a validTime is exactly a revision.
    const [counts] = await prisma.$queryRaw<
      { readings: bigint; valid_times: bigint; revised: bigint }[]
    >`
      SELECT
        COALESCE(SUM(revisions), 0)           AS readings,
        COUNT(*)                              AS valid_times,
        COUNT(*) FILTER (WHERE revisions > 1) AS revised
      FROM (
        SELECT "validTime", COUNT(*) AS revisions
        FROM "observations"
        WHERE "gaugeId" = ${gauge.id}
        GROUP BY "validTime"
      ) per_valid_time
    `;

    const readings = Number(counts.readings);
    const validTimes = Number(counts.valid_times);
    const revised = Number(counts.revised);

    console.log(`gauge              : ${gauge.name}`);
    console.log(`observation rows   : ${readings.toLocaleString()}`);
    console.log(`distinct validTimes: ${validTimes.toLocaleString()}`);
    console.log(`revised validTimes : ${revised.toLocaleString()}`);
    console.log('');

    if (revised === 0) {
      console.log(
        `CLEAR: 0 of ${validTimes.toLocaleString()} readings carries more than one revision.`,
      );
      console.log(
        'The loose validTime axis the hindcast walks is still sound, so a re seed may proceed.',
      );
      return;
    }

    console.log(
      `HALT: ${revised.toLocaleString()} validTime values carry more than one row.`,
    );
    console.log(
      'The hindcast walks the loose validTime axis, which holds only while no reading',
    );
    console.log(
      'has been revised. That is no longer true, so the axis decision in the hindcast',
    );
    console.log(
      'seeding child needs revisiting before the walk. Do not re seed yet.',
    );
    process.exitCode = 1;
  } catch (cause: unknown) {
    console.error(`revision check failed: ${sanitizeError(cause)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

/* istanbul ignore next -- CLI entry, run by hand rather than by a workflow */
if (require.main === module) {
  void main();
}
