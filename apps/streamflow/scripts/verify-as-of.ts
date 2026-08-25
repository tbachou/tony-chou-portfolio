import { config as loadEnvFile } from 'dotenv';

import { reconstructAsOf } from '../src/asof/as-of';
import { observationsAsOf } from '../src/asof/observations.repository';
import { createPrismaClient } from '../src/db';
import type { KnowabilityAxis, StoredObservation } from '../src/types';

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
 * Both axes are checked. The strict `recordedAt` axis is AC-3 itself; the
 * `validTime` axis is the fallback the seeding hindcast walks, and it needs
 * the same proof for the same reason, since a second bound in one statement
 * is exactly where a query and its reference quietly stop agreeing.
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

    /**
     * Instants chosen to straddle stamps on the axis under test, so the
     * temporal filter is exercised rather than merely present. Capped,
     * because a sixty day window holds thousands of distinct validTimes and
     * three probes each would be a round trip per quarter hour of the record.
     */
    function probesOn(axis: KnowabilityAxis): Date[] {
      const stamps = [
        ...new Set(everything.map((row) => row[axis].getTime())),
      ].sort((a, b) => a - b);

      const step = Math.max(1, Math.ceil(stamps.length / 40));
      const sampled = stamps.filter((_, index) => index % step === 0);

      return [
        new Date(stamps[0] - 3600 * 1000),
        ...sampled.flatMap((at) => [
          new Date(at - 1000),
          new Date(at),
          new Date(at + 1000),
        ]),
        new Date(stamps[stamps.length - 1] + 3600 * 1000),
      ];
    }

    async function checkAxis(axis: KnowabilityAxis): Promise<number> {
      let checked = 0;

      for (const asOf of probesOn(axis)) {
        const fromDatabase = await observationsAsOf(
          prisma,
          gauge.id,
          windowStart,
          windowEnd,
          asOf,
          axis,
        );
        const fromReference = reconstructAsOf(everything, asOf, axis);

        if (fromDatabase.length !== fromReference.length) {
          throw new Error(
            `${axis} asOf ${asOf.toISOString()}: database returned ${fromDatabase.length} rows, reference ${fromReference.length}`,
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
              `${axis} asOf ${asOf.toISOString()}: row ${index} differs. database ${JSON.stringify(left)} reference ${JSON.stringify(right)}`,
            );
          }
        }

        // Nothing the query hands back may postdate the instant asked for,
        // on whichever clock the caller said it was reading.
        for (const row of fromDatabase) {
          if (row[axis].getTime() > asOf.getTime()) {
            throw new Error(
              `${axis} asOf ${asOf.toISOString()}: leaked a row whose ${axis} is ${row[axis].toISOString()}`,
            );
          }
        }

        checked += 1;
      }

      return checked;
    }

    const strict = await checkAxis('recordedAt');
    console.log(`recordedAt : ${strict} asOf instants, all identical`);

    const loose = await checkAxis('validTime');
    console.log(`validTime  : ${loose} asOf instants, all identical`);

    console.log(
      '\nAC-3 holds, and the hindcast axis agrees with its reference too.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error('as of verification FAILED:', cause);
  process.exitCode = 1;
});
