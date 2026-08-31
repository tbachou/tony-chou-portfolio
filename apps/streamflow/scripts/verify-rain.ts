import { config as loadEnvFile } from 'dotenv';

import { rainWindow } from '../src/forecast/rain';
import type { RainCriteria } from '../src/forecast/rain';
import { rainWindowFromStore } from '../src/forecast/rain.repository';
import { createPrismaClient } from '../src/db';
import { OPEN_METEO_MODEL } from '../src/config';
import type { KnowabilityAxis, StoredForecast } from '../src/types';

/**
 * Proves the rain window query means what `rainWindow` says it means.
 *
 * The unit tests cover the reference rule, which is only a statement of
 * intent. What runs in production is the aggregate over a `DISTINCT ON`
 * subquery, and no mock can show that the two agree on the things that matter:
 * one row per hour, a half open window, the lead matched to the horizon, and
 * exactly `H` reduced hours or nothing. This seeds a fixture built to break a
 * query that gets any of them wrong, then checks the database and the
 * reference rule return the same millimetres.
 *
 * Two cases are the whole reason this exists. A window whose raw row count is
 * right and whose reduced count is short must be null in both, which catches a
 * query that counts before it reduces. And a window holding a revised hour
 * must sum that hour once in both, which catches a query that reduces for the
 * count but aggregates over the raw rows.
 *
 * The last four cases carry AC-R9, the leakage rule, onto the query. Each
 * shadows every hour of a knowable window with a row the prediction could not
 * have seen, once on each axis, and reads the fixture again on the other axis
 * where that shadow is legitimately visible and does dominate. The unit suite
 * in `src/forecast/leakage.spec.ts` holds the reference rule to the same
 * property; these are what hold Postgres to it.
 *
 * It writes, so it refuses to run anywhere but a local database. Point
 * PIPELINE_DATABASE_URL at a throwaway container, run it, destroy the
 * container.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Slot 0 of the fixture. Each scenario sits ten days after the last. */
const BASE = Date.UTC(2026, 0, 5, 0, 0, 0);
const HOUR = 3600 * 1000;
const SLOT_DAYS = 10;

/** Marks the fixture's own ingest run, so a re-run finds it rather than piling up. */
const RUN_MARKER = new Date('1970-01-01T00:00:00.000Z');

interface RowSpec {
  /** Hours after the issue instant. 0 is the issue instant itself. */
  offsetHours: number;
  precipMm: number;
  /** Defaults to the scenario's horizon, which is the honest lead. */
  leadHours?: number;
  /** Hours after the issue instant. Defaults to the row's own issue time. */
  recordedAtOffsetHours?: number;
  /**
   * Hours after the issue instant. Defaults to `validTime` minus the lead,
   * which is how the writer derives it and the only thing a real row ever
   * holds. Only the archive leakage case sets this, and it sets it to a value
   * no writer here can produce. See that scenario for why.
   */
  issuedAtOffsetHours?: number;
}

interface Scenario {
  label: string;
  /** Which ten day slot this scenario's window sits in. Two may share one. */
  slot: number;
  horizonHours: number;
  axis?: KnowabilityAxis;
  rows: RowSpec[];
  expected: number | null;
}

/** Hours 1 to `count` after the issue instant, one row each. */
function fullWindow(count: number, precipMm = 1): RowSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    offsetHours: i + 1,
    precipMm,
  }));
}

/**
 * The same 24 hours, fetched an hour before the prediction.
 *
 * The explicit `recordedAt` matters: left to default, the last hour of the
 * window is recorded at the issue instant exactly, and a shadow row placed
 * there would tie with it rather than beat it. The reduction breaks ties by
 * keeping the row it saw first, so the leakage cases below would then depend
 * on insertion order instead of on the rule.
 */
function knowableWindow(): RowSpec[] {
  return fullWindow(24).map((row) => ({ ...row, recordedAtOffsetHours: -1 }));
}

/**
 * A shadow over every hour of a knowable window, at a thousand millimetres and
 * a newer `recordedAt`, so a visible shadow replaces its hour rather than
 * merely joining it. One leaking shadow moves the total by three orders of
 * magnitude; all of them leaking is the total.
 */
function shadowWindow(over: Omit<RowSpec, 'offsetHours' | 'precipMm'>): RowSpec[] {
  return Array.from({ length: 24 }, (_, index) => ({
    offsetHours: index + 1,
    precipMm: 1000,
    ...over,
  }));
}

