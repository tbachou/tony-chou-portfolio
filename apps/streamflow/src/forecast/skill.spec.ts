import { rollingSkill, SKILL_WINDOW_DAYS } from './skill';
import type { ScoredError } from './skill';

const FROM = new Date('2026-06-01T00:00:00.000Z');
const TO = new Date('2026-06-11T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** One score per day at noon, so a day's window boundary is unambiguous. */
function daily(
  modelName: string,
  horizonHours: number,
  pctErrors: number[],
  startDay = 1,
): ScoredError[] {
  return pctErrors.map((pctError, index) => ({
    modelName,
    horizonHours,
    targetTime: new Date(Date.UTC(2026, 5, startDay + index, 12)),
    pctError,
  }));
}

describe('rollingSkill', () => {
  it('separates each forecaster and horizon into its own series', () => {
    const series = rollingSkill(
      [
        ...daily('persistence', 24, [0.1, 0.1, 0.1]),
        ...daily('persistence', 48, [0.2, 0.2, 0.2]),
        ...daily('climatology', 24, [0.3, 0.3, 0.3]),
      ],
      FROM,
      TO,
    );

    expect(
      series.map((one) => `${one.modelName} ${one.horizonHours}`),
    ).toEqual(['climatology 24', 'persistence 24', 'persistence 48']);
  });

  it('averages the scores inside the window, not the whole record', () => {
    // Ten days of scores, so a point late in the range can only see seven.
    const errors = daily('persistence', 24, [
      1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
    ]);

    const series = rollingSkill(errors, FROM, TO);
    const last = series[0].points[series[0].points.length - 1];

    // The window ending on the 11th covers the 4th to the 11th: four ones
    // and three zeros.
    expect(last.sampleSize).toBe(7);
    expect(last.meanPctError).toBeCloseTo(4 / 7, 10);
  });

  it('reports how many scores sit behind each point', () => {
    const series = rollingSkill(daily('persistence', 24, [0.1, 0.1]), FROM, TO);

    // The first point sees one score, the second sees both, and after that
    // the window keeps carrying them until they age out.
    expect(series[0].points[0].sampleSize).toBe(1);
    expect(series[0].points[1].sampleSize).toBe(2);
  });

  it('leaves a gap rather than plotting a zero where nothing was scored', () => {
    // A single score on the first day, then silence. Once it ages out of the
    // window the series simply stops, because no forecast is not the same
    // thing as a perfect forecast.
    const series = rollingSkill(daily('persistence', 24, [0.4]), FROM, TO);

    expect(series[0].points).toHaveLength(SKILL_WINDOW_DAYS);
    expect(series[0].points.every((point) => point.sampleSize === 1)).toBe(true);
  });

  it('plots one point per day across the range', () => {
    const errors = daily('persistence', 24, Array(10).fill(0.2));

    const series = rollingSkill(errors, FROM, TO);

    expect(series[0].points).toHaveLength(10);
    const gaps = series[0].points
      .slice(1)
      .map((point, index) => point.at.getTime() - series[0].points[index].at.getTime());
    expect(new Set(gaps)).toEqual(new Set([DAY_MS]));
  });

  it('lets a bad week stand out instead of averaging it away', () => {
    // Calm, then a storm week at four times the error, then calm again.
    const errors = daily('persistence', 24, [
      0.1, 0.1, 0.1, 0.4, 0.4, 0.4, 0.4, 0.1, 0.1, 0.1,
    ]);

    const series = rollingSkill(errors, FROM, TO);
    const peak = Math.max(...series[0].points.map((p) => p.meanPctError));
    const trough = Math.min(...series[0].points.map((p) => p.meanPctError));

    expect(peak).toBeGreaterThan(trough * 2);
  });

  it('returns nothing when no prediction has been scored yet', () => {
    expect(rollingSkill([], FROM, TO)).toEqual([]);
  });

  it('does not care what order the scores arrive in', () => {
    const errors = daily('persistence', 24, [0.1, 0.5, 0.3]);
    const forwards = rollingSkill(errors, FROM, TO);
    const backwards = rollingSkill([...errors].reverse(), FROM, TO);

    expect(backwards).toEqual(forwards);
  });
});
