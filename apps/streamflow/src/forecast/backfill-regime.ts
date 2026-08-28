import { asOfWalk } from '../asof/as-of';
import type { KnowabilityAxis, StoredObservation } from '../types';
import { persistenceForecast } from './baselines';
import { classifyRegime, REGIME_CLASSES } from './regime';
import type { Regime } from './regime';

/**
 * Relabels every stored regime under the four class rule.
 *
 * Spec 0010's falling regime child adds FALLING and relabels history rather
 * than starting the new classes from today, because a prediction's ratio of
 * actual to central is a fact about the forecast and does not depend on the
 * label beside it. Relabelling makes every existing score available to the
 * right bucket at once, so FALLING is conditioned from its first live
 * prediction instead of months later.
 *
 * The whole difficulty is that this must reproduce each row's own read rather
 * than reading the store as it stands now. Three things follow from that, and
 * each of them is a way to get a wrong label that still looks plausible:
 *
 *   - A prediction's history is bound at its own `issuedAt`, and one judgement
 *     is shared by every row that slot wrote, which is what the live job does.
 *   - A live score's history is bound at the `startedAt` of the SCORE run that
 *     wrote it, not at its `scoredAt`. The live job reads its clock twice, once
 *     to bind history and once, several awaits later, to stamp the score.
 *   - A hindcast row reads on the `validTime` axis. On the default axis the
 *     archive returns an empty history, because it was imported in one pass, so
 *     the axis is the difference between a correct label and a null.
 *
 * AC-F7 and AC-F8 are the detectors for all three. Only a fall out of PEAK or
 * BASEFLOW is a legal movement, nothing may enter or leave the null set, and
 * anything else means the reconstruction is reading history the original job
 * did not read. Both are checked rather than printed, and both are checked
 * against a snapshot of the pre migration labels rather than against the live
 * rows, so an interrupted and resumed run cannot read its own already migrated
 * labels back as the old ones and report no movement.
 *
 * Report only by default. Nothing here recomputes an interval: the writer can
 * only set a regime, so AC-F10 holds by construction rather than by care.
 */

/** How a null regime is spelled in a count or a transition cell. */
export const NO_CLASS = 'null';

/** The four classes plus the refusal, in report order. */
export const REPORT_CLASSES: readonly string[] = [...REGIME_CLASSES, NO_CLASS];

function labelOf(regime: Regime | null): string {
  return regime ?? NO_CLASS;
}

/**
 * The only movements a correct backfill can produce (AC-F7).
 *
 * RISING never moves, because its denominator did not change. PEAK and
 * BASEFLOW may lose rows to FALLING and may not go anywhere else. Null stays
 * null, because none of the three conditions that return null changed and an
 * as of reconstruction at a past instant is stable over an append only store.
 *
 * FALLING is deliberately absent as a source. Before this migration no row can
 * carry it, and the snapshot always holds pre migration labels, so a FALLING
 * row on the left hand side means the snapshot is not what it claims to be.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  RISING: ['RISING'],
  PEAK: ['PEAK', 'FALLING'],
  BASEFLOW: ['BASEFLOW', 'FALLING'],
  [NO_CLASS]: [NO_CLASS],
};

/** One prediction, with the fields the relabelling and the report need. */
export interface PredictionRow {
  id: string;
  gaugeId: string;
  issuedAt: Date;
  /** Decides the knowability axis: a hindcast row reads on `validTime`. */
  hindcast: boolean;
  /** The label as the store holds it now, which a resumed run may have written. */
  issueRegime: Regime | null;
  modelName: string;
  horizonHours: number;
}

/** One score, carrying the prediction fields the classification needs. */
export interface ScoreRow {
  id: string;
  scoredAt: Date;
  actualCfs: number;
  regime: Regime | null;
  gaugeId: string;
  targetTime: Date;
  hindcast: boolean;
  modelName: string;
  horizonHours: number;
}

/**
 * Everything the backfill reads, named structurally so a test can hand it
 * plain arrays and the script can hand it Prisma.
 */
