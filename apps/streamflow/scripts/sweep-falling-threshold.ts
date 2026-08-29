import { config as loadEnvFile } from 'dotenv';

import { asOfWalk } from '../src/asof/as-of';
import { createPrismaClient } from '../src/db';
import { sanitizeError } from '../src/errors';
import { persistenceForecast } from '../src/forecast/baselines';
import { quantile } from '../src/forecast/interval';
import {
  FALLING_FRACTION_OF_VALUE,
  PEAK_MULTIPLE_OF_MEDIAN,
  regimeInputs,
  RISING_FRACTION_OF_MEDIAN,
} from '../src/forecast/regime';
import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * Measures what a candidate falling threshold would do to the whole record.
 *
 * This exists because the falling regime child was decided from an argument and
 * turned out to be wrong, and the child that corrected it was decided from
 * numbers produced by a script nobody kept. Both mistakes are the same mistake.
 * The numbers in
 * `docs/specs/_root/0010-streamflow-forecast-pipeline/findings/2026-08-28-falling-denominator-sweep.md`
 * come from this file, and they can be re measured by running it.
 *
 * Read only. It writes nothing and takes no flags.
 *
 *   npx tsx apps/streamflow/scripts/sweep-falling-threshold.ts
 *
 * Three questions, in order:
 *
 *   1. What share of the record does each candidate threshold call falling?
 *      A rule that labels most of the record is not a class, it is a default.
 *   2. Do the slots a candidate adds actually behave like recessions? This is
 *      the one that decides anything. Persistence forecasts the current
 *      reading, so on an unbiased population the ratio of actual to forecast
 *      sits near 1.0 with about half the forecasts high; on a recession it
 *      sits below 1.0 with most of them high, because the river keeps dropping
 *      after the forecast is made.
 *   3. Does the flow floor guard change anything, and how close does the record
 *      come to the point where a threshold measured against the value alone
 *      would degenerate?
 *
 * Only persistence is measured for bias. Climatology ignores current conditions
 * by design, so its errors are dominated by that and would swamp the signal.
 */

/** One classifiable issue slot, reduced to the three numbers the rule reads. */
interface Slot {
  predictionIds: string[];
  v: number;
  m: number;
  d: number;
}

/** A candidate falling threshold, as a function of the slot's own numbers. */
interface Candidate {
  label: string;
  threshold: (slot: { v: number; m: number }, floor: number) => number;
}

const CANDIDATES: Candidate[] = [
  // The shipped candidate is stated in terms of the production constant, so a
  // tuned classifier moves this row with it; the alternatives are literals on
  // purpose, because each IS a different number being tried.
  { label: '-0.10 * max(v, m)  (superseded)', threshold: (s) => -0.1 * Math.max(s.v, s.m) },
  {
    label: '-0.10 * max(v, floor)  (shipped)',
    threshold: (s, f) => -FALLING_FRACTION_OF_VALUE * Math.max(s.v, f),
  },
  { label: '-0.10 * v', threshold: (s) => -0.1 * s.v },
  { label: '-0.15 * v', threshold: (s) => -0.15 * s.v },
  { label: '-0.20 * v', threshold: (s) => -0.2 * s.v },
  { label: '-0.25 * v', threshold: (s) => -0.25 * s.v },
];

/**
 * The production ladder with only the falling threshold swappable. The rising
 * and peak tests read the same exported constants `classifyRegime` does.
 */
function classify(slot: Slot, threshold: number): string {
  if (slot.d >= RISING_FRACTION_OF_MEDIAN * slot.m) return 'RISING';
  if (slot.d <= threshold) return 'FALLING';
  if (slot.v >= PEAK_MULTIPLE_OF_MEDIAN * slot.m) return 'PEAK';
  return 'BASEFLOW';
}

/**
 * Every classifiable slot, with the numbers `classifyRegime` would read.
 *
 * Reconstructed the same way `backfill-regime.ts` does it: bound at the slot's
 * own `issuedAt`, on the `validTime` axis for hindcast slots and `recordedAt`
 * otherwise. A slot failing any of the three null conditions is dropped, so the
 * denominator here is the population the rule can actually judge.
 */
async function readSlots(prisma: PrismaClient, gaugeId: string): Promise<Slot[]> {
  // Independent reads, overlapped.
  const [predictions, observations] = await Promise.all([
    prisma.prediction.findMany({
      where: { gaugeId },
      select: { id: true, issuedAt: true, hindcast: true },
      orderBy: { issuedAt: 'asc' },
    }),
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
  ]);

  const byKey = new Map<string, string[]>();
  for (const row of predictions) {
    const key = `${row.issuedAt.getTime()}|${row.hindcast}`;
    const held = byKey.get(key);
    if (held) held.push(row.id);
    else byKey.set(key, [row.id]);
  }

  const slots: Slot[] = [];

  for (const axis of ['recordedAt', 'validTime'] as const) {
    const historyAt = asOfWalk(observations, axis);
    const wanted = [...byKey.entries()]
      .map(([key, ids]) => {
        const [instant, hindcast] = key.split('|');
        return { at: new Date(Number(instant)), hindcast: hindcast === 'true', ids };
      })
      .filter((entry) => entry.hindcast === (axis === 'validTime'))
      // Ascending, which is the one thing asOfWalk cannot check for itself.
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    for (const entry of wanted) {
      const history = historyAt(entry.at);

      const v = persistenceForecast(history, entry.at);
      if (v === null) continue;

      // The same derivation and the same three refusals production makes,
      // imported rather than copied, so the population measured here is the
      // population `classifyRegime` judges.
      const inputs = regimeInputs(history, entry.at, v);
      if (inputs === null) continue;

      slots.push({ predictionIds: entry.ids, v, m: inputs.m, d: inputs.d });
    }
  }

  return slots;
}

