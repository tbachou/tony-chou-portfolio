import { DISPLAY_TIMEZONE } from '../config';
import type { StoredObservation } from '../types';

/**
 * The two reference forecasts every real model has to beat.
 *
 * Neither has parameters and neither is trained. They are not placeholders:
 * persistence lands within about 12 percent at 24 hours on this gauge, which
 * is the bar a learned model must clear before it has earned its place. Both
 * are stored as ordinary ModelVersion rows and scored by the same code as
 * anything else, so the comparison is structural rather than assembled at the
 * end from two different numbers.
 */

/**
 * Persistence: the river will read what it reads now.
 *
 * That is the whole method. Its error is simply how much the river changed, so
 * it is excellent on a flat day and hopeless on a rising limb, where it cannot
 * know rain is coming. It is the standard short range reference forecast for
 * exactly this reason: it captures inertia and nothing else, which separates
 * the part of the problem that is genuinely hard from the part that is free.
 *
 * `history` must already be the as of reconstruction at the issue time. This
 * function cannot check that, and handing it rows recorded later is how a
 * backtest ends up flattering itself.
 */
export function persistenceForecast(
  history: readonly StoredObservation[],
  issuedAt: Date,
): number | null {
  let newest: StoredObservation | undefined;

  for (const row of history) {
    if (row.validTime.getTime() > issuedAt.getTime()) continue;
    if (!newest || row.validTime.getTime() > newest.validTime.getTime()) {
      newest = row;
    }
  }

  return newest ? newest.valueCfs : null;
}

/** Calendar days either side of the target that count toward climatology. */
const CLIMATOLOGY_WINDOW_DAYS = 7;

/**
 * The fewest readings that may stand in for "what this creek usually does".
 * Below this the mean is an anecdote, and a wrong interval built on it would
 * look just as confident as a right one.
 */
const MIN_CLIMATOLOGY_READINGS = 96;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves an instant to its calendar day at the gauge, as month and day.
 *
 * Deliberately not UTC. Spec 0010 makes this an invariant: a reading just
 * after midnight Eastern belongs to that day, not the next one. In UTC every
 * reading between 19:00 and midnight local would be filed a day late, which
 * would smear the seasonal signal this baseline is entirely built on.
 */
function calendarDayKey(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return get('month') * 100 + get('day');
}

function calendarYear(at: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(at),
  );
}

/**
 * Climatology: the river will do what it usually does at this time of year.
 *
 * The mean of every reading within seven calendar days of the target's date,
 * taken from earlier years only. It ignores current conditions completely,
 * which is why its error barely changes between a 24 hour and a 72 hour
 * horizon: it was never using the horizon in the first place. That flatness is
 * the point. It marks the floor a forecast has to stand above.
 *
 * The window is a range of days rather than an exact date match for two
 * reasons the spec names. A single calendar day gives one short sample per
 * year, and an exact day of year index drifts across leap years so late
 * February would silently compare against different dates in different years.
 *
 * Only earlier years count. Including the target's own year would let the
 * baseline see the season it is trying to predict.
 */
export function climatologyForecast(
  history: readonly StoredObservation[],
  targetTime: Date,
  timeZone: string = DISPLAY_TIMEZONE,
): number | null {
  const targetYear = calendarYear(targetTime, timeZone);

  const wantedDays = new Set<number>();
  for (
    let offset = -CLIMATOLOGY_WINDOW_DAYS;
    offset <= CLIMATOLOGY_WINDOW_DAYS;
    offset += 1
  ) {
    wantedDays.add(
      calendarDayKey(new Date(targetTime.getTime() + offset * DAY_MS), timeZone),
    );
  }

  let total = 0;
  let count = 0;

  for (const row of history) {
    if (calendarYear(row.validTime, timeZone) >= targetYear) continue;
    if (!wantedDays.has(calendarDayKey(row.validTime, timeZone))) continue;
    total += row.valueCfs;
    count += 1;
  }

  return count >= MIN_CLIMATOLOGY_READINGS ? total / count : null;
}
