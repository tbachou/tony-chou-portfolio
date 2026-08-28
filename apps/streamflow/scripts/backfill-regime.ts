import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config as loadEnvFile } from 'dotenv';

import {
  backfillRegimes,
  formatReport,
  TRANSITIONS_DROP_MEDIAN_FLOOR,
} from '../src/forecast/backfill-regime';
import type {
  BackfillReader,
  BackfillWriter,
  RegimeSnapshot,
  SnapshotStore,
} from '../src/forecast/backfill-regime';
import { createPrismaClient } from '../src/db';
import { sanitizeError } from '../src/errors';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { Regime } from '../src/forecast/regime';

/**
 * Relabels every stored regime under the rule the classifier currently carries.
 *
 * Report only unless `--write` is passed, because the numbers it prints are
 * meant to be read and recorded in the spec before a single row moves. Once
 * forecasting is back on, every slot issues bounds drawn from the new buckets
 * and AC-I11 makes those bounds permanent, so the report only run is the last
 * cheap place to catch a mistake.
 *
 *   npx tsx apps/streamflow/scripts/backfill-regime.ts --snapshot=<path>
 *   npx tsx apps/streamflow/scripts/backfill-regime.ts --snapshot=<path> --write
 *
 * `--snapshot` is required and has no default, and the snapshot it names is
 * stamped with the rule that produced its labels. A snapshot taken under a
 * different rule is refused rather than compared against, which is what makes
 * a second relabelling of the same column safe.
 *
 * `STREAMFLOW_FORECASTING` must be false for the whole window between the rule
 * landing and this having run and been checked. Ingest and rescan keep going
 * and write no regime, but a rescan can revise an old reading, which a hindcast
 * row's reconstruction can see. A write run therefore refuses outright if any
 * ingest or rescan started after its snapshot was taken: run the report and the
 * write together, inside one gap between pipeline runs.
 *
 * The snapshot file is not a cache and must not be deleted between an
 * interrupted run and its retry. It holds the labels as they were before this
 * migration touched anything, and it is what a resumed run compares against. A
 * resumed run that took a fresh snapshot would read its own already migrated
 * labels back as the old ones, see no movement in the rows most likely to be
 * wrong, and pass every check without examining them.
 */

/**
 * Where a snapshot goes if `--snapshot` is not given.
 *
 * There is deliberately no default. The first migration left a file at a fixed
 * path, and a run that silently picks it up compares this rule's labels against
 * labels taken under a different one. The rule tag on the snapshot refuses that
 * anyway, but a default path is a loaded gun and this removes it.
 */
const SNAPSHOT_DIR = join(__dirname, '..', '.regime-backfill');

/** Ids per statement, so a 36,000 row update is not one enormous IN list. */
const WRITE_CHUNK = 1000;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