export interface BackfillReader {
  predictions(): Promise<PredictionRow[]>;
  scores(): Promise<ScoreRow[]>;
  /** Every SCORE run's `startedAt`, ascending. */
  scoreRunStarts(): Promise<Date[]>;
  /** One gauge's whole observation record, every revision. */
  observations(gaugeId: string): Promise<StoredObservation[]>;
}

/**
 * The only writes this is allowed to make.
 *
 * Deliberately narrow: there is no way to reach `lowerCfs`, `upperCfs`,
 * `q10Used`, `q90Used`, `intervalSeeded` or `bucketSize` through this
 * interface, which is what makes AC-F10 structural. An old row keeps a
 * truthful record of the interval it was actually issued with, even though its
 * label has moved.
 */
export interface BackfillWriter {
  setPredictionRegime(ids: readonly string[], regime: Regime): Promise<void>;
  setScoreRegime(ids: readonly string[], regime: Regime): Promise<void>;
}

/** The pre migration labels, as read once before anything was written. */
export interface RegimeSnapshot {
  takenAt: string;
  predictions: Record<string, Regime | null>;
  scores: Record<string, Regime | null>;
}

/**
 * Where that snapshot lives between runs.
 *
 * It has to outlive the process. A run interrupted after some rows leaves the
 * store holding a mix of old and new labels, and a rerun that took a fresh
 * snapshot would read the migrated subset's new labels as its old ones, see no
 * movement there, and pass both checks without ever examining the rows most
 * likely to be wrong. That is the exact hole AC-F9 names, and only a snapshot
 * that survives the interruption closes it.
 */
export interface SnapshotStore {
  load(): Promise<RegimeSnapshot | null>;
  save(snapshot: RegimeSnapshot): Promise<void>;
}

export interface BackfillOptions {
  reader: BackfillReader;
  writer: BackfillWriter;
  snapshots: SnapshotStore;
  /** Report only unless this is true. Nothing is written in report only mode. */
  write?: boolean;
  now?: () => Date;
}

export interface TransitionCell {
  from: string;
  to: string;
  count: number;
}

export interface GroupReport {
  /** Model name and horizon, or `all` for the total. */
  group: string;
  rows: number;
  /** How many rows land in each class after the relabelling. */
  counts: Record<string, number>;
  /** Every non empty cell of old class to new class. */
  transitions: TransitionCell[];
}

export interface ColumnReport {
  column: 'Prediction.issueRegime' | 'Score.regime';
  rows: number;
  groups: GroupReport[];
  total: GroupReport;
}

export interface BackfillReport {
  wrote: boolean;
  snapshotTakenAt: string;
  /** True when this run read the snapshot from an earlier, interrupted one. */
  snapshotReused: boolean;
  predictions: ColumnReport;
  scores: ColumnReport;
  /** Live scores with no SCORE run at or before them, bound at `scoredAt`. */
  fallbackScores: number;
  /**
   * Issue slots holding both a live and a hindcast prediction. Each axis gets
   * its own judgement there, which is the only reading consistent with the
   * axis being fixed per row. Zero on a store where no live run ever collided
   * with the seeding walk.
   */
  mixedAxisSlots: number;
  /** Rows the store holds that the snapshot does not, and the reverse. */
  unsnapshotted: { predictions: string[]; scores: string[] };
  missingFromStore: { predictions: string[]; scores: string[] };
  /** Cells AC-F7 forbids. Any at all means the reconstruction is wrong. */
  forbidden: TransitionCell[];
  /** Ids that entered or left the null set, which AC-F8 forbids. */
  nullSetMoved: { predictions: string[]; scores: string[] };
  /** True when the store already carried FALLING and no snapshot explained it. */
  alreadyMigrated: boolean;
  written: { predictions: number; scores: number };
  /** Why a write was refused, empty when nothing blocked it. */
  blockers: string[];
}

function emptyCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of REPORT_CLASSES) counts[name] = 0;
  return counts;
}

