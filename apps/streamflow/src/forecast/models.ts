import { climatologyForecast, persistenceForecast } from './baselines';
import type { StoredObservation } from '../types';

/**
 * The forecasters that exist as rows.
 *
 * A baseline is a competitor, not a footnote, so it is registered exactly as
 * a trained model will be and scored by the same code. Nothing downstream
 * branches on which kind it is looking at, which is what makes the comparison
 * on the dashboard structural rather than assembled at the end out of two
 * different numbers.
 */
export interface BaselineModel {
  name: string;
  /**
   * The central estimate, or null when this forecaster cannot honestly
   * answer. Climatology returns null through the whole first year of the
   * record, because it has no earlier year to average, and that is a real
   * state rather than a bug: an invented number there would be scored as
   * though it had been a claim.
   *
   * `history` must already be the as of reconstruction at `issuedAt`. These
   * functions cannot check it, and handing them rows recorded later is how a
   * backtest ends up flattering itself.
   */
  central: (
    history: readonly StoredObservation[],
    issuedAt: Date,
    targetTime: Date,
    timeZone: string,
  ) => number | null;
}

export const BASELINE_MODELS: readonly BaselineModel[] = [
  {
    name: 'persistence',
    central: (history, issuedAt) => persistenceForecast(history, issuedAt),
  },
  {
    name: 'climatology',
    central: (history, _issuedAt, targetTime, timeZone) =>
      climatologyForecast(history, targetTime, timeZone),
  },
];
