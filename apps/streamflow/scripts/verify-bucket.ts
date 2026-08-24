import { config as loadEnvFile } from 'dotenv';

import { bucketRatios } from '../src/forecast/bucket';
import type { BucketCandidate, BucketCriteria } from '../src/forecast/bucket';
import { bucketRatiosFromStore } from '../src/forecast/bucket.repository';
import { createPrismaClient } from '../src/db';
import type { Regime } from '../src/forecast/regime';

/**
 * Proves the interval bucket query means what `bucketRatios` says it means.
 *
 * The unit tests cover the reference rule, which is only a statement of
 * intent. What runs in production is the DISTINCT ON query, and no mock can
 * show that the two agree on the four things that matter: one error per
 * prediction, nothing learned after the issue instant, no non positive
 * central estimate, and the right scope. This seeds a fixture built to break
 * a query that gets any of them wrong, then checks the database and the
 * reference rule return the same ratios.
 *
 * It writes, so it refuses to run anywhere but a local database. Point
 * PIPELINE_DATABASE_URL at a throwaway container, run it, destroy the
 * container.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const CUTOFF = new Date('2026-06-01T00:00:00.000Z');

interface PredictionFixture {
  key: string;
  model: 'persistence' | 'climatology';
  horizonHours: number;
  issueRegime: Regime | null;
  centralCfs: number;
  /** recordedAt, actualCfs. More than one means the truth was revised. */
  scores: [string, number][];
}

const FIXTURE: PredictionFixture[] = [
  // Plain baseflow errors at 24 hours, the ordinary case.
  {
    key: 'base-1',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    scores: [['2026-05-01T00:00:00Z', 110]],
  },
  {
    key: 'base-2',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 200,
    scores: [['2026-05-02T00:00:00Z', 180]],
  },
  // Scored twice. Only the newer revision may count, and only once.
  {
    key: 'base-revised',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    scores: [
      ['2026-05-03T00:00:00Z', 130],
      ['2026-05-20T00:00:00Z', 150],
    ],
  },
  // Revised after the cutoff. The older score still counts; a query that
  // reduces before filtering loses this prediction altogether.
  {
    key: 'base-revised-late',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    scores: [
      ['2026-05-04T00:00:00Z', 90],
      ['2026-06-15T00:00:00Z', 95],
    ],
  },
  // Learned entirely after the cutoff. Invisible until then.
  {
    key: 'base-future',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    scores: [['2026-06-20T00:00:00Z', 400]],
  },
  // A central estimate of zero would divide the whole sample by nothing.
  {
    key: 'base-zero-central',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 0,
    scores: [['2026-05-05T00:00:00Z', 120]],
  },
  // Other regimes, pooled in but conditioned out.
  {
    key: 'rising-1',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: 'RISING',
    centralCfs: 100,
    scores: [['2026-05-06T00:00:00Z', 260]],
  },
  {
    key: 'unclassified-1',
    model: 'persistence',
    horizonHours: 24,
    issueRegime: null,
    centralCfs: 100,
    scores: [['2026-05-07T00:00:00Z', 140]],
  },
  // Wrong horizon and wrong model, both of which must be out of scope.
  {
    key: 'base-48h',
    model: 'persistence',
    horizonHours: 48,
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    scores: [['2026-05-08T00:00:00Z', 175]],
  },
  {
    key: 'other-model',
    model: 'climatology',
    horizonHours: 24,
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    scores: [['2026-05-09T00:00:00Z', 300]],
  },
];

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function same(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return sorted(left).every(
    (value, i) => Math.abs(value - sorted(right)[i]) < 1e-9,
  );
}

