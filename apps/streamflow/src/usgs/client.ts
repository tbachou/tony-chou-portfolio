import {
  DISCHARGE_PARAMETER_CODE,
  GAUGE,
  USGS_IV_ENDPOINT,
} from '../config';
import type { Reading } from '../types';
import type { IngestWindow } from '../ingest/window';
import { parseInstantaneousValues } from './parse';

/**
 * Longest span asked for in one request. The first run on an empty table wants
 * about two and a half years, which as a single request is tens of thousands of
 * readings and is where the service starts timing out. Splitting it changes
 * nothing about which readings are fetched, only how many trips it takes.
 */
const MAX_REQUEST_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function chunk(window: IngestWindow): IngestWindow[] {
  const chunks: IngestWindow[] = [];
  let start = window.start;

  while (start.getTime() < window.end.getTime()) {
    const end = new Date(
      Math.min(start.getTime() + MAX_REQUEST_DAYS * DAY_MS, window.end.getTime()),
    );
    chunks.push({ start, end });
    start = end;
  }

  return chunks;
}

/**
 * Formats an instant as the gauge's own wall clock, with no timezone marker.
 *
 * This looks wrong and is not. USGS mishandles any startDT or endDT carrying a
 * timezone designator: it converts using the site's *current* daylight saving
 * offset rather than the offset in force on the requested date, so every
 * winter request issued from a summer machine comes back an hour off. Verified
 * against the live service on 2026-08-24, asking three ways for the same
 * half hour on 2025-11-26:
 *
 *   ...Z                 asked 14:15-14:45Z, returned 15:15-15:45Z  wrong
 *   explicit -05:00      asked 14:15-14:45Z, returned 15:15-15:45Z  wrong
 *   bare local time      asked 14:15-14:45Z, returned 14:15-14:45Z  right
 *
 * A bare local timestamp is the only form the service reads correctly, so that
 * is what we send. The store still holds nothing but UTC; this conversion
 * exists solely at the boundary with USGS.
 */
export function toSiteLocalTimestamp(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 rather than hour12:false, which yields "24" for midnight on some
    // runtimes and would produce a timestamp the service rejects.
    hourCycle: 'h23',
  }).formatToParts(at);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

function buildUrl(
  siteId: string,
  window: IngestWindow,
  timeZone: string,
): string {
  const url = new URL(USGS_IV_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('sites', siteId);
  url.searchParams.set('parameterCd', DISCHARGE_PARAMETER_CODE);
  url.searchParams.set('startDT', toSiteLocalTimestamp(window.start, timeZone));
  url.searchParams.set('endDT', toSiteLocalTimestamp(window.end, timeZone));
  return url.toString();
}

/**
 * Fetches discharge readings for a window from the USGS instantaneous values
 * service. Open and keyless, so there is no credential to leak here.
 *
 * Chunks are requested in order and concatenated. A single failing chunk fails
 * the whole call rather than returning a partial list, because a short list and
 * a short window are indistinguishable to the caller, and one of them means a
 * gap that would never be filled.
 */
export async function fetchInstantaneousValues(
  siteId: string,
  window: IngestWindow,
  fetchImpl: typeof fetch = fetch,
  timeZone: string = GAUGE.timezone,
): Promise<Reading[]> {
  const readings: Reading[] = [];

  for (const span of chunk(window)) {
    const response = await fetchImpl(buildUrl(siteId, span, timeZone));

    if (!response.ok) {
      throw new Error(
        `USGS request failed with ${response.status} for ${span.start.toISOString()} to ${span.end.toISOString()}`,
      );
    }

    readings.push(...parseInstantaneousValues(await response.json()));
  }

  return readings;
}
