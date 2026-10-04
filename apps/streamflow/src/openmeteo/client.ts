import {
  GAUGE,
  OPEN_METEO_MODEL,
  OPEN_METEO_PREVIOUS_RUNS_ENDPOINT,
} from '../config';
import type { IngestWindow } from '../ingest/window';
import type { ForecastValue } from '../types';
import { assertStorableLead, parsePreviousRuns, previousRunColumn } from './parse';

/** Upstream request budget. Well above any healthy response, well below a CI job timeout. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Why a fetch or a body read threw, written into the message.
 *
 * `sanitizeError` is the only path to `PipelineRun` and the log, and it reads
 * the message alone, so a reason left only on `cause` is lost. The reason is
 * what tells a timeout (`TimeoutError`) from a dropped connection (`fetch
 * failed` with a socket code). Mirrors `describeCause` in the USGS client, but
 * reads any object carrying a name and a message rather than only an `Error`,
 * because a `DOMException` (which is how the timeout arrives) is not always one.
 */
function describeCause(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return String(cause);
  const { name, message } = cause as { name?: unknown; message?: unknown };
  if (typeof name !== 'string' || typeof message !== 'string') return String(cause);
  const code = ((cause as { cause?: unknown }).cause as { code?: unknown } | undefined)?.code;
  return `${name}: ${message}${typeof code === 'string' ? ` (${code})` : ''}`;
}

/**
 * Formats an instant as the plain calendar day Open-Meteo's date parameters
 * take. Derived in UTC, because the request pins GMT and the store holds
 * nothing else.
 */
export function toArchiveDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Builds one Previous Runs request: one gauge, one lead, one window.
 *
 * The host is the pinned constant and the model is named explicitly, so a test
 * can read both off the URL (AC-R1, AC-R12). `models` carries one value and it
 * is never `best_match`.
 */
export function buildPreviousRunsUrl(
  window: IngestWindow,
  leadHours: number,
  latitude: number = GAUGE.lat,
  longitude: number = GAUGE.lon,
): string {
  assertStorableLead(leadHours);

  const url = new URL(OPEN_METEO_PREVIOUS_RUNS_ENDPOINT);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('start_date', toArchiveDate(window.start));
  url.searchParams.set('end_date', toArchiveDate(window.end));
  url.searchParams.set(
    'hourly',
    [
      previousRunColumn('precipitation', leadHours),
      previousRunColumn('temperature_2m', leadHours),
    ].join(','),
  );
  url.searchParams.set('models', OPEN_METEO_MODEL);
  // Explicit rather than relying on the service's default, so the times the
  // parser stamps as UTC are the times the service meant.
  url.searchParams.set('timezone', 'GMT');
  return url.toString();
}

/**
 * Fetches one lead's hourly forecast values for a window.
 *
 * One request per (window, lead), which is the unit AC-R5 records a
 * `PipelineRun` for. A failing request throws rather than returning a short
 * list, because a short list and a short window are indistinguishable to the
 * caller and one of them means a gap that would never be filled. This is the
 * same choice `fetchInstantaneousValues` makes for USGS.
 *
 * Open and keyless, so there is no credential to leak here.
 */
export async function fetchPreviousRuns(
  window: IngestWindow,
  leadHours: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastValue[]> {
  const where = `lead ${leadHours} over ${toArchiveDate(window.start)} to ${toArchiveDate(window.end)}`;

  let response: Response;
  try {
    response = await fetchImpl(buildPreviousRunsUrl(window, leadHours), {
      // A hung upstream used to block the job until the CI timeout killed it,
      // burning the whole window instead of failing into the FAILED run path in
      // seconds. Everything else about a failure here is recorded promptly.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    // A refused connection, a DNS blip or the timeout above.
    throw new Error(`Open-Meteo request threw for ${where}: ${describeCause(cause)}`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with ${response.status} for ${where}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // A body that stalls into the timeout, a reset mid body, or a page that is
    // not JSON.
    throw new Error(`Open-Meteo response body failed for ${where}: ${describeCause(cause)}`, {
      cause,
    });
  }

  // Trimmed to the window actually asked for. Open-Meteo's date parameters have
  // calendar day granularity, so a window ending mid day comes back with that
  // whole day attached, including hours that have not happened yet. Storing
  // those would put rows in the archive that were never forecast at the lead
  // they carry, which is the same defect clamping the window exists to prevent;
  // the clamp alone does not close it, because the request can only name a day.
  return parsePreviousRuns(body, leadHours).filter(
    (value) =>
      value.validTime.getTime() >= window.start.getTime() &&
      value.validTime.getTime() <= window.end.getTime(),
  );
}
