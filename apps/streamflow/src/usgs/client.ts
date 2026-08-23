import {
  DISCHARGE_PARAMETER_CODE,
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

function buildUrl(siteId: string, window: IngestWindow): string {
  const url = new URL(USGS_IV_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('sites', siteId);
  url.searchParams.set('parameterCd', DISCHARGE_PARAMETER_CODE);
  url.searchParams.set('startDT', window.start.toISOString());
  url.searchParams.set('endDT', window.end.toISOString());
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
): Promise<Reading[]> {
  const readings: Reading[] = [];

  for (const span of chunk(window)) {
    const response = await fetchImpl(buildUrl(siteId, span));

    if (!response.ok) {
      throw new Error(
        `USGS request failed with ${response.status} for ${span.start.toISOString()} to ${span.end.toISOString()}`,
      );
    }

    readings.push(...parseInstantaneousValues(await response.json()));
  }

  return readings;
}
