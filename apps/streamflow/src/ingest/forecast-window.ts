import type { IngestWindow } from './window';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The calendar month containing an instant, as a window of hourly slots in UTC.
 *
 * The month is the backfill's chunk unit (AC-R5): one request, one
 * `PipelineRun`, one set of month boundaries recorded on it. Derived in UTC
 * because the store holds nothing else and Open-Meteo is asked in GMT.
 *
 * The end is the month's last hourly slot, not the first instant of the next
 * month, so the window names hours that actually exist in the response.
 */
export function monthWindow(within: Date): IngestWindow {
  const year = within.getUTCFullYear();
  const month = within.getUTCMonth();

  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - HOUR_MS);

  return { start, end };
}

/** The next calendar month's window, for walking the backfill forward. */
export function nextMonthWindow(window: IngestWindow): IngestWindow {
  return monthWindow(new Date(window.end.getTime() + HOUR_MS));
}

/**
 * How many hourly slots a window holds if the archive covered every one.
 *
 * Counted from the boundaries rather than by dividing the span, so a window
 * that does not begin exactly on the hour cannot overcount. Both ends are
 * inclusive, which is what `monthWindow` produces.
 */
export function expectedHourCount(window: IngestWindow): number {
  if (window.end.getTime() < window.start.getTime()) return 0;

  const first = Math.ceil(window.start.getTime() / HOUR_MS) * HOUR_MS;
  const last = Math.floor(window.end.getTime() / HOUR_MS) * HOUR_MS;

  if (last < first) return 0;
  return (last - first) / HOUR_MS + 1;
}

/**
 * Decides whether a response covered its month (AC-R14).
 *
 * PARTIAL means the service answered but returned fewer non null hours than the
 * window implies. The archive ramps in at its start, so the earliest months are
 * expected to land here, and that is a fact worth recording rather than a
 * failure worth throwing on.
 *
 * Judged against the whole window and not against what arrived, for the same
 * reason `judgeCompleteness` is: a clean run of hours from before a gap tells
 * you nothing about how much is missing after them.
 */
export function judgeForecastCompleteness(
  hoursReturned: number,
  window: IngestWindow,
): 'OK' | 'PARTIAL' {
  return hoursReturned < expectedHourCount(window) ? 'PARTIAL' : 'OK';
}
