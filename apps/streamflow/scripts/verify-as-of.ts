import { config as loadEnvFile } from 'dotenv';

import { reconstructAsOf } from '../src/asof/as-of';
import { observationsAsOf } from '../src/asof/observations.repository';
import { createPrismaClient } from '../src/db';
import type { StoredObservation } from '../src/types';

/**
 * Proves AC-3 against a real database.
 *
 * The unit tests cover `reconstructAsOf`, which is only the reference
 * statement of the rule. What actually runs in production is the DISTINCT ON
 * query, and no mock can show that the two agree. This reads every row in a
 * window straight out of the table, applies the reference function in
 * TypeScript, and checks the database returns exactly the same thing at a
 * range of asOf instants.
 *
 * Read only. Safe to run against the live store, and it is meant to be:
 * running it there is the point.
 */
async function main() {
  loadEnvFile();
  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.findFirstOrThrow();
    const bounds = await prisma.observation.aggregate({
      where: { gaugeId: gauge.id },
      _min: { validTime: true, recordedAt: true },
      _max: { validTime: true, recordedAt: true },
    });

    const earliest = bounds._min.validTime;
    const latest = bounds._max.validTime;
    const firstRecorded = bounds._min.recordedAt;
    const lastRecorded = bounds._max.recordedAt;

    if (!earliest || !latest || !firstRecorded || !lastRecorded) {
      throw new Error('the store is empty, so there is nothing to verify');
    }

    console.log(`gauge      : ${gauge.name}`);
    console.log(
      `validTime  : ${earliest.toISOString()} to ${latest.toISOString()}`,
    );
    console.log(
      `recordedAt : ${firstRecorded.toISOString()} to ${lastRecorded.toISOString()}`,
    );

    // A window wide enough to hold revisions if any exist, small enough to
    // pull into memory for the reference pass.
    const windowEnd = latest;
    const windowStart = new Date(windowEnd.getTime() - 60 * 24 * 3600 * 1000);

    const everything: StoredObservation[] = await prisma.observation.findMany({
      where: {
        gaugeId: gauge.id,
        validTime: { gte: windowStart, lte: windowEnd },
      },
      select: {
        gaugeId: true,
        validTime: true,
        recordedAt: true,
        valueCfs: true,
        qualifier: true,
      },
    });

    console.log(`\nwindow     : last 60 days, ${everything.length} raw rows`);

    // Instants chosen to straddle every recordedAt in the window, so the
    // temporal filter is exercised rather than merely present.
    const stamps = [...new Set(everything.map((row) => row.recordedAt.getTime()))]
      .sort((a, b) => a - b)
      .flatMap((at) => [at - 1000, at, at + 1000]);
    const probes = [
      new Date(firstRecorded.getTime() - 3600 * 1000),
      ...stamps.map((at) => new Date(at)),
      new Date(lastRecorded.getTime() + 3600 * 1000),
    ];

    let checked = 0;
    for (const asOf of probes) {
      const fromDatabase = await observationsAsOf(
        prisma,
        gauge.id,
        windowStart,
        windowEnd,
        asOf,
      );
      const fromReference = reconstructAsOf(everything, asOf);

      if (fromDatabase.length !== fromReference.length) {
        throw new Error(
          `asOf ${asOf.toISOString()}: database returned ${fromDatabase.length} rows, reference ${fromReference.length}`,
        );
      }

      for (let index = 0; index < fromDatabase.length; index += 1) {
        const left = fromDatabase[index];
        const right = fromReference[index];
        const same =
          left.validTime.getTime() === right.validTime.getTime() &&
          left.recordedAt.getTime() === right.recordedAt.getTime() &&
          left.valueCfs === right.valueCfs &&
          left.qualifier === right.qualifier;

        if (!same) {
          throw new Error(
            `asOf ${asOf.toISOString()}: row ${index} differs. database ${JSON.stringify(left)} reference ${JSON.stringify(right)}`,
          );
        }
      }

      // Nothing the query hands back may postdate the instant asked for.
      for (const row of fromDatabase) {
        if (row.recordedAt.getTime() > asOf.getTime()) {
          throw new Error(
            `asOf ${asOf.toISOString()}: leaked a row recorded at ${row.recordedAt.toISOString()}`,
          );
        }
      }

      checked += 1;
    }

    console.log(`probes     : ${checked} asOf instants, all identical`);
    console.log('\nAC-3 holds: the DISTINCT ON query and the reference agree.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error('as of verification FAILED:', cause);
  process.exitCode = 1;
});
