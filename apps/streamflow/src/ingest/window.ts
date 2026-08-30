import { BACKFILL_START, INGEST_OVERLAP_HOURS } from '../config';

export interface IngestWindow {
  start: Date;
  end: Date;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Works out which span of time the next ingest should request.
 *
 * The start is the newest `validTime` already stored, pulled back by a fixed
 * overlap so a reading that settled just after we first saw it gets compared
 * again. On an empty table it is the backfill start, which sits a little before
 * the weather archive rather than on it. `config.ts` carries why the two are
 * not the same date, and names the read that measures the archive's real
 * boundary per lead instead of pinning it.
 *
 * Gap recovery (AC-6) falls out of this rather than being a separate branch:
 * because the start is anchored to what is stored and not to the schedule, a
 * run that was missed for thirty hours asks for the whole thirty hours. There
 * is no code path that only ever asks for the most recent window.
 */
export function computeIngestWindow(
  latestStoredValidTime: Date | null,
  now: Date,
): IngestWindow {
  const start =
    latestStoredValidTime === null
      ? new Date(BACKFILL_START)
      : new Date(latestStoredValidTime.getTime() - INGEST_OVERLAP_HOURS * HOUR_MS);

  // A stored validTime ahead of our clock means skew somewhere, and an
  // inverted window would make USGS reject the request. Collapse it to an
  // empty window at `now` instead, so the run records itself and moves on.
  if (start.getTime() > now.getTime()) {
    return { start: new Date(now), end: new Date(now) };
  }

  return { start, end: new Date(now) };
}

/**
 * How many readings a window should contain if the sensor never missed one.
 *
 * Counts the reading boundaries that fall inside the window rather than
 * dividing its length, because a window almost never starts on one. An ingest
 * begins at the newest stored reading minus a fixed overlap and ends at the
 * current instant, so both ends land mid interval, and dividing the span
 * overcounts by up to two readings that could never have existed. That was
 * enough to make a flawless response report PARTIAL.
 */
export function expectedReadingCount(
  window: IngestWindow,
  intervalMinutes: number,
): number {
  if (window.end.getTime() <= window.start.getTime()) return 0;

  const intervalMs = intervalMinutes * 60 * 1000;
  const firstBoundary = Math.ceil(window.start.getTime() / intervalMs) * intervalMs;
  const lastBoundary = Math.floor(window.end.getTime() / intervalMs) * intervalMs;

  if (lastBoundary < firstBoundary) return 0;
  return (lastBoundary - firstBoundary) / intervalMs + 1;
}

/**
 * Intervals at the leading edge that may legitimately not exist yet.
 *
 * A window runs to the current instant, but the gauge publishes on a delay, so
 * the newest interval or two are routinely absent from an otherwise perfect
 * response. Without this tolerance every single run would report PARTIAL, and
 * a status that is always PARTIAL says nothing about a real outage.
 */
const PUBLICATION_LAG_INTERVALS = 2;

/**
 * Decides whether a response covered its window.
 *
 * PARTIAL means the source answered but returned fewer intervals than the
 * window implies, which is how a sensor outage shows up. It is deliberately
 * judged against the whole window rather than against the readings that
 * arrived: a gauge that stopped reporting days ago still returns a clean run
 * of readings from before it died, and only the window knows how much is
 * missing after them.
 */
export function judgeCompleteness(
  receivedCount: number,
  window: IngestWindow,
  intervalMinutes: number,
): 'OK' | 'PARTIAL' {
  const expected =
    expectedReadingCount(window, intervalMinutes) - PUBLICATION_LAG_INTERVALS;

  return receivedCount < expected ? 'PARTIAL' : 'OK';
}
