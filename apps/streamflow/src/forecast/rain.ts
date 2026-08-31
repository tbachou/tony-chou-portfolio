import { forecastKnowableAt } from '../asof/forecast-as-of';
import type { KnowabilityAxis, StoredForecast } from '../types';

/**
 * How much rain a prediction was told to expect.
 *
 * This is the reference statement of the rule, in TypeScript. Production reads
 * the equivalent aggregate query in `rain.repository.ts`, and
 * `scripts/verify-rain.ts` checks the two agree against a real database. The
 * same split as the interval bucket and the as of reconstruction, for the same
 * reason: the rule has several ways to go quietly wrong and none of them are
 * visible in a query that returns a plausible number of millimetres.
 */

/** What a rain window is asked for. */
export interface RainCriteria {
  gaugeId: string;
  model: string;
  /**
   * The prediction horizon `H`, in hours. It is also the lead the rows must
   * carry: a rain window for a 48 hour prediction is built from 48 hour
   * forecasts and from nothing else. See below for why that is a leakage rule
   * rather than a tidiness one.
   */
  horizonHours: number;
  /** `T`, the instant the prediction is issued at. */
  issuedAt: Date;
  /**
   * Which knowability axis the caller is reading on, defaulting to the strict
   * `recordedAt`. Unlike the bucket's, this one genuinely moves the answer:
   * `forecastKnowableAt` maps it onto `issuedAt` for a weather row, never onto
   * the `validTime` the name spells (AC-R8a).
   */
  axis?: KnowabilityAxis;
}

/**
 * Cumulative forecast rainfall over the lead window, or null.
 *
 * Four rules, each of which the feature is wrong without:
 *
 * **One row per hour.** `WeatherForecast` is append only, so an hour Open-Meteo
 * revised is held more than once and the filtered set carries every revision.
 * The row that stands for an hour is the visible one with the greatest
 * `recordedAt`, exactly as `observationsAsOf` picks one reading per
 * `validTime`. Summing without reducing first double counts every revised
 * hour, and it fails in the flattering direction: more rain, on precisely the
 * storm hours most likely to have been revised (AC-R7).
 *
 * **The window is half open.** It runs after `T`, up to and including `T` plus
 * `H`. The hour at `T` itself belongs to the forecast before this one, and the
 * hour at the target instant is the one being predicted for. Getting either end
 * wrong shifts the whole feature by an hour without changing its shape, which
 * is the kind of error that survives eyeballing a chart.
 *
 * **The lead equals the horizon, and this is a leakage rule.** A row at lead
 * `L` valid at `V` was issued at `V` minus `L`. With `L` equal to `H` and `V`
 * inside the window, the issue time lands in the half open range `(T - H, T]`,
 * so every row is one the forecaster could genuinely have held at `T`. With a
 * shorter lead it does not: a 24 hour row valid at `T` plus 48 was issued at
 * `T` plus 24, a full day after the prediction. Admitting it would hand the
 * model rain it learned about after committing, which is the exact failure the
 * whole child exists to prevent. Matching the lead to the horizon is what makes
 * the archive axis bound hold for the entire window by construction rather than
 * by luck.
 *
 * **Exactly `H` hours, or null.** The window is `H` hours long over an hourly
 * archive, so a complete one holds `H` reduced rows. Fewer means the archive
 * has a gap, and a gap is not an absence of rain: returning zero would tell the
 * model it was forecast to stay dry, which is a confident lie. Null instead, so
 * a forecaster that needs rain is skipped for that horizon (AC-R10). The count
 * is of reduced rows, never raw ones, or a single revised hour could pad a
 * short window up to the required length. Compared with `!==` rather than `<`:
 * an hourly archive cannot exceed `H` distinct hours in an `H` hour window, so
 * a count above it means an assumption broke and refusing is the honest answer.
 *
 * Scoped by gauge and model as well, for the reason every read here is:
 * correct with one of each, silently wrong with two.
 *
 * Ties on `recordedAt` within an hour cannot occur in the store, which is what
 * the unique key on (gaugeId, validTime, leadHours, model, recordedAt) is for.
 * Strictly greater, so a malformed fixture keeps the first row seen rather than
 * depending on iteration order.
 */
export function rainWindow(
  rows: readonly StoredForecast[],
  criteria: RainCriteria,
): number | null {
  const { gaugeId, model, horizonHours, issuedAt, axis = 'recordedAt' } = criteria;

  const from = issuedAt.getTime();
  const to = from + horizonHours * 3600 * 1000;

  const eligible = rows.filter(
    (row) =>
      row.gaugeId === gaugeId &&
      row.model === model &&
      row.leadHours === horizonHours &&
      forecastKnowableAt(row, axis).getTime() <= from &&
      row.validTime.getTime() > from &&
      row.validTime.getTime() <= to,
  );

  const newestPerHour = new Map<number, StoredForecast>();
  for (const row of eligible) {
    const held = newestPerHour.get(row.validTime.getTime());
    if (!held || row.recordedAt.getTime() > held.recordedAt.getTime()) {
      newestPerHour.set(row.validTime.getTime(), row);
    }
  }

  if (newestPerHour.size !== horizonHours) return null;

  // Summed in `validTime` order, matching the query's, so the two cannot
  // disagree in the last bits of a float over a long window.
  return [...newestPerHour.entries()]
    .sort(([a], [b]) => a - b)
    .reduce((total, [, row]) => total + row.precipMm, 0);
}
