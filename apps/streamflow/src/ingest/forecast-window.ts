import { INGEST_OVERLAP_HOURS } from '../config';
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
  return judgeWindowCompleteness(hoursReturned, requested);
}

/**
 * The plain completeness rule, with no month in it: PARTIAL when fewer non null
 * hours came back than the window implies, else OK.
 *
 * This is what the value sourcing table means by run status, and the live
 * ingest takes it directly. `judgeForecastCompleteness` is this rule plus one
 * extra refusal that belongs to the backfill alone: a calendar month still in
 * progress can never be OK, because the resume rule would then skip it forever.
 *
 * The live ingest has no such trap and must not inherit that refusal. Its
 * window always ends in the future by design, one lead ahead of now, so routing
 * it through the month rule would mark every live run PARTIAL for ever, and a
 * status that is always PARTIAL cannot report a real outage. Live runs are also
 * not chunks: `completedForecastChunks` skips anything that is not a whole
 * calendar month, so an OK live run resumes nothing.
 */
export function judgeWindowCompleteness(
  hoursReturned: number,
  requested: IngestWindow,
): 'OK' | 'PARTIAL' {
  return hoursReturned < expectedHourCount(requested) ? 'PARTIAL' : 'OK';
}

/**
 * Whether a window is exactly one whole calendar month.
 *
 * The backfill's resume key is the pair (`windowStart`, `leadHours`) read off
 * `PipelineRun` rows (AC-R5), and from 0010's task 11 the live ingest writes
 * rows of the same job with the same lead column. Its windows are not months,
 * so they must not be read as covered chunks, and the collision is reachable
 * rather than theoretical: a live window starts at the greatest stored
 * `validTime` less the overlap, and a run delayed to land that value on the
 * first of a month at 02:00 UTC produces a `windowStart` exactly equal to the
 * month start. That run recorded OK would tell a later backfill the whole month
 * was done.
 *
 * Checking both ends rather than the start alone, because the start is the half
 * that collides. Every backfill run records the whole month it stood for, never
 * the clamped request, so this recognises every chunk already in the store.
 */
export function isCalendarMonth(window: IngestWindow): boolean {
  const month = monthWindow(window.start);

  return (
    window.start.getTime() === month.start.getTime() &&
    window.end.getTime() === month.end.getTime()
  );
}

/**
 * The window the live ingest should request for one lead (AC-R13).
 *
 * **The start comes from the store, never from the schedule.** It is the
 * greatest `validTime` already held at this lead, pulled back by the same
 * overlap the observation ingest uses so a value the model revised just after
 * we first saw it gets compared again. Gap recovery falls out of that rather
 * than being a separate branch, exactly as it does in `computeIngestWindow`: a
 * job that has not run for two days asks for two days, because nothing here
 * consults the cron.
 *
 * **The end is one lead ahead of now, and that is the point of the whole job.**
 * A prediction issued now for a horizon of `H` hours needs every hour up to now
 * plus `H`, at lead `H` (AC-R7), or the window is short and the feature is null
 * (AC-R10). Those hours have not happened yet, and their nominal `issuedAt` is
 * `validTime` minus `leadHours`, so the last one this window reaches was issued
 * exactly now. That is the boundary and it is not an arbitrary one.
 *
 * **One hour further would be a leak, which is why the end is not merely a
 * generous guess.** An hour beyond now plus `H` has a nominal `issuedAt` in the
 * future, later than the `recordedAt` at which we would be writing it, which
 * inverts the two axes the store exists to keep straight. Worse than untidy:
 * Open-Meteo answers such an hour from the nearest available run rather than
 * with a null, so the row would carry a real lead shorter than the one it
 * claims, which is rain from the future wearing a forecast's clothes. Up to
 * this boundary the error runs the safe way, because the shortest lead the
 * service can serve for a target `H` hours out is `H` itself, so a live value
 * can be staler than its backtest counterpart but never fresher.
 *
 * The backfill clamps the other way, refusing every hour after now, and the two
 * rules do not disagree. A calendar month runs weeks past now, far beyond this
 * boundary at any lead, and the backfill has no reason to reach the live edge
 * because it is filling history.
 *
 * With nothing stored for this lead, the window starts at the live edge rather
 * than at `BACKFILL_START`. History belongs to the backfill, which chunks it by
 * month for the cost reason AC-R16 sets out; a live job falling back to the
 * archive's beginning would ask for two and a half years in one request, and
 * would ask again every six hours.
 */
export function liveForecastWindow(
  latestStoredValidTime: Date | null,
  leadHours: number,
  now: Date,
): IngestWindow {
  const end = new Date(now.getTime() + leadHours * HOUR_MS);

  const anchor = latestStoredValidTime ?? now;
  const start = new Date(anchor.getTime() - INGEST_OVERLAP_HOURS * HOUR_MS);

  // A stored validTime beyond even this window's end means clock skew or a lead
  // that has since changed, and an inverted window would make Open-Meteo reject
  // the request. Collapse it to an empty window at the end instead, so the run
  // records itself and moves on. Same choice `computeIngestWindow` makes.
  if (start.getTime() > end.getTime()) return { start: new Date(end), end };

  return { start, end };
}
