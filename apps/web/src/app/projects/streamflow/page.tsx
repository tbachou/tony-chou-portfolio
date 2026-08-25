import type { Metadata } from 'next';
import { BackToProjects } from '@/components/BackToProjects';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';

const title = 'Streamflow — Project Case Study';
const description =
  'A live river forecasting pipeline for Big Darby Creek that scores every prediction it has ever made, in public. Bitemporal storage, two baselines to beat, and intervals drawn from measured error.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/streamflow' },
  openGraph: {
    title,
    description,
    url: '/projects/streamflow',
    siteName: 'Tony Chou — Interactive Portfolio',
    type: 'website',
    locale: 'en_US'
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description
  }
};

const CLOCKS = [
  {
    name: 'validTime — when it was true',
    role: 'The instant the river actually read that value at the gauge. This is the axis the chart moves along, and it belongs to the river rather than to us.'
  },
  {
    name: 'recordedAt — when we learned it',
    role: 'The instant this pipeline received it. USGS publishes provisional readings within minutes and revises them later, sometimes months later, so the same validTime can carry several values learned at different times. Nothing is ever updated in place; a revision is a new row.'
  }
];

const HONESTY = [
  'Every reconstruction of the past filters on recordedAt, not validTime. A forecast simulated at some past instant cannot see a reading the pipeline had not yet received, which is the only thing that makes a backtest mean anything.',
  'Each raw SQL query is paired with a plain TypeScript function stating the same rule, plus a script that proves the two agree against a real database. A query that returns plausible numbers is not evidence; two independent statements agreeing is.',
  'Prediction bounds are written once and never recomputed. Re-deriving them later from a bucket that has since grown would quietly rewrite history in the forecaster’s favour.',
  'A model that cannot honestly answer is skipped rather than filled in. Climatology genuinely has nothing to say during the first year of the record, and inventing a number there would put a claim on the scorecard that no forecaster ever made.',
  'Nothing is excluded for looking bad. The stretches where a forecaster loses are the reason the scorecard is worth reading at all.'
];