/**
 * The greatest instant at or before `at`, from an ascending array.
 *
 * This is how a live score finds the SCORE run whose history it was built
 * from. Scoring runs hourly and every run writes a row, so a live score
 * normally sits inside a run; a score before the first run has nothing to
 * find, which is the fallback AC-F5 insists on counting rather than hiding.
 */
export function greatestAtOrBefore(
  ascending: readonly Date[],
  at: Date,
): Date | null {
  let low = 0;
  let high = ascending.length - 1;
  let found: Date | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ascending[mid].getTime() <= at.getTime()) {
      found = ascending[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/** A hindcast row reads on the loose axis, everything else on the strict one. */
function axisFor(hindcast: boolean): KnowabilityAxis {
  return hindcast ? 'validTime' : 'recordedAt';
}

/** One reconstruction to do, and what to do with the history it yields. */
interface Job {
  asOf: Date;
  run: (history: readonly StoredObservation[]) => void;
}

function buildGroupReport(
  group: string,
  entries: readonly { old: string; next: string }[],
): GroupReport {
  const counts = emptyCounts();
  const cells = new Map<string, number>();

  for (const entry of entries) {
    counts[entry.next] = (counts[entry.next] ?? 0) + 1;
    const key = `${entry.old}|${entry.next}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }

  const transitions = [...cells.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('|');
      return { from, to, count };
    })
    .sort(
      (a, b) =>
        REPORT_CLASSES.indexOf(a.from) - REPORT_CLASSES.indexOf(b.from) ||
        REPORT_CLASSES.indexOf(a.to) - REPORT_CLASSES.indexOf(b.to),
    );

  return { group, rows: entries.length, counts, transitions };
}

/** One row's before and after, plus which model and horizon it belongs to. */
interface Movement {
  id: string;
  group: string;
  old: string;
  next: string;
  /** The label the store holds now, which decides whether a write is needed. */
  stored: Regime | null;
  computed: Regime | null;
}

function buildColumnReport(
  column: ColumnReport['column'],
  movements: readonly Movement[],
): ColumnReport {
  const byGroup = new Map<string, Movement[]>();
  for (const movement of movements) {
    const bucket = byGroup.get(movement.group);
    if (bucket) bucket.push(movement);
    else byGroup.set(movement.group, [movement]);
  }

  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, entries]) => buildGroupReport(group, entries));

  return {
    column,
    rows: movements.length,
    groups,
    total: buildGroupReport('all', movements),
  };
}

function forbiddenCells(movements: readonly Movement[]): TransitionCell[] {
  const cells = new Map<string, number>();

  for (const movement of movements) {
    const allowed = ALLOWED_TRANSITIONS[movement.old];
    if (allowed && allowed.includes(movement.next)) continue;
    const key = `${movement.old}|${movement.next}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }

  return [...cells.entries()].map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  });
}

const SAMPLE_IDS = 5;

/**
 * Runs the relabelling, and writes only when told to.
 *
 * Returns everything the operator has to look at before letting it write:
 * the four bucket counts and the full transition matrix per model and horizon
 * (AC-F6), and the verdicts on AC-F7, AC-F8 and the fallback count.
 */
