import { REGIME_CLASSES } from './regime';
import type { Regime } from './regime';

/**
 * Whether a published range meant what it said.
 *
 * Every prediction claims a nominal coverage, 0.80 today: the truth is
 * supposed to land inside the range about four times in five. Nothing so far
 * checks that it does. The skill chart answers "how far off was the central
 * guess", which is a different question, and a forecaster can be excellent on
 * that measure while publishing ranges that are badly wrong.
 *
 * The answer is one division, so the work here is entirely in refusing to
 * report it as a single number. A pooled figure near the nominal level can
 * hide one river state at 55 percent against another at 95, and pooling an
 * earned range with the deliberately absurd placeholder band flatters the
 * result twice over: the placeholder is a third of the guess to triple it, so
 * almost everything lands inside it. Splitting is not a refinement here, it
 * is the only way the number means anything.
 *
 * Deliberately pure and free of any notion of where the rows came from. The
 * caller decides which population it is asking about, which is what lets the
 * same function answer both "how are the live forecasts calibrated" and "how
 * did the backtest come out" without either being able to contaminate the
 * other.
 */

/** How the bounds on one prediction were arrived at. */
export type IntervalSource = 'conditioned' | 'pooled' | 'placeholder';

/** One graded prediction, reduced to what a coverage figure needs. */
export interface GradedInterval {
  modelName: string;
  horizonHours: number;
  /** The river at target time. Null when the classifier refused to judge. */
  regime: Regime | null;
  /** Did the truth land between the published bounds. */
  withinInterval: boolean;
  /** The coverage this row claimed, a fraction. 0.80 everywhere today. */
  intervalLevel: number;
  source: IntervalSource;
}

export interface CoverageGroup {
  label: string;
  inside: number;
  total: number;
  /**
   * The share that landed inside, or null when the group is empty. Null
   * rather than zero, because no data and total failure are opposite findings
   * and a chart that renders them alike is worse than one that renders
   * neither.
   */
  observed: number | null;
  /** What the rows in this group claimed, averaged. Uniform at 0.80 today. */
  nominal: number;
  /**
   * Observed minus nominal. Negative means the ranges were too narrow and the
   * forecaster is overconfident, which is the failure worth catching; positive
   * means they were wider than they needed to be.
   */
  gap: number | null;
}

export interface CalibrationReport {
  overall: CoverageGroup;
  byModel: CoverageGroup[];
  /** Split per model, because pooling two forecasters hides which one is off. */
  byHorizon: CoverageGroup[];
  byRegime: CoverageGroup[];
  /**
   * By how the bounds were earned. The control that makes every other split
   * readable: placeholder rows should sit near 100 percent by construction,
   * so a high overall figure resting on them says nothing about the method.
   */
  bySource: CoverageGroup[];
}

/** How a null regime is spelled in a label. */
const UNCLASSIFIED = 'unclassified';

const SOURCE_ORDER: readonly IntervalSource[] = ['conditioned', 'pooled', 'placeholder'];

function summarise(label: string, rows: readonly GradedInterval[]): CoverageGroup {
  const total = rows.length;
  const inside = rows.filter((row) => row.withinInterval).length;
  const observed = total === 0 ? null : inside / total;
  const nominal =
    total === 0 ? 0 : rows.reduce((sum, row) => sum + row.intervalLevel, 0) / total;

  return {
    label,
    inside,
    total,
    observed,
    nominal,
    gap: observed === null ? null : observed - nominal,
  };
}

/**
 * Groups rows by a key, preserving a caller supplied order.
 *
 * `order` exists so a chart's rows do not reshuffle as the data changes: the
 * horizons stay 24, 48, 72 and the river states stay in ladder order even
 * when one of them is briefly empty. A key not in `order` sorts after the
 * ones that are, alphabetically, so an unexpected value is visible rather
 * than dropped.
 */
function groupBy(
  rows: readonly GradedInterval[],
  keyOf: (row: GradedInterval) => string,
  order: readonly string[] = [],
): CoverageGroup[] {
  const buckets = new Map<string, GradedInterval[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const held = buckets.get(key);
    if (held) held.push(row);
    else buckets.set(key, [row]);
  }

  const rank = (key: string): number => {
    const at = order.findIndex((candidate) => key.endsWith(candidate));
    return at === -1 ? order.length : at;
  };

  return [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([label, group]) => summarise(label, group));
}

/**
 * Every coverage figure the dashboard needs, from one pass over the rows.
 *
 * The caller chooses the population. Handing it live rows answers how the
 * published forecasts have actually done; handing it backtest rows answers
 * how the seeding came out. Mixing the two in one call produces a number
 * describing neither, so callers should not.
 */
export function calibration(rows: readonly GradedInterval[]): CalibrationReport {
  return {
    overall: summarise('all forecasts', rows),
    byModel: groupBy(rows, (row) => row.modelName),
    byHorizon: groupBy(
      rows,
      (row) => `${row.modelName} ${row.horizonHours} h`,
      ['24 h', '48 h', '72 h'],
    ),
    byRegime: groupBy(
      rows,
      (row) => `${row.modelName} ${row.regime?.toLowerCase() ?? UNCLASSIFIED}`,
      [...REGIME_CLASSES.map((name) => name.toLowerCase()), UNCLASSIFIED],
    ),
    bySource: groupBy(rows, (row) => row.source, SOURCE_ORDER),
  };
}

/**
 * Which rung of the interval ladder produced a row's bounds.
 *
 * The same rule the dashboard already applies when it marks a published range,
 * stated once here so the calibration split and the forecast table cannot
 * disagree about what "earned" means. `intervalSeeded` is true only for the
 * regime conditioned bucket; a real but pooled sample is false with a non zero
 * bucket, and the fixed band is false with none.
 */
export function intervalSource(row: {
  intervalSeeded: boolean;
  bucketSize: number;
}): IntervalSource {
  if (row.intervalSeeded) return 'conditioned';
  return row.bucketSize > 0 ? 'pooled' : 'placeholder';
}