function prismaReader(prisma: PrismaClient): BackfillReader {
  return {
    predictions: async () => {
      const rows = await prisma.prediction.findMany({
        select: {
          id: true,
          gaugeId: true,
          issuedAt: true,
          hindcast: true,
          issueRegime: true,
          horizonHours: true,
          modelVersion: { select: { name: true } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        gaugeId: row.gaugeId,
        issuedAt: row.issuedAt,
        hindcast: row.hindcast,
        issueRegime: row.issueRegime,
        horizonHours: row.horizonHours,
        modelName: row.modelVersion.name,
      }));
    },

    scores: async () => {
      const rows = await prisma.score.findMany({
        select: {
          id: true,
          scoredAt: true,
          actualCfs: true,
          regime: true,
          prediction: {
            select: {
              gaugeId: true,
              targetTime: true,
              hindcast: true,
              horizonHours: true,
              modelVersion: { select: { name: true } },
            },
          },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        scoredAt: row.scoredAt,
        actualCfs: row.actualCfs,
        regime: row.regime,
        gaugeId: row.prediction.gaugeId,
        targetTime: row.prediction.targetTime,
        hindcast: row.prediction.hindcast,
        horizonHours: row.prediction.horizonHours,
        modelName: row.prediction.modelVersion.name,
      }));
    },

    // Every SCORE run, ascending, because a live score's history was bound at
    // its run's startedAt rather than at the scoredAt it carries.
    scoreRunStarts: async () => {
      const rows = await prisma.pipelineRun.findMany({
        where: { job: 'SCORE' },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      });
      return rows.map((row) => row.startedAt);
    },

    flowFloor: async (gaugeId) => {
      const gauge = await prisma.gauge.findUniqueOrThrow({
        where: { id: gaugeId },
        select: { flowFloorCfs: true },
      });
      if (gauge.flowFloorCfs === null) {
        throw new Error(
          `gauge ${gaugeId} has no frozen flow floor yet, so the falling threshold has no bound. ` +
            'Run the scoring job once against this gauge first; it derives and freezes the floor.',
        );
      }
      return gauge.flowFloorCfs;
    },

    ingestRunsSince: async (instant) =>
      prisma.pipelineRun.count({
        where: {
          job: { in: ['USGS_INGEST', 'USGS_RESCAN'] },
          startedAt: { gt: instant },
        },
      }),

    // The whole record once. One gauge at a quarter hour resolution since 2024
    // is a small table, and a query per row is not.
    observations: async (gaugeId) =>
      prisma.observation.findMany({
        where: { gaugeId },
        select: {
          gaugeId: true,
          validTime: true,
          recordedAt: true,
          valueCfs: true,
          qualifier: true,
        },
      }),
  };
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Writes the label and nothing else.
 *
 * `lowerCfs`, `upperCfs`, `q10Used`, `q90Used`, `intervalSeeded` and
 * `bucketSize` are left exactly as written (AC-F10), so an old row keeps a
 * truthful record of the interval it was actually issued with even after its
 * label has moved. There is deliberately no path here that could touch them.
 */
function prismaWriter(prisma: PrismaClient): BackfillWriter {
  return {
    setPredictionRegime: async (ids, regime: Regime) => {
      for (const batch of chunked(ids, WRITE_CHUNK)) {
        await prisma.prediction.updateMany({
          where: { id: { in: batch } },
          data: { issueRegime: regime },
        });
      }
    },
    setScoreRegime: async (ids, regime: Regime) => {
      for (const batch of chunked(ids, WRITE_CHUNK)) {
        await prisma.score.updateMany({
          where: { id: { in: batch } },
          data: { regime },
        });
      }
    },
  };
}

function fileSnapshots(path: string): SnapshotStore {
  return {
    load: async () => {
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        return null;
      }
      return JSON.parse(raw) as RegimeSnapshot;
    },
    save: async (snapshot) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(snapshot)}\n`, 'utf8');
    },
  };
}

async function main(): Promise<void> {
  loadEnvFile();

  const write = flag('write');
  const path = option('snapshot');
  if (!path) {
    throw new Error(
      'pass --snapshot=<path> naming where this run\'s pre migration labels go. ' +
        `There is no default on purpose. Suggested: ${join(SNAPSHOT_DIR, '<rule>.json')}`,
    );
  }
  const prisma = createPrismaClient();

  try {
    const report = await backfillRegimes({
      reader: prismaReader(prisma),
      writer: prismaWriter(prisma),
      snapshots: fileSnapshots(path),
      allowedTransitions: TRANSITIONS_DROP_MEDIAN_FLOOR,
      write,
    });

    console.log(formatReport(report));
    console.log(`\nsnapshot file: ${path}`);

    if (report.blockers.length > 0) {
      // Loud and non zero, because a forbidden cell means the reconstruction
      // is reading history the original job did not read, which is a defect
      // rather than a surprise.
      throw new Error(
        write
          ? 'refused to write: the checks did not hold'
          : 'the checks did not hold',
      );
    }

    if (!write) {
      console.log(
        '\nNothing was written. Record these numbers in the spec, then rerun with --write.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error(`backfill-regime failed: ${sanitizeError(cause)}`);
  process.exitCode = 1;
});