async function main() {
  loadEnvFile();

  const host = hostOf(process.env.PIPELINE_DATABASE_URL);
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `refusing to seed a fixture into a non local database (host ${host || 'unparseable'}). Point PIPELINE_DATABASE_URL at a throwaway container.`,
    );
  }

  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.upsert({
      where: { usgsSiteId: 'FIXTURE-BUCKET' },
      update: {},
      create: {
        usgsSiteId: 'FIXTURE-BUCKET',
        name: 'Bucket Fixture Creek',
        lat: 0,
        lon: 0,
        timezone: 'America/New_York',
        active: false,
      },
    });

    const models: Record<string, string> = {};
    for (const name of ['persistence', 'climatology'] as const) {
      const model = await prisma.modelVersion.upsert({
        where: { name: `fixture-${name}` },
        update: {},
        create: { name: `fixture-${name}`, kind: 'BASELINE', active: false },
      });
      models[name] = model.id;
    }

    let issuedOffset = 0;
    for (const row of FIXTURE) {
      issuedOffset += 1;
      // Distinct issue times only to satisfy the unique key. The bucket does
      // not read them; it reads the scores' actualRecordedAt.
      const issuedAt = new Date(
        Date.UTC(2026, 3, 1, 0, 0, 0) + issuedOffset * 6 * 3600 * 1000,
      );
      const targetTime = new Date(
        issuedAt.getTime() + row.horizonHours * 3600 * 1000,
      );

      const prediction = await prisma.prediction.upsert({
        where: {
          gaugeId_modelVersionId_issuedAt_targetTime: {
            gaugeId: gauge.id,
            modelVersionId: models[row.model],
            issuedAt,
            targetTime,
          },
        },
        update: {},
        create: {
          gaugeId: gauge.id,
          modelVersionId: models[row.model],
          issuedAt,
          targetTime,
          horizonHours: row.horizonHours,
          centralCfs: row.centralCfs,
          lowerCfs: row.centralCfs / 3,
          upperCfs: row.centralCfs * 3,
          intervalLevel: 0.8,
          issueRegime: row.issueRegime,
          hindcast: true,
        },
      });

      for (const [recordedAt, actualCfs] of row.scores) {
        await prisma.score.upsert({
          where: {
            predictionId_actualRecordedAt: {
              predictionId: prediction.id,
              actualRecordedAt: new Date(recordedAt),
            },
          },
          update: {},
          create: {
            predictionId: prediction.id,
            scoredAt: new Date(recordedAt),
            actualCfs,
            actualRecordedAt: new Date(recordedAt),
            absError: Math.abs(actualCfs - row.centralCfs),
            pctError: 0,
            withinInterval: true,
            regime: row.issueRegime,
          },
        });
      }
    }

    // The reference pass: every score in the fixture, reduced in TypeScript.
    const everything = await prisma.score.findMany({
      where: { prediction: { gaugeId: gauge.id } },
      select: {
        id: true,
        predictionId: true,
        actualCfs: true,
        actualRecordedAt: true,
        prediction: {
          select: {
            gaugeId: true,
            modelVersionId: true,
            horizonHours: true,
            issueRegime: true,
            centralCfs: true,
          },
        },
      },
    });

    const candidates: BucketCandidate[] = everything.map((score) => ({
      scoreId: score.id,
      predictionId: score.predictionId,
      actualCfs: score.actualCfs,
      actualRecordedAt: score.actualRecordedAt,
      gaugeId: score.prediction.gaugeId,
      modelVersionId: score.prediction.modelVersionId,
      horizonHours: score.prediction.horizonHours,
      issueRegime: score.prediction.issueRegime,
      centralCfs: score.prediction.centralCfs,
    }));

    const cases: [string, BucketCriteria, number[]][] = [
      [
        'baseflow at 24h, before the cutoff',
        {
          gaugeId: gauge.id,
          modelVersionId: models.persistence,
          horizonHours: 24,
          issuedAt: CUTOFF,
          issueRegime: 'BASEFLOW',
        },
        // base-1 1.1, base-2 0.9, base-revised 1.5, base-revised-late 0.9.
        // base-future, base-zero-central, and the newer revision of
        // base-revised-late are all out.
        [1.1, 0.9, 1.5, 0.9],
      ],
      [
        'pooled at 24h, before the cutoff',
        {
          gaugeId: gauge.id,
          modelVersionId: models.persistence,
          horizonHours: 24,
          issuedAt: CUTOFF,
        },
        // The four above, plus rising 2.6 and the unclassifiable 1.4.
        [1.1, 0.9, 1.5, 0.9, 2.6, 1.4],
      ],
      [
        'rising at 24h',
        {
          gaugeId: gauge.id,
          modelVersionId: models.persistence,
          horizonHours: 24,
          issuedAt: CUTOFF,
          issueRegime: 'RISING',
        },
        [2.6],
      ],
      [
        'pooled at 48h',
        {
          gaugeId: gauge.id,
          modelVersionId: models.persistence,
          horizonHours: 48,
          issuedAt: CUTOFF,
        },
        [1.75],
      ],
      [
        'pooled at 24h, after every revision landed',
        {
          gaugeId: gauge.id,
          modelVersionId: models.persistence,
          horizonHours: 24,
          issuedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        // base-revised-late now takes its newer 0.95, and base-future appears.
        [1.1, 0.9, 1.5, 0.95, 4, 2.6, 1.4],
      ],
    ];

    let failures = 0;
    for (const [label, criteria, expected] of cases) {
      const fromStore = await bucketRatiosFromStore(prisma, criteria);
      const fromRule = bucketRatios(candidates, criteria);

      const storeMatchesRule = same(fromStore, fromRule);
      const ruleMatchesExpected = same(fromRule, expected);

      if (storeMatchesRule && ruleMatchesExpected) {
        console.log(`ok   ${label}: ${sorted(fromStore).join(', ')}`);
      } else {
        failures += 1;
        console.error(`FAIL ${label}`);
        console.error(`  database  : ${sorted(fromStore).join(', ')}`);
        console.error(`  rule      : ${sorted(fromRule).join(', ')}`);
        console.error(`  expected  : ${sorted(expected).join(', ')}`);
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} of ${cases.length} cases disagree`);
    }
    console.log(`\nall ${cases.length} cases agree: query, rule and fixture`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error('verify FAILED:', cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
