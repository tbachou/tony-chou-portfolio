import { config as loadEnvFile } from 'dotenv';

import { createPrismaClient } from '../src/db';
import type { Qualifier } from '../src/types';

/**
 * Seeds a store with readings that were revised, so the as of query has
 * something to choose between.
 *
 * The live store cannot serve this purpose: on day one every row shares one
 * recordedAt, so DISTINCT ON has no competing revisions to pick from, and it
 * will be months before USGS supplies enough of them naturally. Manufacturing
 * them in the live store is worse, because the whole value of that table is
 * that its transaction time history is real.
 *
 * So this refuses to run anywhere but a local database. Point
 * PIPELINE_DATABASE_URL at a throwaway container, seed, verify, destroy.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** validTime, then the successive revisions learned for it, in order. */
const FIXTURE: [string, [string, number, Qualifier][]][] = [
  [
    '2026-08-01T12:00:00Z',
    [
      ['2026-08-01T12:05:00Z', 1060, 'PROVISIONAL'],
      ['2026-08-03T09:00:00Z', 1085, 'PROVISIONAL'],
      ['2026-08-20T09:00:00Z', 1120, 'APPROVED'],
    ],
  ],
  [
    '2026-08-01T12:15:00Z',
    [
      ['2026-08-01T12:20:00Z', 1050, 'PROVISIONAL'],
      ['2026-08-20T09:00:00Z', 1050, 'APPROVED'],
    ],
  ],
  ['2026-08-01T12:30:00Z', [['2026-08-01T12:35:00Z', 1040, 'PROVISIONAL']]],
  [
    '2026-08-01T12:45:00Z',
    [
      ['2026-08-01T12:50:00Z', 1030, 'PROVISIONAL'],
      ['2026-08-25T09:00:00Z', 1200, 'APPROVED'],
    ],
  ],
];

async function main() {
  loadEnvFile();

  const url = process.env.PIPELINE_DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `refusing to seed a fixture into a non local database (host ${host || 'unparseable'}). Point PIPELINE_DATABASE_URL at a throwaway container.`,
    );
  }

  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.upsert({
      where: { usgsSiteId: 'FIXTURE-0001' },
      update: {},
      create: {
        usgsSiteId: 'FIXTURE-0001',
        name: 'Fixture Creek',
        lat: 0,
        lon: 0,
        timezone: 'America/New_York',
        active: false,
      },
    });

    let written = 0;
    for (const [validTime, revisions] of FIXTURE) {
      for (const [recordedAt, valueCfs, qualifier] of revisions) {
        // One run per revision, because a run stamps every row it writes with
        // a single recordedAt. Two revisions of one reading can never have
        // come from the same run.
        const run = await prisma.pipelineRun.create({
          data: {
            job: 'USGS_INGEST',
            startedAt: new Date(recordedAt),
            finishedAt: new Date(recordedAt),
            status: 'OK',
            rowsWritten: 1,
          },
        });

        await prisma.observation.create({
          data: {
            gaugeId: gauge.id,
            validTime: new Date(validTime),
            recordedAt: new Date(recordedAt),
            valueCfs,
            qualifier,
            ingestRunId: run.id,
          },
        });
        written += 1;
      }
    }

    console.log(`seeded ${written} rows across ${FIXTURE.length} validTimes`);
    console.log('revisions per validTime:', FIXTURE.map(([, r]) => r.length).join(', '));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error('seed FAILED:', cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
