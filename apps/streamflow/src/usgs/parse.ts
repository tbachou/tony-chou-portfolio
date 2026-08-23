import {
  DISCHARGE_PARAMETER_CODE,
  USGS_NO_DATA_VALUE,
} from '../config';
import type { Qualifier, Reading } from '../types';

/**
 * Maps a USGS qualifier code list onto the store's two states.
 *
 * USGS returns an array because codes combine: `["P"]`, `["A"]`, and
 * `["P","e"]` for a provisional estimated reading are all normal. Only the
 * presence of the approved code decides, so an added estimation flag cannot
 * quietly demote an approved reading.
 */
function toQualifier(codes: readonly string[]): Qualifier {
  return codes.includes('A') ? 'APPROVED' : 'PROVISIONAL';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parses a USGS instantaneous values response into discharge readings.
 *
 * Throws on a shape it does not recognise rather than returning an empty list,
 * because an empty window and a changed API look identical downstream and only
 * one of them is safe to ignore. An empty `timeSeries` is not an error: it is
 * what a window with no data legitimately looks like.
 */
export function parseInstantaneousValues(raw: unknown): Reading[] {
  if (!isRecord(raw) || !isRecord(raw.value)) {
    throw new Error('USGS response has no value object');
  }

  const timeSeries = raw.value.timeSeries;
  if (!Array.isArray(timeSeries)) {
    throw new Error('USGS response has no timeSeries array');
  }

  const discharge = timeSeries.filter((series) => {
    if (!isRecord(series) || !isRecord(series.variable)) return false;
    const codes = series.variable.variableCode;
    if (!Array.isArray(codes)) return false;
    return codes.some(
      (code) => isRecord(code) && code.value === DISCHARGE_PARAMETER_CODE,
    );
  });

  if (discharge.length === 0) return [];

  // A site can expose more than one discharge series (separate sub-locations).
  // Merging them would average two different places in the river, so refuse
  // rather than guess which one the gauge means.
  if (discharge.length > 1) {
    throw new Error(
      `USGS returned ${discharge.length} discharge series; expected exactly one`,
    );
  }

  const series = discharge[0] as Record<string, unknown>;
  const valueBlocks = series.values;
  if (!Array.isArray(valueBlocks)) {
    throw new Error('USGS discharge series has no values array');
  }

  const readings: Reading[] = [];
  for (const block of valueBlocks) {
    if (!isRecord(block) || !Array.isArray(block.value)) continue;

    for (const entry of block.value) {
      if (!isRecord(entry)) {
        throw new Error('USGS value entry is not an object');
      }
      if (typeof entry.dateTime !== 'string') {
        throw new Error('USGS value entry has no dateTime');
      }
      if (typeof entry.value !== 'string') {
        throw new Error('USGS value entry has no value');
      }

      const validTime = new Date(entry.dateTime);
      if (Number.isNaN(validTime.getTime())) {
        throw new Error(`USGS value entry has unparseable dateTime: ${entry.dateTime}`);
      }

      const valueCfs = Number(entry.value);
      if (!Number.isFinite(valueCfs)) {
        throw new Error(`USGS value entry has unparseable value: ${entry.value}`);
      }
      // The sentinel means the sensor reported nothing. Dropping it here is
      // what turns an outage into a gap, which the store derives at read time.
      if (valueCfs === USGS_NO_DATA_VALUE) continue;

      const codes = Array.isArray(entry.qualifiers)
        ? entry.qualifiers.filter((code): code is string => typeof code === 'string')
        : [];

      readings.push({ validTime, valueCfs, qualifier: toQualifier(codes) });
    }
  }

  return readings;
}
