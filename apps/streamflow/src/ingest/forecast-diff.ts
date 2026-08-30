import type { ForecastValue, StoredForecast } from '../types';

/**
 * Whether a parsed temperature says the same thing as a stored one.
 *
 * An absent parsed value and a stored null count as equal (AC-R3). Without
 * this, an hour Open-Meteo has no temperature for would look changed on every
 * single run and write a new row each time, so a missing optional field would
 * quietly become the largest writer in the pipeline.
 */
function sameTemp(parsed: number | undefined, stored: number | null): boolean {
  if (parsed === undefined) return stored === null;
  return stored !== null && stored === parsed;
}

/**
 * Picks the forecast values that actually say something new.
 *
 * A value is written when nothing is known for that (validTime, lead) yet, or
 * when `precipMm` differs, or when `tempC` differs. Re-running an unchanged
 * month returns an empty list, which is what makes the backfill idempotent and
 * what lets AC-R5 promise that re-running a completed month writes zero rows.
 *
 * `known` is the reduced snapshot for the chunk, one row per (validTime, lead),
 * fetched in a single query by `forecastsAsOf`. The comparison happens here in
 * memory rather than by asking the database per hour, which is the other half
 * of AC-R16.
 *
 * Deliberately not `selectChangedReadings`. That one keys on `validTime` alone,
 * which is right for observations and wrong here: two leads describe the same
 * hour and are different facts, so keying on the hour would let one lead's
 * value suppress the other's.
 */
export function selectChangedForecasts(
  values: readonly ForecastValue[],
  known: readonly StoredForecast[],
): ForecastValue[] {
  const key = (validTime: Date, leadHours: number) =>
    `${validTime.getTime()}:${leadHours}`;

  const current = new Map<string, { precipMm: number; tempC: number | null }>();
  for (const row of known) {
    current.set(key(row.validTime, row.leadHours), {
      precipMm: row.precipMm,
      tempC: row.tempC,
    });
  }

  const changed = new Map<string, ForecastValue>();

  for (const value of values) {
    const at = key(value.validTime, value.leadHours);
    const existing = current.get(at);

    if (
      existing &&
      existing.precipMm === value.precipMm &&
      sameTemp(value.tempC, existing.tempC)
    ) {
      continue;
    }

    // Fold each accepted value back in before looking at the next one. Every
    // row a run writes shares that run's single recordedAt, so two rows for one
    // (validTime, lead) would collide on the unique key; keeping the last one
    // seen is what stops the write failing. Same reasoning as `diff.ts`.
    current.set(at, {
      precipMm: value.precipMm,
      tempC: value.tempC ?? null,
    });
    changed.set(at, value);
  }

  return [...changed.values()];
}