export default function StreamflowProjectPage() {
  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-4xl px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/projects/streamflow$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat status.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-accent">
            [ live — forecasting every six hours, scored hourly ]
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Streamflow
          </h1>
          <p className="mt-1 max-w-prose text-term-base text-term-body">
            A river forecasting pipeline that grades its own homework in public.
          </p>

          <div className="mt-6">
            <a
              href="/streamflow"
              className="terminal-select inline-flex min-h-[44px] items-center border border-term-accent px-4 py-2 text-term-base font-bold text-term-accent"
            >
              [ open the dashboard ]
            </a>
          </div>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-it-does.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
              Every six hours it predicts the flow of Big Darby Creek at Darbyville, Ohio, 24, 48
              and 72 hours ahead. Every hour it goes back and scores the predictions whose target
              time has passed, against whatever the gauge actually read. Both halves are public:
              the dashboard shows the current forecasts, how wrong each forecaster has been over
              time, and a chart you can rewind to watch a reading get revised. It is a small
              problem on purpose. One gauge, one river, no dam upstream, so the water you see is
              rain and groundwater finding its way downhill.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat two-clocks.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              The central engineering idea, and the reason the rest of it can be trusted. Every
              fact is stored with two timestamps rather than one:
            </p>
            <ol className="mt-4 space-y-4">
              {CLOCKS.map((clock, index) => (
                <li key={clock.name} className="flex gap-3 border-l border-term-border pl-4">
                  <span aria-hidden="true" className="text-term-muted tabular-nums">
                    {index + 1}.
                  </span>
                  <div>
                    <p className="text-term-sm font-bold text-term-ink">{clock.name}</p>
                    <p className="mt-1 text-term-sm leading-relaxed text-term-body">{clock.role}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              Keeping both is what makes it possible to ask what was knowable at a past moment,
              rather than what is known now. That question is the whole difference between a
              backtest and a story. The dashboard exposes it directly: drag the slider back and
              readings the pipeline had not yet received disappear, while a value revised after
              that moment reverts to whatever was first published.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat forecasters.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              Two baselines run today, and neither is a placeholder. They are the bar a real model
              has to clear before it has earned a place on the chart.
            </p>
            <ul className="mt-4 space-y-3">
              <li className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                <span aria-hidden="true" className="text-term-muted">
                  ›
                </span>
                <span>
                  <span className="font-bold text-term-ink">Persistence</span> says the river will
                  read what it reads now. That is the entire method, and it lands within about 12
                  percent at 24 hours on this gauge. Its error is simply how much the river
                  changed, so it is excellent on a flat day and hopeless on a rising limb, where
                  it cannot know rain is coming.
                </span>
              </li>
              <li className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                <span aria-hidden="true" className="text-term-muted">
                  ›
                </span>
                <span>
                  <span className="font-bold text-term-ink">Climatology</span> says the river will
                  do what it usually does this week of the year, averaged from earlier years only.
                  It ignores current conditions completely, which is why its error barely changes
                  between a 24 and a 72 hour horizon. That flatness is the point: it marks the
                  floor a forecast has to stand above.
                </span>
              </li>
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat intervals.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Every forecast carries a range, and the range is not a guess. It is the spread of
              that forecaster’s own past errors, at the same horizon, in the same river
              conditions. Conditions matter more than the horizon does: persistence is around 10
              percent wrong when the river is flat and around 30 percent wrong when it is rising,
              so a single pooled number would describe neither. Each forecast is filed under what
              the river was doing when it was made — baseflow, rising, or at a peak — and drawn
              from that bucket alone.
            </p>
            <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
              Which leaves a chicken and egg problem on day one, since a brand new pipeline has no
              past errors to measure. Rather than ship a wide invented band and quietly keep it
              forever, the whole record was replayed first: roughly 19,000 forecasts made and
              scored across two and a half years of archived readings, walking forward one slot at
              a time so each simulated forecast could only ever see what came before it. The first
              live forecast landed on measured error at every horizon and in every river state.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat honesty.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              A scorecard is only worth reading if it can lose. Most of the engineering here is
              spent making it hard to cheat by accident:
            </p>
            <ul className="mt-4 space-y-3">
              {HONESTY.map((item) => (
                <li key={item} className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                  <span aria-hidden="true" className="text-term-muted">
                    ›
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat why.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Tony is a strong TypeScript engineer with little background in time series work, so
              this was built to learn the concepts rather than to ship the shortest path: the
              build order follows ideas, and each decision is written down with its tradeoffs
              rather than only its outcome. It is also the one project here that is not an AI
              product. Forecasting a number from lagged flow is not a language problem, and the
              interesting parts, a store that can prove what it knew and a public record that is
              allowed to be unflattering, are the same parts that make any data system worth
              trusting.
            </p>
          </section>

          <section className="mt-10 border-t border-term-border pt-6">
            <div className="flex flex-wrap gap-3">
              <a
                href="/streamflow"
                className="terminal-select inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink"
              >
                [ open the dashboard ]
              </a>
              <a
                href="https://waterdata.usgs.gov/monitoring-location/03230500/"
                target="_blank"
                rel="noopener noreferrer"
                className="terminal-select inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink"
              >
                [ the gauge on usgs ↗ ]
              </a>
            </div>
            <p className="mt-3 max-w-prose text-term-xs text-term-muted">
              Readings come from the U.S. Geological Survey and are public domain. Provisional
              readings are subject to revision. This is an engineering demonstration, not a flood
              forecast, and nothing here should be used to make decisions about water.
            </p>
          </section>

          <div className="mt-10 border-t border-term-border pt-6">
            <BackToProjects />
          </div>
        </TerminalWindow>
      </main>
    </div>
  );
}
