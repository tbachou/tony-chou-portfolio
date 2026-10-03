import {
  DISCHARGE_PARAMETER_CODE,
  GAUGE,
  USGS_IV_ENDPOINT,
} from '../config';
import { sanitizeError } from '../errors';
import type { Reading } from '../types';
import type { IngestWindow } from '../ingest/window';
import { parseInstantaneousValues } from './parse';

/** Upstream request budget. Well above any healthy response, well below a CI job timeout. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * How many times a single chunk is asked for before the call gives up.
 *
 * **Measured, not guessed.** On 2026-09-05 the pipeline failed twice in a row
 * on `503`s from USGS while the service was plainly alive: twelve identical
 * requests, two seconds apart, returned eleven `200`s and one `503`, and the
 * one failure was followed immediately by success. USGS flaps rather than
 * going down, at roughly eight percent per request, independent of the window
 * asked for.
 *
 * Eight percent per request is not eight percent per run. A rescan re polls
 * `RESCAN_ROLLING_DAYS` at `MAX_REQUEST_DAYS` a time, so a run makes at least
 * four requests, and `fetchInstantaneousValues` fails the whole call on any
 * one of them by design. That compounds to roughly a twenty eight percent
 * chance of losing a whole six hourly cycle, which is what was actually
 * observed. Three attempts take the per request rate to 0.08 cubed and the
 * per run rate to about two in a thousand.
 *
 * The cost is bounded. In CI a failing `503` took three to eight seconds to
 * arrive (a healthy answer takes about a quarter second), so a chunk that
 * fails every attempt spends around three such waits plus the backoff below:
 * under a minute. The pathological case, a chunk that times out on every
 * attempt, spends three `UPSTREAM_TIMEOUT_MS` waits plus the backoff, about
 * two minutes, and the first chunk to exhaust its attempts ends the step, so
 * the twenty minute job budget still absorbs it many times over.
 */
const RETRY_ATTEMPTS = 3;

/**
 * Waits between attempts, in milliseconds, one per retry.
 *
 * **Sized on CI, not on the first probe.** The 2026-09-05 blip cleared within
 * two seconds, which first set these at one and three seconds. The CI runs of
 * 2026-09-24 to 2026-10-03 show longer bad stretches: in every run where the
 * ingest failed and the rescan failed right after it, USGS was still failing
 * ten to sixteen seconds after the first request. Because a failing attempt
 * itself takes three to eight seconds, one and three seconds put the last
 * attempt only ten to twenty seconds in, at the edge of those stretches. Five
 * and twenty put it thirty to forty seconds in.
 *
 * Still not a wait for an outage. A real outage should fail the run within a
 * couple of minutes and be recorded, because `PipelineRun` is how a stopped
 * pipeline becomes visible at all.
 */
const RETRY_BACKOFF_MS = [5_000, 20_000];

/**
 * Whether a failed attempt is worth repeating.
 *
 * **A 4xx is not retried, and that is the load bearing half of this rule.**
 * A `400` or a `404` means the request itself is wrong: the window is
 * malformed, the site id is bad, the parameter code changed. Retrying that
 * turns a fast, loud, fixable bug into a slow one that still fails, and it
 * spends three times the budget to learn what the first attempt already said.
 * A 5xx, which is the server saying it could not answer a question it
 * understood, earns another go.
 *
 * So do the two 4xx codes that describe the server rather than the request:
 * `408` (it gave up waiting) and `429` (it is throttling). USGS has announced
 * that WaterServices will be "intentionally throttled and undergo several
 * planned outages" before it is retired in Q1 2027, and a throttled request
 * answers 429. None had appeared in CI as of 2026-10-03, so these ride the
 * same backoff rather than a `Retry-After` header nobody has seen yet.
 */
function worthRetrying(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Why a fetch or a body read threw, written into the message.
 *
 * `sanitizeError` is the only path to `PipelineRun` and the log, and it reads
 * the message alone, so a reason left only on `cause` is lost. The reason is
 * what tells a timeout (`TimeoutError`) from a dropped connection (`fetch
 * failed` with a socket code), which is how the 2026-10-03 diagnosis was made.
 */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const code = (cause.cause as { code?: unknown } | undefined)?.code;
  return `${cause.name}: ${cause.message}${typeof code === 'string' ? ` (${code})` : ''}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
  // Injected so the retry can be tested without spending its own backoff.
  sleepImpl: (ms: number) => Promise<void> = sleep,
): Promise<Reading[]> {
  const readings: Reading[] = [];

  for (const span of chunk(window)) {
    const where = `${span.start.toISOString()} to ${span.end.toISOString()}`;
    let lastError: Error | undefined;
    let body: unknown;
    let answered = false;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        // One line per retry, so a flap the retry absorbs still shows in the
        // CI log. Without it a run that needed two retries reads as a clean
        // one, and the rising failure rate that says this source is being
        // retired goes quiet.
        console.warn(
          `usgs retry ${attempt} of ${RETRY_ATTEMPTS - 1} for ${where} after: ${sanitizeError(lastError)}`,
        );
        await sleepImpl(RETRY_BACKOFF_MS[attempt - 1] ?? 0);
      }

      let response: Response;
      try {
        response = await fetchImpl(buildUrl(siteId, span, timeZone), {
          // A hung upstream used to block the job until the CI timeout killed
          // it, burning the whole window instead of failing into the FAILED
          // run path in seconds. Everything else about a failure here is
          // recorded promptly.
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (cause) {
        // A refused connection, a DNS blip or the timeout above. Same class of
        // fault as a 5xx and retried on the same terms.
        lastError = new Error(
          `USGS request threw for ${where}: ${describeCause(cause)}`,
          { cause },
        );
        continue;
      }

      if (!response.ok) {
        lastError = new Error(
          `USGS request failed with ${response.status} for ${where}`,
        );

        // Most 4xx are our bug, not theirs. Fail now rather than three times.
        if (!worthRetrying(response.status)) throw lastError;
        continue;
      }

      // Read inside the loop: a body that stalls into the timeout above, a
      // reset mid body, or a page that is not JSON is the same transient class
      // as a 5xx, arriving one step later.
      try {
        body = await response.json();
      } catch (cause) {
        lastError = new Error(
          `USGS response body failed for ${where}: ${describeCause(cause)}`,
          { cause },
        );
        continue;
      }

      answered = true;
      break;
    }

    if (!answered) throw lastError ?? new Error(`USGS request failed for ${where}`);

    readings.push(...parseInstantaneousValues(body));
  }

  return readings;
}