const SCENARIOS: Scenario[] = [
  {
    label: 'a complete 24 hour window',
    slot: 0,
    horizonHours: 24,
    rows: fullWindow(24),
    expected: 24,
  },
  {
    // Zero and null are different answers and the model reads them
    // differently. A dry forecast is information; a gap is not.
    label: 'a complete window forecast dry sums to zero, not null',
    slot: 1,
    horizonHours: 24,
    rows: fullWindow(24, 0),
    expected: 0,
  },
  {
    label: 'one hour missing yields null, never a partial sum',
    slot: 2,
    horizonHours: 24,
    rows: fullWindow(24).slice(0, 23),
    expected: null,
  },
  {
    // The revised hour is present twice. Summing both would report 29.
    label: 'a revised hour counts once, at its newer value',
    slot: 3,
    horizonHours: 24,
    rows: [...fullWindow(24), { offsetHours: 5, precipMm: 5, recordedAtOffsetHours: 0 }],
    expected: 28,
  },
  {
    // Twenty four raw rows over twenty three distinct hours. A query that
    // counts before it reduces calls this complete and returns 27.
    label: 'a revised hour cannot pad a window that is really short',
    slot: 4,
    horizonHours: 24,
    rows: [
      ...fullWindow(24).slice(0, 23),
      { offsetHours: 5, precipMm: 5, recordedAtOffsetHours: 0 },
    ],
    expected: null,
  },
  {
    // A 24 hour row valid 5 hours out was issued 19 hours before the
    // prediction and is honest; a 48 hour row valid there was issued 43 hours
    // before, which is also honest but is a different forecast. The rule is
    // that the lead matches the horizon, and admitting anything else is what
    // lets a shorter lead leak in at other offsets.
    label: 'a row at another lead never enters the window',
    slot: 5,
    horizonHours: 24,
    rows: [
      ...fullWindow(24),
      { offsetHours: 5, precipMm: 99, leadHours: 48 },
      { offsetHours: 12, precipMm: 99, leadHours: 72 },
    ],
    expected: 24,
  },
  {
    label: 'the hour at the issue instant is outside the window',
    slot: 6,
    horizonHours: 24,
    rows: [...fullWindow(24), { offsetHours: 0, precipMm: 99 }],
    expected: 24,
  },
  {
    label: 'the hour past the target instant is outside the window',
    slot: 7,
    horizonHours: 24,
    rows: [...fullWindow(24), { offsetHours: 25, precipMm: 99 }],
    expected: 24,
  },
  {
    label: 'a 48 hour window reads 48 hours at lead 48',
    slot: 8,
    horizonHours: 48,
    rows: fullWindow(48, 0.5),
    expected: 24,
  },
  {
    // Same rows, read two ways. Everything was fetched a day after the
    // prediction, so the live axis has no window at all.
    label: 'rows fetched after the issue instant are invisible on the live axis',
    slot: 9,
    horizonHours: 24,
    rows: fullWindow(24).map((row) => ({ ...row, recordedAtOffsetHours: 24 })),
    expected: null,
  },
  {
    label: 'the same rows are visible on the archive axis, where they were issued in time',
    slot: 9,
    horizonHours: 24,
    axis: 'validTime',
    rows: fullWindow(24).map((row) => ({ ...row, recordedAtOffsetHours: 24 })),
    expected: 24,
  },
  {
    // AC-R9 on the live axis, against the query rather than the rule. Every
    // hour is shadowed by a refetch that landed an hour after the prediction,
    // which is the commonest way a row that must not be seen turns up in a
    // real store. A query missing its visibility bound, or carrying it on the
    // wrong column, reports 24024 or 24000 here rather than 24.
    label: 'a row fetched after the issue instant never reaches the live window',
    slot: 10,
    horizonHours: 24,
    rows: [...knowableWindow(), ...shadowWindow({ recordedAtOffsetHours: 1 })],
    expected: 24,
  },
  {
    // The control, and the reason the case above means anything. Read on the
    // axis where those same shadows are legitimately visible, they dominate
    // every hour. So the 24 above is the bound doing work, not the window
    // bounds or the lead rule having already dropped them for another reason.
    label: 'the same shadows do dominate on the archive axis, where they were issued in time',
    slot: 10,
    horizonHours: 24,
    axis: 'validTime',
    rows: [...knowableWindow(), ...shadowWindow({ recordedAtOffsetHours: 1 })],
    expected: 24000,
  },
  {
    // AC-R9 on the archive axis. `issuedAt` is forged an hour past the
    // prediction, and no writer in this pipeline can produce such a row:
    // leadHours is canonical, issuedAt is derived from it, and a lead of 24 on
    // an hour inside a 24 hour window always lands the issue time at or before
    // T. That is exactly why it is written by hand. The bound has to be
    // enforced by reading the column, not inferred from the lead rule
    // happening to hold, or it stops being a guard the moment that rule
    // loosens.
    label: 'a row issued after the issue instant never reaches the archive window',
    slot: 11,
    horizonHours: 24,
    axis: 'validTime',
    rows: [
      ...knowableWindow(),
      ...shadowWindow({ issuedAtOffsetHours: 1, recordedAtOffsetHours: 0 }),
    ],
    expected: 24,
  },
  {
    label: 'the same shadows do dominate on the live axis, where they were fetched in time',
    slot: 11,
    horizonHours: 24,
    rows: [
      ...knowableWindow(),
      ...shadowWindow({ issuedAtOffsetHours: 1, recordedAtOffsetHours: 0 }),
    ],
    expected: 24000,
  },
];

