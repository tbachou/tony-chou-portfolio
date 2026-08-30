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
 * Narrows a window so it never asks for an hour that has not happened yet.
 *
 * The backfill chunks by calendar month, and the month in progress runs past
 * the current instant. Asking for it is wrong twice over. Open-Meteo rejects an
 * `end_date` more than fifteen days ahead with a 400, which kills the whole
 * walk for the first half of every month; and when the end does fall inside
 * that allowance the service answers with fully populated future hours, which
 * is worse, because they look like a complete month.
 *
 * Those future rows are not what they claim. Open-Meteo serves the nearest
 * available run under the nominal lead label, so an hour that has not happened
 * yet comes back under `_previous_day1` without having been forecast a day
 * earlier, and storing it yields a row whose derived `issuedAt` postdates the
 * `recordedAt` at which we learned it. That inverts the two axes the whole
 * store exists to keep straight.
 */
export function clampWindowTo(window: IngestWindow, now: Date): IngestWindow {
  return window.end.getTime() <= now.getTime()
    ? window
    : { start: window.start, end: new Date(now) };
}

/** Whether every hour in the window has already happened. */
export function isWindowElapsed(window: IngestWindow, now: Date): boolean {
  return window.end.getTime() <= now.getTime();
}

/**
 * Decides whether a response covered its month (AC-R14).
 *
 * PARTIAL means the service answered but returned fewer non null hours than the
 * window implies. The archive ramps in at its start, so the earliest months are
 * expected to land here, and that is a fact worth recording rather than a
 * failure worth throwing on.
 *
 * Judged against the requested window and not against what arrived, for the
 * same reason `judgeCompleteness` is: a clean run of hours from before a gap
 * tells you nothing about how much is missing after them.
 *
 * A month still in progress can never be OK, however complete the answer looks.
 * Marking it OK would be a lie the backfill could not take back: the resume rule
 * skips an OK chunk forever, so the hours that had not happened when it ran
 * would keep whatever the service said about them and never be replaced by the
 * real fixed lead values. The month is re-fetched on every run until it ends,
 * which costs one request and writes nothing once the values stop changing.
 */
export function judgeForecastCompleteness(
  hoursReturned: number,
  requested: IngestWindow,
  monthElapsed: boolean,
): 'OK' | 'PARTIAL' {
  if (!monthElapsed) return 'PARTIAL';
  return hoursReturned < expectedHourCount(requested) ? 'PARTIAL' : 'OK';
}
