import {
  OBSERVATIONS_DEFAULT_WINDOW_DAYS,
  type ObservationsResponse,
} from '@portfolio/shared';
import {
  calibration,
  gradedIntervals,
  observationsAsOf,
  publicPredictions,
  publicScoredErrors,
  rollingSkill,
  isStale,
  isStaleForecast,
  DISPLAY_TIMEZONE,
  STALE_AFTER_HOURS,
  HORIZON_HOURS,
  SKILL_DEFAULT_WINDOW_DAYS,
  SKILL_WINDOW_DAYS,
} from '@portfolio/streamflow';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';

import { streamflowDb } from '@/lib/streamflow-db';

import { HydrographPanel } from './HydrographPanel';
import { CalibrationPanel } from './CalibrationPanel';
import { DataSources, NOT_A_FLOOD_FORECAST } from './DataSources';
import {
  ELAPSED_FORECASTS_NOTE,
  NOAA_WATER_URL,
  STALE_INGEST_NOTE,
  STALE_READING_REDIRECT,
  USGS_GAUGE_URL,
  staleForecastLegend,
  staleReadingNote,
} from './staleness-copy';
import { rangeSource } from './range-source';
import { SkillChart } from './SkillChart';

const title = 'Streamflow — a bitemporal forecast pipeline';
const description =
  'Live river flow at Big Darby Creek, stored so that what was true and what was known are two different questions. Rewind the record and watch a revision disappear.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/streamflow' },
  openGraph: {
    title,
    description,
    url: '/streamflow',
    siteName: 'Tony Chou — Interactive Portfolio',
    type: 'website',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title, description },
};

// The store changes under this page every six hours, and the whole point of
// the asOf control is that the answer depends on when you ask.
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the record begins. Coverage is asked over the whole of it rather than
 * the dashboard's 90 day skill window, because the question is whether the
 * ranges have ever held, and the live sample is small enough already.
 */
const BACKFILL_FROM = new Date('2024-01-01T00:00:00.000Z');

const TWO_CLOCKS = [
  {
    term: 'validTime',
    detail:
      'When the reading was true at the gauge. This is the horizontal axis of the chart, and it moves along the river’s own history.',
  },
  {
    term: 'recordedAt',
    detail:
      'When this pipeline learned it. USGS publishes no revision timestamp of its own, so the moment of ingest is the only honest answer, and the whole design rests on it.',
  },
  {
    term: 'the reason for both',
    detail:
      'A reading is published within minutes, marked provisional. Months later a hydrologist reviews it, and the number can change. With one timestamp that correction overwrites history and the record quietly becomes a thing that was never true at the time.',
  },
  {
    term: 'what it buys',
    detail:
      'A forecast can be scored against what was knowable when it was made, rather than against a tidied version of the past. Without that, a backtest flatters the model with numbers that did not exist yet.',
  },
];

/**
 * Unwraps one optional read, and says so when it failed.
 *
 * The whole point of settling rather than failing the page is that a panel
 * can go missing without taking the rest down. The cost is that a rejection
 * is otherwise swallowed: before this was `Promise.all`, any failure reached
 * the boundary, Next logged it and stamped a digest. Now only the required
 * read does, so every other reason gets logged here on the way past. A panel
 * that quietly serves a dash forever, with nothing in the logs, is the
 * failure mode this trade introduces.
 */
function settled<T>(label: string, result: PromiseSettledResult<T>, fallback: T): T {
  if (result.status === 'fulfilled') return result.value;
  console.error(`[streamflow] ${label} read failed:`, result.reason);
  return fallback;
}

/** Whether an optional read came back at all, for panels that must say so. */
function failed(result: PromiseSettledResult<unknown>): boolean {
  return result.status === 'rejected';
}