function issueInstant(slot: number): Date {
  return new Date(BASE + slot * SLOT_DAYS * 24 * HOUR);
}

interface MaterialRow {
  validTime: Date;
  leadHours: number;
  issuedAt: Date;
  recordedAt: Date;
  precipMm: number;
}

function materialize(scenario: Scenario): MaterialRow[] {
  const issuedAt = issueInstant(scenario.slot);

  return scenario.rows.map((spec) => {
    const leadHours = spec.leadHours ?? scenario.horizonHours;
    const validTime = new Date(issuedAt.getTime() + spec.offsetHours * HOUR);
    // Derived exactly as the writer derives it, so the fixture cannot drift
    // from the invariant that leadHours is canonical, unless a scenario forges
    // it on purpose to put the archive bound under load.
    const rowIssuedAt =
      spec.issuedAtOffsetHours === undefined
        ? new Date(validTime.getTime() - leadHours * HOUR)
        : new Date(issuedAt.getTime() + spec.issuedAtOffsetHours * HOUR);

    return {
      validTime,
      leadHours,
      issuedAt: rowIssuedAt,
      recordedAt:
        spec.recordedAtOffsetHours === undefined
          ? rowIssuedAt
          : new Date(issuedAt.getTime() + spec.recordedAtOffsetHours * HOUR),
      precipMm: spec.precipMm,
    };
  });
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}

function show(value: number | null): string {
  return value === null ? 'null' : `${value} mm`;
}

function same(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 1e-9;
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
      where: { usgsSiteId: 'FIXTURE-RAIN' },
      update: {},
      create: {
        usgsSiteId: 'FIXTURE-RAIN',
        name: 'Rain Fixture Creek',
        lat: 0,
        lon: 0,
        timezone: 'America/New_York',
        active: false,
      },
    });

    // The forecast rows need a run to point at. Found rather than recreated, so
    // running this twice does not leave a trail of runs behind it.
    const run =
      (await prisma.pipelineRun.findFirst({
        where: { job: 'OPEN_METEO_INGEST', windowStart: RUN_MARKER },
      })) ??
      (await prisma.pipelineRun.create({
        data: {
          job: 'OPEN_METEO_INGEST',
          startedAt: RUN_MARKER,
          status: 'OK',
          windowStart: RUN_MARKER,
          windowEnd: RUN_MARKER,
        },
      }));

    // `createMany` with `skipDuplicates`, never `upsert`. The table is append
    // only (AC-R3), and the unique key is what makes a re-run write nothing.
    const seeded = await prisma.weatherForecast.createMany({
      data: SCENARIOS.flatMap((scenario) =>
        materialize(scenario).map((row) => ({
          ...row,
          gaugeId: gauge.id,
          model: OPEN_METEO_MODEL,
          tempC: null,
          ingestRunId: run.id,
        })),
      ),
      skipDuplicates: true,
    });
    console.log(`seeded ${seeded.count} new rows (duplicates skipped)\n`);

    // The reference pass: every weather row in the fixture, filtered and
    // reduced in TypeScript. Deliberately unfiltered here, so the rule has to
    // do its own scoping exactly as the query does.
    const stored = await prisma.weatherForecast.findMany({
      where: { gaugeId: gauge.id },
      select: {
        gaugeId: true,
        validTime: true,
        leadHours: true,
        issuedAt: true,
        recordedAt: true,
        precipMm: true,
        tempC: true,
        model: true,
      },
    });
    const rows: StoredForecast[] = stored;

    let failures = 0;
    for (const scenario of SCENARIOS) {
      const criteria: RainCriteria = {
        gaugeId: gauge.id,
        model: OPEN_METEO_MODEL,
        horizonHours: scenario.horizonHours,
        issuedAt: issueInstant(scenario.slot),
        axis: scenario.axis,
      };

      const fromStore = await rainWindowFromStore(prisma, criteria);
      const fromRule = rainWindow(rows, criteria);

      const storeMatchesRule = same(fromStore, fromRule);
      const ruleMatchesExpected = same(fromRule, scenario.expected);

      if (storeMatchesRule && ruleMatchesExpected) {
        console.log(`ok   ${scenario.label}: ${show(fromStore)}`);
      } else {
        failures += 1;
        console.error(`FAIL ${scenario.label}`);
        console.error(`  database: ${show(fromStore)}`);
        console.error(`  rule    : ${show(fromRule)}`);
        console.error(`  expected: ${show(scenario.expected)}`);
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} of ${SCENARIOS.length} cases disagree`);
    }
    console.log(`\nall ${SCENARIOS.length} cases agree: query, rule and fixture`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  console.error('verify FAILED:', cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