export async function backfillRegimes(
  options: BackfillOptions,
): Promise<BackfillReport> {
  const { reader, writer, snapshots } = options;
  const write = options.write ?? false;
  const clock = options.now ?? (() => new Date());

  const predictions = await reader.predictions();
  const scores = await reader.scores();
  const runStarts = await reader.scoreRunStarts();

  // The snapshot first, and saved before any row is written, because it is
  // the only record of what the labels were before this migration touched
  // them. A run that wrote rows and then crashed leaves this file behind as
  // the thing its successor must compare against.
  const loaded = await snapshots.load();
  const snapshotReused = loaded !== null;
  const snapshot: RegimeSnapshot = loaded ?? {
    takenAt: clock().toISOString(),
    predictions: Object.fromEntries(
      predictions.map((row) => [row.id, row.issueRegime]),
    ),
    scores: Object.fromEntries(scores.map((row) => [row.id, row.regime])),
  };

  const alreadyMigrated =
    !snapshotReused &&
    (predictions.some((row) => row.issueRegime === 'FALLING') ||
      scores.some((row) => row.regime === 'FALLING'));

  if (write && !snapshotReused) {
    await snapshots.save(snapshot);
  }

  // Every reconstruction this run needs, grouped so the observation record is
  // read once per gauge and walked once per axis rather than per row.
  const jobsByGauge = new Map<string, Map<KnowabilityAxis, Job[]>>();

  function addJob(gaugeId: string, axis: KnowabilityAxis, job: Job): void {
    let byAxis = jobsByGauge.get(gaugeId);
    if (!byAxis) {
      byAxis = new Map();
      jobsByGauge.set(gaugeId, byAxis);
    }
    const bucket = byAxis.get(axis);
    if (bucket) bucket.push(job);
    else byAxis.set(axis, [job]);
  }

  const computedPredictions = new Map<string, Regime | null>();
  const computedScores = new Map<string, Regime | null>();

  // One judgement per issue slot, shared by every prediction the slot wrote,
  // which is exactly what `draftPredictions` does. Grouped by axis as well as
  // by instant: the axis is fixed per row by its `hindcast` flag, so a slot
  // holding both kinds genuinely has two histories and forcing one label on it
  // would be inventing an answer rather than reproducing one.
  const slots = new Map<string, PredictionRow[]>();
  for (const row of predictions) {
    const key = `${row.gaugeId}|${row.issuedAt.getTime()}|${row.hindcast}`;
    const bucket = slots.get(key);
    if (bucket) bucket.push(row);
    else slots.set(key, [row]);
  }

  // A slot that holds both a live and a hindcast prediction is worth counting
  // rather than smoothing over: the two read different histories, so the one
  // judgement per slot that AC-F5 asks for holds within an axis, not across
  // both. It is zero unless a live run once reached a slot the seeding walk
  // also covered.
  const axesPerInstant = new Map<string, Set<boolean>>();
  for (const row of predictions) {
    const instant = `${row.gaugeId}|${row.issuedAt.getTime()}`;
    const flags = axesPerInstant.get(instant) ?? new Set<boolean>();
    flags.add(row.hindcast);
    axesPerInstant.set(instant, flags);
  }
  const mixedAxisSlots = [...axesPerInstant.values()].filter(
    (flags) => flags.size > 1,
  ).length;

  for (const rows of slots.values()) {
    const first = rows[0];
    const issuedAt = first.issuedAt;
    addJob(first.gaugeId, axisFor(first.hindcast), {
      asOf: issuedAt,
      run: (history) => {
        // `v` is the persistence value at issue, drawn from this same history:
        // the call `draftPredictions` makes, so the label cannot drift from the
        // one the live job produced.
        const valueAtIssue = persistenceForecast(history, issuedAt);
        const regime =
          valueAtIssue === null
            ? null
            : classifyRegime(history, issuedAt, valueAtIssue);
        for (const row of rows) computedPredictions.set(row.id, regime);
      },
    });
  }

  let fallbackScores = 0;

  for (const score of scores) {
    // A hindcast score's `scoredAt` already is the simulated slot its history
    // was built at. A live score's is a second clock reading taken several
    // awaits after the run bound its history, so the run's own `startedAt` is
    // the instant to reproduce.
    let asOf = score.scoredAt;
    if (!score.hindcast) {
      const runStart = greatestAtOrBefore(runStarts, score.scoredAt);
      if (runStart) {
        asOf = runStart;
      } else {
        fallbackScores += 1;
      }
    }

    addJob(score.gaugeId, axisFor(score.hindcast), {
      asOf,
      run: (history) => {
        computedScores.set(
          score.id,
          classifyRegime(history, score.targetTime, score.actualCfs),
        );
      },
    });
  }

  // The walk. `asOfWalk` carries one reconstruction forward over rows that do
  // not change while this runs, which is what keeps 36,000 rows to one pass
  // over the observation record instead of 36,000 round trips.
  for (const [gaugeId, byAxis] of jobsByGauge) {
    const everything = await reader.observations(gaugeId);

    for (const [axis, jobs] of byAxis) {
      const historyAt = asOfWalk(everything, axis);
      // Ascending, which is the one thing `asOfWalk` needs and cannot check:
      // its cursor only moves forward.
      jobs.sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
      for (const job of jobs) job.run(historyAt(job.asOf));
    }
  }

  const predictionMovements: Movement[] = [];
  const scoreMovements: Movement[] = [];
  const unsnapshotted = { predictions: [] as string[], scores: [] as string[] };
  const nullSetMoved = { predictions: [] as string[], scores: [] as string[] };

  for (const row of predictions) {
    const computed = computedPredictions.get(row.id) ?? null;
    if (!(row.id in snapshot.predictions)) {
      unsnapshotted.predictions.push(row.id);
      continue;
    }
    const old = snapshot.predictions[row.id];
    if ((old === null) !== (computed === null)) {
      nullSetMoved.predictions.push(row.id);
    }
    predictionMovements.push({
      id: row.id,
      group: `${row.modelName} h${row.horizonHours}`,
      old: labelOf(old),
      next: labelOf(computed),
      stored: row.issueRegime,
      computed,
    });
  }

  for (const row of scores) {
    const computed = computedScores.get(row.id) ?? null;
    if (!(row.id in snapshot.scores)) {
      unsnapshotted.scores.push(row.id);
      continue;
    }
    const old = snapshot.scores[row.id];
    if ((old === null) !== (computed === null)) {
      nullSetMoved.scores.push(row.id);
    }
    scoreMovements.push({
      id: row.id,
      group: `${row.modelName} h${row.horizonHours}`,
      old: labelOf(old),
      next: labelOf(computed),
      stored: row.regime,
      computed,
    });
  }

  const storedPredictionIds = new Set(predictions.map((row) => row.id));
  const storedScoreIds = new Set(scores.map((row) => row.id));
  const missingFromStore = {
    predictions: Object.keys(snapshot.predictions).filter(
      (id) => !storedPredictionIds.has(id),
    ),
    scores: Object.keys(snapshot.scores).filter((id) => !storedScoreIds.has(id)),
  };

  const forbidden = [
    ...forbiddenCells(predictionMovements),
    ...forbiddenCells(scoreMovements),
  ];

  const blockers: string[] = [];
  if (forbidden.length > 0) {
    blockers.push(
      `${forbidden.length} transition cell(s) AC-F7 forbids: ${forbidden
        .map((cell) => `${cell.from} -> ${cell.to} (${cell.count})`)
        .join(', ')}`,
    );
  }
  if (nullSetMoved.predictions.length + nullSetMoved.scores.length > 0) {
    blockers.push(
      `${nullSetMoved.predictions.length + nullSetMoved.scores.length} row(s) entered or left the null set, which AC-F8 forbids`,
    );
  }
  if (unsnapshotted.predictions.length + unsnapshotted.scores.length > 0) {
    blockers.push(
      `${unsnapshotted.predictions.length + unsnapshotted.scores.length} row(s) the snapshot does not cover, so something wrote regimes after it was taken (AC-F11 says nothing should have)`,
    );
  }
  if (missingFromStore.predictions.length + missingFromStore.scores.length > 0) {
    blockers.push(
      `${missingFromStore.predictions.length + missingFromStore.scores.length} snapshot row(s) are no longer in the store, which an append only record cannot do`,
    );
  }
  if (alreadyMigrated) {
    blockers.push(
      'the store already holds FALLING labels and no snapshot explains them, so the pre migration labels this run would check against are gone',
    );
  }

  const written = { predictions: 0, scores: 0 };
  const wrote = write && blockers.length === 0;

  if (wrote) {
    // Only the rows whose label actually moves, and grouped by the value being
    // written so a whole class is one statement. Compared against the label the
    // store holds now, not against the snapshot: a resumed run must not rewrite
    // what it already wrote, while its checks still run against the snapshot.
    for (const regime of REGIME_CLASSES) {
      const ids = predictionMovements
        .filter((row) => row.computed === regime && row.stored !== regime)
        .map((row) => row.id);
      if (ids.length > 0) {
        await writer.setPredictionRegime(ids, regime);
        written.predictions += ids.length;
      }
    }

    for (const regime of REGIME_CLASSES) {
      const ids = scoreMovements
        .filter((row) => row.computed === regime && row.stored !== regime)
        .map((row) => row.id);
      if (ids.length > 0) {
        await writer.setScoreRegime(ids, regime);
        written.scores += ids.length;
      }
    }
  }

  return {
    wrote,
    snapshotTakenAt: snapshot.takenAt,
    snapshotReused,
    predictions: buildColumnReport(
      'Prediction.issueRegime',
      predictionMovements,
    ),
    scores: buildColumnReport('Score.regime', scoreMovements),
    fallbackScores,
    mixedAxisSlots,
    unsnapshotted: {
      predictions: unsnapshotted.predictions.slice(0, SAMPLE_IDS),
      scores: unsnapshotted.scores.slice(0, SAMPLE_IDS),
    },
    missingFromStore: {
      predictions: missingFromStore.predictions.slice(0, SAMPLE_IDS),
      scores: missingFromStore.scores.slice(0, SAMPLE_IDS),
    },
    forbidden,
    nullSetMoved: {
      predictions: nullSetMoved.predictions.slice(0, SAMPLE_IDS),
      scores: nullSetMoved.scores.slice(0, SAMPLE_IDS),
    },
    alreadyMigrated,
    written,
    blockers,
  };
}

