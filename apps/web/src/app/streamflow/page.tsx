import {
  OBSERVATIONS_DEFAULT_WINDOW_DAYS,
  type ObservationsResponse,
} from '@portfolio/shared';
import {
  createPrismaClient,
  observationsAsOf,
  publicPredictions,
  publicScoredErrors,
  rollingSkill,
  DISPLAY_TIMEZONE,
  HORIZON_HOURS,
  SKILL_DEFAULT_WINDOW_DAYS,
  SKILL_WINDOW_DAYS,
} from '@portfolio/streamflow';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';

import { HydrographPanel } from './HydrographPanel';
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
  const prisma = createPrismaClient();

  const gauge = await prisma.gauge.findFirst({ where: { active: true } });
  if (!gauge) notFound();

  const now = new Date();
  const from = new Date(now.getTime() - OBSERVATIONS_DEFAULT_WINDOW_DAYS * DAY_MS);

  const skillFrom = new Date(now.getTime() - SKILL_DEFAULT_WINDOW_DAYS * DAY_MS);
  // Two days back is enough to hold the most recent six hourly slot even if a
  // scheduled run was skipped, without reading the whole prediction history to
  // show six rows.
  const forecastsFrom = new Date(now.getTime() - 2 * DAY_MS);

  const [
    rows,
    total,
    oldestRecord,
    newestReading,
    lastRun,
    recentForecasts,
    scoredErrors,
  ] = await Promise.all([
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
    prisma.pipelineRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { job: true, status: true, startedAt: true, rowsWritten: true },
    }),
    publicPredictions(prisma, { gaugeId: gauge.id, issuedFrom: forecastsFrom }),
    publicScoredErrors(prisma, gauge.id, skillFrom, now),
  ]);

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

      <header className="border-b border-term-border">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-0">
          <Link
            href="/"
            className="text-term-sm text-term-muted transition-colors duration-term-instant hover:text-term-ink"
          >
            <span aria-hidden="true">$ </span>
            cd ~/portfolio
          </Link>
        </div>
      </header>

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
          <p className="mt-3 max-w-2xl text-term-sm text-term-body">
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
              ['readings held', total.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-term-xs text-term-muted">{label}</dt>
                <dd className="mt-1 tabular-nums text-term-body">{value}</dd>
              </div>
            ))}
          </dl>

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

          {currentForecasts.length === 0 ? (
            <p className="mt-6 border border-term-border px-4 py-10 text-center text-term-sm text-term-muted">
              No forecast has been issued yet. The pipeline issues one per
              forecaster per horizon every six hours.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto">
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
                  {currentForecasts.map((forecast) => (
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
                        {!forecast.intervalSeeded && (
                          <span
                            className="ml-2 text-term-xs"
                            title="Wide placeholder range: not enough scored history in this regime yet"
                          >
                            *
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {currentForecasts.some((forecast) => !forecast.intervalSeeded) && (
            <p className="mt-4 max-w-2xl text-term-xs text-term-muted">
              <span aria-hidden="true">* </span>
              The range is a deliberately wide placeholder. A real range is the
              spread of that forecaster&rsquo;s own past errors in the same
              river conditions, and until enough of those exist the honest
              answer is a band too wide to be useful rather than a narrow one
              that is not earned.
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
            <SkillChart
              series={skill}
              horizons={[...HORIZON_HOURS]}
              windowDays={SKILL_WINDOW_DAYS}
              timeZone={gauge.timezone}
            />
          </div>
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

          {lastRun && (
            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 text-term-sm sm:grid-cols-4">
              {[
                ['last job', lastRun.job.toLowerCase().replace('_', ' ')],
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

          <p className="mt-6 border-t border-term-border pt-5 text-term-xs text-term-muted">
            Discharge data courtesy of the U.S. Geological Survey, National
            Water Information System. Readings are shown in{' '}
            {DISPLAY_TIMEZONE.replace('_', ' ')}; everything is stored in UTC.
          </p>
        </TerminalWindow>
      </main>
    </div>
  );
}
