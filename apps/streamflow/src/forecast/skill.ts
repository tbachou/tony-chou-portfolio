/**
 * How wrong each forecaster has been, over time.
 *
 * An error of twelve percent means nothing on its own. It acquires meaning
 * only beside the error of the dumbest defensible alternative, which is why
 * this returns one series per forecaster over the same instants rather than a
 * single headline number: the comparison is the point, and a chart that shows
 * only the periods where a model wins is a brochure.
 *
 * The measure is a rolling seven day mean of percentage error, plotted once
 * per day. The window matters. Each forecaster issues four predictions per
 * horizon per day, so a single calendar day holds four scores, and a chart
 * built on four would show ordinary variation as though it were signal. Seven
 * days puts about twenty eight behind every point while still letting a storm
 * week stand out as a raised plateau rather than being averaged into the
 * quarter around it.
 */

/** One scored prediction, reduced to what a skill series needs. */
export interface ScoredError {
  modelName: string;
  horizonHours: number;
  targetTime: Date;
  /** A fraction, not a percentage: 0.09 is nine percent. */
  pctError: number;
}

export interface SkillPoint {
  /** The instant the window ends, which is what the point is plotted at. */
  at: Date;
  meanPctError: number;
  /** How many scores the mean was taken over, so a thin point is visible. */
  sampleSize: number;
}

export interface SkillSeries {
  modelName: string;
  horizonHours: number;
  points: SkillPoint[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days behind each point. */
export const SKILL_WINDOW_DAYS = 7;

function key(modelName: string, horizonHours: number): string {
  return `${modelName} ${horizonHours}`;
}

/**
 * Rolling mean percentage error per forecaster and horizon.
 *
 * One point per day from `from` to `to`, each averaging the scores whose
 * target instant falls in the seven days ending there. Days with no scored
 * prediction produce no point rather than a zero, because a gap in the record
 * is not a forecast that was perfectly accurate.
 *
 * `errors` must already hold at most one score per prediction. A prediction
 * re-scored after a revision would otherwise weigh twice, and the predictions
 * most likely to be re-polled are the ones during storms, which is exactly
 * where the extra weight would distort the answer.
 */
export function rollingSkill(
  errors: readonly ScoredError[],
  from: Date,
  to: Date,
  windowDays: number = SKILL_WINDOW_DAYS,
): SkillSeries[] {
  const grouped = new Map<string, ScoredError[]>();
  for (const error of errors) {
    const at = key(error.modelName, error.horizonHours);
    const held = grouped.get(at);
    if (held) held.push(error);
    else grouped.set(at, [error]);
  }

  const windowMs = windowDays * DAY_MS;
  const series: SkillSeries[] = [];

  for (const [, group] of grouped) {
    const sorted = [...group].sort(
      (a, b) => a.targetTime.getTime() - b.targetTime.getTime(),
    );

    const points: SkillPoint[] = [];
    for (let end = from.getTime() + DAY_MS; end <= to.getTime(); end += DAY_MS) {
      const start = end - windowMs;

      let total = 0;
      let count = 0;
      for (const error of sorted) {
        const at = error.targetTime.getTime();
        if (at <= start) continue;
        if (at > end) break;
        total += error.pctError;
        count += 1;
      }

      if (count > 0) {
        points.push({
          at: new Date(end),
          meanPctError: total / count,
          sampleSize: count,
        });
      }
    }

    series.push({
      modelName: sorted[0].modelName,
      horizonHours: sorted[0].horizonHours,
      points,
    });
  }

  return series.sort(
    (a, b) =>
      a.horizonHours - b.horizonHours || a.modelName.localeCompare(b.modelName),
  );
}