function formatInstant(at: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

function relativeAge(from: Date, to: Date): string {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function StreamflowPage() {
  const prisma = streamflowDb();

  const gauge = await prisma.gauge.findFirst({ where: { active: true } });
  if (!gauge) notFound();

  const now = new Date();
  const from = new Date(now.getTime() - OBSERVATIONS_DEFAULT_WINDOW_DAYS * DAY_MS);

  const skillFrom = new Date(now.getTime() - SKILL_DEFAULT_WINDOW_DAYS * DAY_MS);
  // Two days back is enough to hold the most recent six hourly slot even if a
  // scheduled run was skipped, without reading the whole prediction history to
  // show six rows.
  const forecastsFrom = new Date(now.getTime() - 2 * DAY_MS);

  // allSettled rather than all: one panel's query failing should cost that
  // panel and say so, not take the whole page down with it. The hydrograph
  // is the exception — it is what the page is — so its rejection is handed
  // straight to the error boundary.
  const [
    rowsResult,
    totalResult,
    oldestRecordResult,
    newestReadingResult,
    lastRunResult,
    recentForecastsResult,
    everIssuedResult,
    scoredErrorsResult,
    liveIntervalsResult,
    backtestIntervalsResult,
  ] = await Promise.allSettled([
    observationsAsOf(prisma, gauge.id, from, now, now),
    prisma.observation.count({ where: { gaugeId: gauge.id } }),
    prisma.observation.findFirst({
      where: { gaugeId: gauge.id },
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true },
    }),
    prisma.observation.findFirst({
      where: { gaugeId: gauge.id },
      orderBy: { validTime: 'desc' },
      select: { validTime: true, valueCfs: true, qualifier: true },
    }),
    // Ingest jobs only. Scoring runs hourly and ingestion every six hours, so
    // the newest run of any kind is usually a scoring pass, which would sit
    // under a paragraph describing how readings arrive and contradict it.
    prisma.pipelineRun.findFirst({
      where: { job: { in: ['USGS_INGEST', 'USGS_RESCAN'] } },
      orderBy: { startedAt: 'desc' },
      select: { job: true, status: true, startedAt: true, rowsWritten: true },
    }),
    publicPredictions(prisma, { gaugeId: gauge.id, issuedFrom: forecastsFrom }),
    // Unbounded by the two day window on purpose. Whether the pipeline has
    // EVER issued cannot be answered from the loaded rows: every slot writes
    // all three horizons, so "all loaded rows elapsed" is a shape the
    // scheduler cannot produce, which made the elapsed state unreachable and
    // sent a stopped pipeline to the never issued copy. AC-S9.
    prisma.prediction.findFirst({
      where: { gaugeId: gauge.id, hindcast: false },
      select: { id: true },
    }),
    publicScoredErrors(prisma, gauge.id, skillFrom, now),
    // Coverage over the whole record rather than the skill window: the
    // question is whether the ranges have ever meant what they claim, and
    // narrowing it to 90 days would throw away most of the only sample big
    // enough to answer. The two populations are read separately on purpose.
    gradedIntervals(prisma, gauge.id, BACKFILL_FROM, now, { hindcast: false }),
    gradedIntervals(prisma, gauge.id, BACKFILL_FROM, now, { hindcast: true }),
  ]);

  if (rowsResult.status === 'rejected') throw rowsResult.reason;

  const rows = rowsResult.value;
  // Null rather than zero: a count that could not be read is not a count of
  // none, and this one is printed as a fact about the store.
  const total = settled<number | null>('reading count', totalResult, null);
  const oldestRecord = settled('oldest record', oldestRecordResult, null);
  const newestReading = settled('newest reading', newestReadingResult, null);
  const lastRun = settled('last pipeline run', lastRunResult, null);
  const recentForecasts = settled('recent forecasts', recentForecastsResult, []);
  const scoredErrors = settled('scored errors', scoredErrorsResult, []);
  const liveCoverage = calibration(settled('live coverage', liveIntervalsResult, []));
  const backtestCoverage = calibration(
    settled('backtest coverage', backtestIntervalsResult, []),
  );
  const coverageFailed = failed(liveIntervalsResult) || failed(backtestIntervalsResult);

  // A read that failed and a store with nothing in it are opposite findings,
  // and a bare `{value && …}` renders them identically: the block vanishes and
  // the page reads as "this gauge has no data". These say which it was.
  const newestReadingFailed = failed(newestReadingResult);
  const lastRunFailed = failed(lastRunResult);

  // The newest claim per forecaster and horizon. publicPredictions returns
  // newest first, so the first of each pair seen is the current one.
  const current = new Map<string, (typeof recentForecasts)[number]>();
  for (const forecast of recentForecasts) {
    const at = `${forecast.modelVersion.name} ${forecast.horizonHours}`;
    if (!current.has(at)) current.set(at, forecast);
  }
  const currentForecasts = [...current.values()].sort(
    (a, b) =>
      a.horizonHours - b.horizonHours ||
      a.modelVersion.name.localeCompare(b.modelVersion.name),
  );

  // A forecast whose target has passed is not a forecast any more, it is a
  // result waiting to be scored, and the scoring surfaces already show those.
  // Leaving it here put a past instant under a present tense heading.
  // AC-S8.
  const liveForecasts = currentForecasts.filter(
    (forecast) => forecast.targetTime.getTime() > now.getTime(),
  );
  // Kept so the empty state can tell a stopped pipeline from a new one: rows
  // existed, they simply all elapsed. AC-S9.
  const hasEverIssued = settled<{ id: string } | null>(
    'ever issued probe',
    everIssuedResult,
    null,
  );

  // Computed over the SURVIVORS, not over `currentForecasts`. The order is
  // load bearing: with four stale and two elapsed, the survivors are four of
  // four and earn one note, while counting before the filter reads four of
  // six and would wrongly print a marker on every row. AC-S8a.
  const staleInputIds = new Set(
    liveForecasts
      .filter((forecast) =>
        isStaleForecast(rows, forecast.issuedAt, now, STALE_AFTER_HOURS),
      )
      .map((forecast) => forecast.id),
  );
  const everyForecastStaleInput =
    liveForecasts.length > 0 && staleInputIds.size === liveForecasts.length;

  // The reading's own age. Only evaluated when the read succeeded; a failed
  // read keeps its existing message and says nothing about staleness. AC-S11.
  const readingIsStale = newestReading
    ? isStale(newestReading.validTime, now, STALE_AFTER_HOURS)
    : false;
  // Not just `status !== 'OK'`. A scheduler that stops entirely writes no new
  // row, so the newest row stays an old success and the status keeps saying
  // the pipeline is healthy while nothing has run for weeks. AC-S4.
  const ingestNotCompleting = lastRun
    ? lastRun.status !== 'OK' ||
      isStale(lastRun.startedAt, now, STALE_AFTER_HOURS)
    : true;

  const skill = rollingSkill(scoredErrors, skillFrom, now).map((series) => ({
    modelName: series.modelName,
    horizonHours: series.horizonHours,
    points: series.points.map((point) => ({
      at: point.at.toISOString(),
      meanPctError: point.meanPctError,
      sampleSize: point.sampleSize,
    })),
  }));

  const initial: ObservationsResponse = {
    gauge: {
      usgsSiteId: gauge.usgsSiteId,
      name: gauge.name,
      lat: gauge.lat,
      lon: gauge.lon,
      timezone: gauge.timezone,
    },
    asOf: now.toISOString(),
    from: from.toISOString(),
    to: now.toISOString(),
    points: rows.map((row) => ({
      validTime: row.validTime.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      valueCfs: row.valueCfs,
      qualifier: row.qualifier,
    })),
  };

  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-4xl px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        <TerminalWindow path={`tonychou@portfolio:~/streamflow/${gauge.usgsSiteId}$`}>
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat gauge.txt
          </p>
          <h1 className="mt-4 text-term-xl font-bold text-term-ink terminal-glow">
            {gauge.name}
          </h1>
          {/* The same sentence the <meta> description carries, on the page
              this time: it is what makes the page worth reading, and it was
              legible only to a crawler. One string, so the two cannot
              drift apart. */}
          <p className="mt-4 max-w-2xl text-term-base text-term-ink">
            {description}
          </p>
          <p className="mt-4 max-w-2xl text-term-sm text-term-body">
            A National Scenic River in central Ohio, unregulated: no dam sets its
            flow, so the water you see is rain and groundwater finding its way
            downhill. This page reads a store that records not only what the
            river did, but when we found out.
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 text-term-sm sm:grid-cols-4">
            {[
              ['usgs site', gauge.usgsSiteId],
              ['latitude', gauge.lat.toFixed(4)],
              ['longitude', gauge.lon.toFixed(4)],
              ['readings held', total === null ? '—' : total.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-term-xs text-term-muted">{label}</dt>
                <dd className="mt-1 tabular-nums text-term-body">{value}</dd>
              </div>
            ))}
          </dl>

          {newestReadingFailed && (
            <div className="mt-6 border-t border-term-border pt-5">
              <p className="text-term-xs text-term-muted">latest reading</p>
              <p className="mt-2 text-term-sm text-term-body">
                The latest reading could not be read just now. The gauge and the ingest job are
                unaffected; this is the page failing to ask.
              </p>
            </div>
          )}

          {newestReading && (
            <div className="mt-6 border-t border-term-border pt-5">
              <p className="text-term-xs text-term-muted">latest reading</p>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-term-xl tabular-nums text-term-ink terminal-glow">
                  {Math.round(newestReading.valueCfs).toLocaleString()}
                </span>
                <span className="text-term-sm text-term-body">
                  cubic feet per second
                </span>
                <span className="text-term-xs text-term-muted">
                  {formatInstant(newestReading.validTime)} ·{' '}
                  {relativeAge(newestReading.validTime, now)} ·{' '}
                  {newestReading.qualifier.toLowerCase()}
                </span>
              </p>
              {readingIsStale && (
                <p className="mt-3 max-w-2xl border-l border-term-error pl-3 text-term-sm text-term-body">
                  {staleReadingNote(relativeAge(newestReading.validTime, now))}
                  {ingestNotCompleting ? ` ${STALE_INGEST_NOTE}` : ''}{' '}
                  {STALE_READING_REDIRECT.lead}{' '}
                  <a
                    href={USGS_GAUGE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="terminal-select text-term-ink"
                  >
                    {STALE_READING_REDIRECT.usgs}{' '}
                    <span aria-hidden="true">↗</span>
                  </a>
                  {STALE_READING_REDIRECT.mid}{' '}
                  <a
                    href={NOAA_WATER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="terminal-select text-term-ink"
                  >
                    {STALE_READING_REDIRECT.noaa}{' '}
                    <span aria-hidden="true">↗</span>
                  </a>
                  .
                </p>
              )}
              <p className="mt-3 max-w-2xl border-l border-term-border pl-3 text-term-sm text-term-muted">
                {NOT_A_FLOOD_FORECAST}
              </p>
            </div>
          )}
        </TerminalWindow>

        <TerminalWindow
          path="tonychou@portfolio:~/streamflow/hydrograph$"
          className="mt-8"
        >
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            plot --days {OBSERVATIONS_DEFAULT_WINDOW_DAYS} --as-of
          </p>
          <h2 className="mt-4 text-term-lg font-bold text-term-ink">
            The last {OBSERVATIONS_DEFAULT_WINDOW_DAYS} days
          </h2>
          {/* The two clocks are defined in full further down the page, which
              is long after the control that turns one of them. This is the
              one line version, where the interaction is. */}
          <p className="mt-3 max-w-2xl text-term-sm text-term-body">
            Discharge at the gauge, one point per reading, on a logarithmic
            axis: this creek runs from about 11 to 13,200 cubic feet per
            second, and a linear one would flatten every ordinary day onto
            the floor. Two clocks are in play.{' '}
            <span className="text-term-ink">validTime</span>, when the reading
            was true at the gauge, runs along the bottom.{' '}
            <span className="text-term-ink">recordedAt</span>, when this
            pipeline learned it, is what the control underneath rewinds.
          </p>

          <div className="mt-6">
            <HydrographPanel
              initial={initial}
              earliestRecordedAt={(
                oldestRecord?.recordedAt ?? from
              ).toISOString()}
            />
          </div>
        </TerminalWindow>

        <TerminalWindow
          path="tonychou@portfolio:~/streamflow/forecast$"
          className="mt-8"
        >
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            forecast --all-horizons
          </p>
          <h2 className="mt-4 text-term-lg font-bold text-term-ink">
            What each forecaster expects
          </h2>
          <p className="mt-3 max-w-2xl text-term-sm text-term-body">
            Neither of these is a model. Persistence says the river will read
            what it reads now; climatology says it will do what it usually does
            this week of the year. They are here because a forecast is only
            worth what it beats, and both are harder to beat than they sound.
          </p>

          {everyForecastStaleInput && (
            <p className="mt-6 max-w-2xl border-l border-term-error pl-3 text-term-sm text-term-body">
              {staleForecastLegend(STALE_AFTER_HOURS)}
            </p>
          )}

          {liveForecasts.length === 0 ? (
            <p className="mt-6 border border-term-border px-4 py-10 text-center text-term-sm text-term-muted">
              {recentForecastsResult.status === 'rejected'
                ? 'The forecast table could not be read just now. Nothing else on this page depends on it, so the rest is still current.'
                : hasEverIssued
                  ? ELAPSED_FORECASTS_NOTE
                  : 'No forecast has been issued yet. The pipeline issues one per forecaster per horizon every six hours.'}
            </p>
          ) : (
            /* A scroll container a keyboard can reach and a screen reader
               can name (WCAG 2.1.1), carrying the shared shadow that says
               it scrolls. */
            <div
              role="region"
              tabIndex={0}
              aria-label="Current forecasts, scrolls sideways on narrow screens"
              className="terminal-scrollable mt-6 overflow-x-auto"
            >
              <table className="w-full min-w-[34rem] border-collapse text-term-sm">
                <caption className="sr-only">
                  The most recent forecast from each baseline at each horizon
                </caption>
                <thead>
                  <tr className="border-b border-term-border text-left text-term-xs text-term-muted">
                    <th scope="col" className="py-2 pr-4 font-normal">
                      forecaster
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      horizon
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      for
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      cfs
                    </th>
                    <th scope="col" className="py-2 text-right font-normal">
                      range
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {liveForecasts.map((forecast) => (
                    <tr
                      key={forecast.id}
                      className="border-b border-term-border/50"
                    >
                      <td className="py-2 pr-4 text-term-body">
                        {forecast.modelVersion.name}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-term-body">
                        {forecast.horizonHours} h
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-term-muted">
                        {formatInstant(forecast.targetTime)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-term-ink">
                        {Math.round(forecast.centralCfs).toLocaleString()}
                      </td>
                      <td className="py-2 text-right tabular-nums text-term-muted">
                        {Math.round(forecast.lowerCfs).toLocaleString()} to{' '}
                        {Math.round(forecast.upperCfs).toLocaleString()}
                        {rangeSource(forecast) === 'pooled' && (
                          <span
                            className="ml-2 text-term-xs"
                            title="Measured, but pooled across every river condition rather than conditioned on this one"
                          >
                            *
                          </span>
                        )}
                        {rangeSource(forecast) === 'placeholder' && (
                          <span
                            className="ml-2 text-term-xs"
                            title="A deliberately wide placeholder: not enough scored history yet"
                          >
                            &dagger;
                          </span>
                        )}
                        {!everyForecastStaleInput &&
                          staleInputIds.has(forecast.id) && (
                            <span
                              className="ml-2 text-term-xs"
                              title="Issued from a river reading older than the freshness threshold"
                            >
                              &Dagger;
                            </span>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {liveForecasts.length > 0 && (
            <p className="mt-4 max-w-2xl border-l border-term-border pl-3 text-term-sm text-term-muted">
              {NOT_A_FLOOD_FORECAST}
            </p>
          )}

          {!everyForecastStaleInput && staleInputIds.size > 0 && (
            <p className="mt-4 max-w-2xl text-term-sm text-term-body">
              <span aria-hidden="true">&Dagger; </span>
              {staleForecastLegend(STALE_AFTER_HOURS)}
            </p>
          )}

          {liveForecasts.some(
            (forecast) => rangeSource(forecast) === 'pooled',
          ) && (
            <p className="mt-4 max-w-2xl text-term-xs text-term-muted">
              <span aria-hidden="true">* </span>
              Drawn from this forecaster&rsquo;s own past errors, but pooled
              across every river condition rather than conditioned on the one
              it was issued into. A rising storm and a flat week get the same
              width that way, so read it as a real range that is not yet tuned
              to today.
            </p>
          )}

          {liveForecasts.some(
            (forecast) => rangeSource(forecast) === 'placeholder',
          ) && (
            <p className="mt-4 max-w-2xl text-term-xs text-term-muted">
              <span aria-hidden="true">&dagger; </span>
              The range is a deliberately wide placeholder. A real range is the
              spread of that forecaster&rsquo;s own past errors in the same
              river conditions, and until enough of those exist the honest
              answer is a band too wide to be useful rather than a narrow one
              that is not earned.
            </p>
          )}

          {/*
            Permanent, not a while-seeding notice: the past errors a range is
            drawn from stay dominated by the backtest for as long as the
            sample keeps every error it has ever seen, so the caveat holds for
            as long as the ranges do. Held back only when there is no forecast
            on screen, since it explains ranges and there are none to explain.
          */}
          {liveForecasts.length > 0 && (
            <p className="mt-4 max-w-2xl text-term-xs text-term-muted">
              Ranges were seeded by a backtest before this pipeline issued
              anything live: every forecaster was replayed across the archived
              record and scored, and those errors are what the ranges are drawn
              from. The archive holds readings USGS had already reviewed, while a
              live forecast only ever sees provisional ones, so a seeded range
              is probably slightly narrower than live performance deserves.
            </p>
          )}
        </TerminalWindow>

        <TerminalWindow
          path="tonychou@portfolio:~/streamflow/skill$"
          className="mt-8"
        >
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            skill --window {SKILL_DEFAULT_WINDOW_DAYS}d
          </p>
          <h2 className="mt-4 text-term-lg font-bold text-term-ink">
            How wrong they have been
          </h2>
          <p className="mt-3 max-w-2xl text-term-sm text-term-body">
            Every prediction is scored once its target time passes, against
            whichever revision of the reading is current. Nothing is excluded
            for looking bad: the stretches where a forecaster loses are the
            reason this chart is here at all.
          </p>

          <div className="mt-6">
            {scoredErrorsResult.status === 'rejected' ? (
              <p className="border border-term-border px-4 py-10 text-center text-term-sm text-term-muted">
                The scoring record could not be read just now. Nothing was
                lost: scores are written by the pipeline, not by this page.
              </p>
            ) : (
              <SkillChart
                series={skill}
                horizons={[...HORIZON_HOURS]}
                windowDays={SKILL_WINDOW_DAYS}
                timeZone={gauge.timezone}
              />
            )}
          </div>
        </TerminalWindow>

        <TerminalWindow
          path="tonychou@portfolio:~/streamflow/calibration$"
          className="mt-8"
        >
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            coverage --nominal 0.80
          </p>
          <h2 className="mt-4 text-term-lg font-bold text-term-ink">
            Whether the ranges mean what they say
          </h2>
          <p className="mt-3 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
            Every forecast above publishes a range and claims the truth will land inside it about
            four times in five. The chart before this one says how far off the middle guess was,
            which is a different question: a forecaster can be respectable there and still be
            publishing ranges that are wrong. This is the check on that claim.
          </p>

          {coverageFailed ? (
            <p className="mt-6 text-term-sm text-term-body">
              Coverage could not be read just now. The grades themselves are unaffected; this is
              the page failing to ask.
            </p>
          ) : (
            <CalibrationPanel live={liveCoverage} backtest={backtestCoverage} />
          )}
        </TerminalWindow>

        <TerminalWindow
          path="tonychou@portfolio:~/streamflow/two-clocks$"
          className="mt-8"
        >
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat two-clocks.txt
          </p>
          <h2 className="mt-4 text-term-lg font-bold text-term-ink">
            Why every reading carries two timestamps
          </h2>
          <dl className="mt-6 space-y-5">
            {TWO_CLOCKS.map((item) => (
              <div key={item.term} className="border-l border-term-border pl-4">
                <dt className="text-term-sm text-term-ink">{item.term}</dt>
                <dd className="mt-1 max-w-2xl text-term-sm text-term-muted">
                  {item.detail}
                </dd>
              </div>
            ))}
          </dl>
        </TerminalWindow>

        <TerminalWindow
          path="tonychou@portfolio:~/streamflow/pipeline$"
          className="mt-8"
        >
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            tail -n 1 runs.log
          </p>
          <h2 className="mt-4 text-term-lg font-bold text-term-ink">
            How the store stays current
          </h2>
          <p className="mt-3 max-w-2xl text-term-sm text-term-body">
            A scheduled job pulls new readings every six hours, then re-polls
            everything still marked provisional however old it is. Nothing is
            ever updated in place: a corrected reading arrives as a new row with
            a later <span className="text-term-ink">recordedAt</span>, which is
            what makes the control above possible at all.
          </p>

          {lastRunFailed && (
            <p className="mt-6 text-term-sm text-term-body">
              The run history could not be read just now, so the job below is not shown. The
              schedule itself is unaffected.
            </p>
          )}

          {lastRun && (
            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 text-term-sm sm:grid-cols-4">
              {[
                ['last job', lastRun.job.toLowerCase().replaceAll('_', ' ')],
                ['outcome', lastRun.status.toLowerCase()],
                ['rows written', lastRun.rowsWritten.toLocaleString()],
                ['ran', relativeAge(lastRun.startedAt, now)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-term-xs text-term-muted">{label}</dt>
                  <dd className="mt-1 tabular-nums text-term-body">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <DataSources timeZone={DISPLAY_TIMEZONE.replaceAll('_', ' ')} />
        </TerminalWindow>
      </main>
    </div>
  );
}