function formatGroup(group: GroupReport): string[] {
  const counts = REPORT_CLASSES.map(
    (name) => `${name} ${group.counts[name] ?? 0}`,
  ).join('  ');

  const lines = [`  ${group.group} (${group.rows} rows)`, `    ${counts}`];
  for (const cell of group.transitions) {
    const moved = cell.from === cell.to ? ' ' : '*';
    lines.push(`    ${moved} ${cell.from} -> ${cell.to}: ${cell.count}`);
  }
  return lines;
}

function formatColumn(column: ColumnReport): string[] {
  const lines = [`${column.column} (${column.rows} rows)`];
  for (const group of column.groups) lines.push(...formatGroup(group));
  lines.push('');
  lines.push(...formatGroup(column.total));
  return lines;
}

/**
 * The report AC-F6 asks for, as text.
 *
 * Its numbers are meant to be copied into the spec before any row is written,
 * which is what makes phase 3 the last cheap place to catch a mistake: after
 * forecasting is back on, every slot issues bounds drawn from the new buckets
 * and AC-I11 makes those bounds permanent.
 */
export function formatReport(report: BackfillReport): string {
  const lines: string[] = [];

  lines.push(
    report.wrote ? 'MODE: write' : 'MODE: report only, nothing was written',
  );
  lines.push(
    report.snapshotReused
      ? `snapshot: reusing the one taken ${report.snapshotTakenAt}, from an earlier run`
      : `snapshot: taken now, ${report.snapshotTakenAt}`,
  );
  lines.push('');
  lines.push(...formatColumn(report.predictions));
  lines.push('');
  lines.push(...formatColumn(report.scores));
  lines.push('');
  lines.push(
    `live scores bound at scoredAt because no SCORE run preceded them: ${report.fallbackScores}`,
  );
  lines.push(
    `issue slots holding both a live and a hindcast prediction: ${report.mixedAxisSlots}`,
  );

  const nullMoved =
    report.nullSetMoved.predictions.length + report.nullSetMoved.scores.length;
  lines.push(`rows that entered or left the null set: ${nullMoved}`);

  if (report.blockers.length === 0) {
    lines.push('');
    lines.push('checks: AC-F7 and AC-F8 hold.');
  } else {
    lines.push('');
    lines.push('checks FAILED:');
    for (const blocker of report.blockers) lines.push(`  - ${blocker}`);
  }

  if (report.wrote) {
    lines.push('');
    lines.push(
      `written: ${report.written.predictions} predictions, ${report.written.scores} scores`,
    );
  }

  return lines.join('\n');
}