function pct(count: number, total: number): string {
  return `${String(count).padStart(5)} (${String(Math.round((100 * count) / total)).padStart(2)}%)`;
}

async function main(): Promise<void> {
  loadEnvFile();
  const prisma = createPrismaClient();

  try {
    const gauge = await prisma.gauge.findFirstOrThrow({ where: { active: true } });
    if (gauge.flowFloorCfs === null) {
      throw new Error('the gauge has no frozen flow floor yet, so nothing here can be measured');
    }
    const floor = gauge.flowFloorCfs;

    // The slot reconstruction and the score fetch are independent; overlap
    // them. The scores only meet the slots at the grouping below.
    const [slots, scores] = await Promise.all([
      readSlots(prisma, gauge.id),
      prisma.score.findMany({
        select: {
          actualCfs: true,
          predictionId: true,
          prediction: {
            select: { centralCfs: true, modelVersion: { select: { name: true } } },
          },
        },
      }),
    ]);

    // Zero slots would make every percentage below NaN. A store this thin has
    // nothing to sweep, and printing garbage tables invites copying garbage
    // into a spec.
    if (slots.length === 0) {
      throw new Error(
        'no classifiable slot in the store: every prediction failed a null condition. ' +
          'The gauge needs at least a week of readings before a sweep can measure anything.',
      );
    }

    console.log(`classifiable slots: ${slots.length}   flowFloorCfs: ${floor}\n`);

    console.log('rule                                RISING    FALLING       PEAK   BASEFLOW');
    for (const candidate of CANDIDATES) {
      const counts: Record<string, number> = { RISING: 0, FALLING: 0, PEAK: 0, BASEFLOW: 0 };
      for (const slot of slots) counts[classify(slot, candidate.threshold(slot, floor))] += 1;
      console.log(
        `${candidate.label.padEnd(34)}${pct(counts.RISING, slots.length)} ` +
          `${pct(counts.FALLING, slots.length)} ${pct(counts.PEAK, slots.length)} ` +
          `${pct(counts.BASEFLOW, slots.length)}`,
      );
    }

    // The decisive part. Group every persistence score by how the superseded
    // rule and the value based rule each label its prediction, then read the
    // bias of each group. A group the floor holds back that looks like the
    // falling group is a recession being filed as calm.
    const label = new Map<string, string>();
    for (const slot of slots) {
      const before = classify(slot, -0.1 * Math.max(slot.v, slot.m));
      const after = classify(slot, -0.1 * Math.max(slot.v, floor));
      const key = before === after ? `stays ${before}` : `${before} -> ${after}`;
      for (const id of slot.predictionIds) label.set(id, key);
    }

    const groups = new Map<string, number[]>();
    for (const score of scores) {
      if (score.prediction.modelVersion.name !== 'persistence') continue;
      if (score.prediction.centralCfs <= 0) continue;
      const key = label.get(score.predictionId);
      if (!key) continue;
      const ratios = groups.get(key) ?? [];
      ratios.push(score.actualCfs / score.prediction.centralCfs);
      groups.set(key, ratios);
    }

    console.log('\npersistence bias by group (1.00 is unbiased, below 1.00 means forecasts too high)\n');
    for (const [key, ratios] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (ratios.length < 25) continue;
      const high = ratios.filter((r) => r < 1).length;
      console.log(
        `${key.padEnd(26)} n=${String(ratios.length).padStart(5)}   ` +
          `median ratio ${quantile(ratios, 0.5).toFixed(3)}   ` +
          `too high ${String(Math.round((100 * high) / ratios.length)).padStart(3)}%`,
      );
    }

    // How much work the flow floor guard is doing, and how close the record
    // comes to the low flow end where a bare fraction of the value degenerates.
    const differing = slots.filter(
      (s) =>
        classify(s, -0.1 * s.v) !== classify(s, -0.1 * Math.max(s.v, floor)),
    ).length;
    const belowFloor = slots.filter((s) => s.v < floor);
    const lowest = slots.reduce((min, s) => Math.min(min, s.v), Infinity);

    console.log('\nthe flow floor guard');
    console.log(`  slots where max(v, floor) differs from plain v: ${differing}`);
    console.log(`  slots with v below the floor: ${belowFloor.length}`);
    console.log(`  lowest v at any slot: ${lowest === Infinity ? 'none' : lowest}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error(`sweep failed: ${sanitizeError(cause)}`);
  process.exitCode = 1;
});
