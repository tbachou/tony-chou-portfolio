import { MIN_LEAD_HOURS } from '../config';
import type { ForecastValue } from '../types';

/**
 * The hourly variables this pipeline reads, as Open-Meteo names them.
 *
 * The suffix is the whole point. `precipitation_previous_day1` is what the
 * model said a day before the hour it describes; a bare `precipitation` is what
 * the freshest available run says, which for a past date is very nearly what
 * actually fell. The two are the same shape and the same units, and confusing
 * them is exactly the leak this child exists to refuse, so the suffixed name is
 * built from the lead rather than defaulted to (AC-R1).
 */
export function previousRunColumn(
  variable: 'precipitation' | 'temperature_2m',
  leadHours: number,
): string {
  return `${variable}_previous_day${leadHours / 24}`;
}

/** Rejects a lead this pipeline must never store, before a request is built. */
export function assertStorableLead(leadHours: number): void {
  if (leadHours < MIN_LEAD_HOURS || leadHours % 24 !== 0) {
    throw new Error(
      `leadHours must be a multiple of 24 and at least ${MIN_LEAD_HOURS}, got ${leadHours}`,
    );
  }
}

interface HourlyBlock {
  time?: unknown;
  [column: string]: unknown;
}

function hourlyBlock(payload: unknown): HourlyBlock {
  if (typeof payload !== 'object' || payload === null || !('hourly' in payload)) {
    throw new Error('Open-Meteo response has no hourly block');
  }

  const hourly = (payload as { hourly: unknown }).hourly;
  if (typeof hourly !== 'object' || hourly === null) {
    throw new Error('Open-Meteo response has no hourly block');
  }

  return hourly as HourlyBlock;
}

function numericColumn(hourly: HourlyBlock, name: string): (number | null)[] {
  const column = hourly[name];
  if (!Array.isArray(column)) {
    throw new Error(`Open-Meteo response is missing column ${name}`);
  }
  return column.map((value) => (typeof value === 'number' ? value : null));
}

/**
 * Turns one Previous Runs response into the forecast values for a single lead.
 *
 * Only the suffixed columns for `leadHours` are looked up by name. An
 * unsuffixed `precipitation` in the same payload is never read, not merely
 * ignored after reading: there is no code path here that can reach it, which is
 * what AC-R1 asks for.
 *
 * An hour whose precipitation is null is dropped rather than stored as zero.
 * The archive ramps in at its start, so some requested hours genuinely have no
 * forecast, and a zero would enter the training set as a confident "no rain".
 * The caller counts what survives to judge completeness (AC-R14).
 *
 * Times are read as UTC. Open-Meteo returns them without a zone designator and
 * the request pins GMT, so the marker is appended rather than inferred from the
 * machine's own clock.
 */
export function parsePreviousRuns(
  payload: unknown,
  leadHours: number,
): ForecastValue[] {
  assertStorableLead(leadHours);

  const hourly = hourlyBlock(payload);
  const times = hourly.time;
  if (!Array.isArray(times)) {
    throw new Error('Open-Meteo response is missing column time');
  }

  const precipitation = numericColumn(
    hourly,
    previousRunColumn('precipitation', leadHours),
  );
  const temperature = numericColumn(
    hourly,
    previousRunColumn('temperature_2m', leadHours),
  );

  const values: ForecastValue[] = [];

  for (let index = 0; index < times.length; index += 1) {
    const precipMm = precipitation[index];
    if (precipMm === null || precipMm === undefined) continue;

    const stamp = times[index];
    if (typeof stamp !== 'string') continue;

    const validTime = new Date(`${stamp}Z`);
    if (Number.isNaN(validTime.getTime())) {
      throw new Error(`Open-Meteo returned an unparseable time ${stamp}`);
    }

    const tempC = temperature[index];

    values.push({
      validTime,
      leadHours,
      precipMm,
      // null becomes undefined so the diff has one absent value to compare,
      // and AC-R3 makes that equal to a stored null.
      ...(tempC === null || tempC === undefined ? {} : { tempC }),
    });
  }

  return values;
}
