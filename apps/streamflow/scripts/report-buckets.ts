import { config as loadEnvFile } from 'dotenv';

import { MIN_BUCKET_ERRORS, HORIZON_HOURS } from '../src/config';
import { createPrismaClient } from '../src/db';
import { sanitizeError } from '../src/errors';

/**
 * Counts the error bucket behind every (model, horizon, regime) combination,
 * which is what AC-F5 asks to be measured rather than assumed.
 *
 * Adding a fourth regime splits the error history four ways instead of three,
 * so every bucket is thinner than it was. The margin above the thirty error
 * minimum is the thing worth seeing: a bucket that clears it by two is one
 * quiet season away from falling back to the pooled band.
 *
 * The count is the same one the interval builder does, `DISTINCT ON` per
 * prediction so a revised score cannot count twice, and it deliberately drops
 * the time bound. The bound exists so a prediction learns only from outcomes
 * that had already happened when it was issued; this report is asking what
 * the bucket holds now, which is the whole record.
 *
 * Read only. Meant for the live store, after a re seed.
 */
async function main() {
  loadEnvFile();
  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.findFirstOrThrow();

    const rows = await prisma.$queryRaw<
      {
        model: string;
        horizon_hours: number;
        regime: string | null;
        errors: bigint;
      }[]
    >`
      SELECT
        m."name"                AS model,
        latest."horizonHours"   AS horizon_hours,
        latest."issueRegime"    AS regime,
        COUNT(*)                AS errors
      FROM (
        SELECT DISTINCT ON (s."predictionId")
          s."predictionId",
          p."modelVersionId",
          p."horizonHours",
          p."issueRegime"
        FROM "scores" s
        JOIN "predictions" p ON p."id" = s."predictionId"
        WHERE p."gaugeId" = ${gauge.id}
          AND p."centralCfs" > 0
        ORDER BY s."predictionId", s."actualRecordedAt" DESC, s."id" DESC
      ) latest
      JOIN "model_versions" m ON m."id" = latest."modelVersionId"
      GROUP BY m."name", latest."horizonHours", latest."issueRegime"
      ORDER BY m."name", latest."horizonHours", latest."issueRegime"
    `;

    if (rows.length === 0) {
      console.log('no scored predictions yet, so there are no buckets to report');
      return;
    }

    const counts = new Map<string, number>();
    const models = new Set<string>();
    for (const row of rows) {
      models.add(row.model);
      counts.set(
        `${row.model}|${row.horizon_hours}|${row.regime ?? 'unclassified'}`,
        Number(row.errors),
      );
    }

    // Every regime the taxonomy names, listed whether or not the store holds
    // one. A bucket that is missing entirely is the interesting case, and a
    // report built only from the rows that exist would not show it.
    const regimes = ['BASEFLOW', 'RISING', 'PEAK', 'FALLING'];

    console.log(`gauge   : ${gauge.name}`);
    console.log(`minimum : ${MIN_BUCKET_ERRORS} errors per bucket`);
    console.log('');
    console.log(
      'model         horizon  ' +
        regimes.map((r) => r.padStart(9)).join('  ') +
        '   unclassified      pooled',
    );

    let below = 0;
    for (const model of [...models].sort()) {
      for (const horizon of HORIZON_HOURS) {
        const cells = regimes.map((regime) => {
          const n = counts.get(`${model}|${horizon}|${regime}`) ?? 0;
          if (n < MIN_BUCKET_ERRORS) below += 1;
          return `${n < MIN_BUCKET_ERRORS ? '!' : ' '}${String(n).padStart(8)}`;
        });

        const unclassified =
          counts.get(`${model}|${horizon}|unclassified`) ?? 0;
        const pooled =
          regimes.reduce(
            (sum, regime) =>
              sum + (counts.get(`${model}|${horizon}|${regime}`) ?? 0),
            0,
          ) + unclassified;

        console.log(
          `${model.padEnd(13)} ${String(horizon).padStart(4)}h    ` +
            cells.join('  ') +
            `   ${String(unclassified).padStart(12)}${String(pooled).padStart(12)}`,
        );
      }
    }

    console.log('');
    if (below === 0) {
      console.log(
        `PASS: every regime and horizon bucket clears ${MIN_BUCKET_ERRORS} for every model.`,
      );
      return;
    }

    console.log(
      `${below} bucket(s) marked ! sit below ${MIN_BUCKET_ERRORS}. Predictions issued into those`,
    );
    console.log(
      'regimes fall back to the pooled band and are recorded as unseeded, which is',
    );
    console.log(
      'correct behaviour, but AC-F5 asks for every combination to clear the minimum.',
    );
    process.exitCode = 1;
  } catch (cause: unknown) {
    console.error(`bucket report failed: ${sanitizeError(cause)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

/* istanbul ignore next -- CLI entry, run by hand rather than by a workflow */
if (require.main === module) {
  void main();
}
