import type { Metadata } from 'next';
import { BackToProjects } from '@/components/BackToProjects';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';
import { Calc, CalcLead } from './Calc';
import { IntervalLadderDiagram, JobsDiagram, TwoTimestampsDiagram } from './Diagrams';

/**
 * The long form walkthrough, one level below the case study.
 *
 * The case study says what Streamflow is; this says how it works, for a
 * reader with no background in either hydrology or forecasting. Every
 * calculation the pipeline performs appears here with its meaning in plain
 * words, which is the promise the `Calc` component exists to keep.
 *
 * Every figure quoted was measured against the live store on 2026-08-29 and
 * is stated as a measurement rather than as a standing fact, because the
 * record grows every six hours. Nothing here reads from the database at
 * request time on purpose: a walkthrough that changed under the reader would
 * make its own explanations wrong.
 */

const title = 'Inside Streamflow — How the Pipeline Works';
const description =
  'A plain language walkthrough of the Streamflow forecasting pipeline: bitemporal storage, two baselines, prediction intervals drawn from measured error, and what every calculation in it means.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/streamflow/walkthrough' },
  openGraph: {
    title,
    description,
    url: '/projects/streamflow/walkthrough',
    siteName: 'Tony Chou — Interactive Portfolio',
    type: 'article',
    locale: 'en_US'
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description
  }
};

const VOCABULARY = [
  {
    term: 'discharge, measured in cfs',
    body: 'How much water passes a point in the river each second. cfs stands for cubic feet per second — picture a cube of water one foot on each side going past you every second. At this gauge the typical reading is 221 cfs; the record holds values from 11.1 during a dry spell to 13,200 at a flood peak. This single number is what the whole system predicts.'
  },
  {
    term: 'gauge',
    body: 'A permanent measuring station on the riverbank. This one is USGS site 03230500, Big Darby Creek at Darbyville, Ohio. It reports every 15 minutes, which is 96 readings a day.'
  },
  {
    term: 'USGS',
    body: 'The United States Geological Survey, the federal agency that operates the gauge and publishes its readings freely. The only upstream source of river data here.'
  },
  {
    term: 'provisional and approved',
    body: 'The two states a reading can be in. Provisional means USGS published it automatically within minutes and has not checked it. Approved means a hydrologist has since reviewed it, and possibly changed the number. That single fact is why this system is designed the way it is.'
  },
  {
    term: 'horizon',
    body: 'How far ahead a forecast reaches. Three are issued at once: 24, 48 and 72 hours. They are kept apart everywhere, because predicting tomorrow and predicting three days out are different problems with different error sizes.'
  },
  {
    term: 'baseline',
    body: 'A deliberately simple forecaster that anything more complicated must beat before it can claim to work. Two run here. A model that cannot beat a baseline has not earned its complexity.'
  }
];

const TABLES = [
  {
    name: 'Observation',
    holds: 'One river reading, as known at one moment. Only ever added to.',
    unique: 'gauge + validTime + recordedAt'
  },
  {
    name: 'Prediction',
    holds: 'One forecast: its central guess, its range, and where that range came from.',
    unique: 'gauge + model + issuedAt + targetTime'
  },
  {
    name: 'Score',
    holds: 'How one forecast did, against one specific version of the truth.',
    unique: 'forecast + which revision was used'
  },
  {
    name: 'ModelVersion',
    holds: 'One forecaster. A baseline is a row here exactly like a trained model is.',
    unique: 'name'
  },
  {
    name: 'Gauge',
    holds: 'The site, its timezone, and its frozen low flow floor.',
    unique: 'USGS site id'
  },
  {
    name: 'PipelineRun',
    holds: 'Every job execution, including the ones that failed.',
    unique: '—'
  },
  {
    name: 'WeatherForecast',
    holds: 'Rain. Designed, not yet built.',
    unique: '—'
  }
];

const REGIME_INPUTS = [
  {
    symbol: 'v',
    what: 'The river’s value right now, in cfs.',
    why: 'What is being classified.'
  },
  {
    symbol: 'm',
    what: 'The median of every reading in the previous 7 days.',
    why: 'A stand-in for “normal lately”. Median rather than mean, because a single flood spike drags an average upward but barely moves a median.'
  },
  {
    symbol: 'd',
    what: 'The change over the previous 12 hours: now minus then.',
    why: 'Direction and speed. Positive is rising, negative is falling.'
  },
  {
    symbol: 'f',
    what: 'The frozen low flow floor, 18.9 cfs.',
    why: 'The same floor grading uses, to stop thresholds vanishing at very low water.'
  }
];

const STAGES = [
  {
    n: '01',
    name: 'Two time axes',
    tag: 'shipped',
    body: 'The store, ingestion, the as-of rebuild, and the hydrograph with its rewind slider. Proves you can reconstruct what was knowable at any past instant.'
  },
  {
    n: '02',
    name: 'A forecaster with no model',
    tag: 'shipped',
    body: 'Two baselines, three horizons, hourly grading, earned prediction ranges, and the public scorecard. This is what is running today, and it is deliberately free of machine learning: a baseline is a competitor to beat, not a footnote.'
  },
  {
    n: '03',
    name: 'Honesty surfaces',
    tag: 'next',
    body: 'The calibration view: does an 80 percent range actually contain the truth 80 percent of the time, broken down by horizon and river state? Every field it needs is already being recorded, so this is a read and a chart rather than new machinery.'
  },
  {
    n: '04',
    name: 'Rain arrives',
    tag: 'planned',
    body: 'Past weather forecasts, stored with the lead time each was issued at. The subtlety this stage teaches: a model must be trained on past forecasts, not on the rain that actually fell, or it learns from information it will not have when it runs for real.'
  },
  {
    n: '05',
    name: 'The first real model',
    tag: 'planned',
    body: 'Gradient boosted trees over recent flow and lead matched rain, producing their range directly from three quantile models. It registers as an ordinary forecaster and competes in the same tables as the baselines. It may not beat persistence at 24 hours; the design makes that visible rather than hideable.'
  },
  {
    n: '06',
    name: 'Keeping it alive',
    tag: 'planned',
    body: 'Scheduled retraining that writes a new model version and retires the one it supersedes, with every job’s run history surfaced so a silent failure becomes visible. A pipeline is a thing that runs, not a thing that ran.'
  }
];

const GLOSSARY = [
  ['absolute value', 'A number with its minus sign dropped. Written with bars: |−40| = 40.'],
  [
    'append only',
    'A table that is only ever added to. Nothing is edited or deleted; change is expressed by writing another row.'
  ],
  [
    'backtest',
    'Testing a forecasting method against history to see how it would have done. Honest only if the method is denied information from after each moment it forecasts.'
  ],
  ['baseline', 'A deliberately simple forecaster that a real model must beat to justify itself.'],
  [
    'bitemporal',
    'A store keeping two timelines: when each fact was true, and when it was learned.'
  ],
  [
    'bucket',
    'Here, a group of past errors sharing a forecaster, a horizon and a river state, used to set a range.'
  ],
  [
    'calibration',
    'Whether a stated confidence matches reality: does an 80 percent range contain the truth 80 percent of the time?'
  ],
  ['cfs', 'Cubic feet per second. The volume of water passing a point each second.'],
  [
    'cron',
    'A schedule for running a program at fixed times, named after the original Unix scheduling program.'
  ],
  ['discharge', 'The hydrology term for river flow, measured here in cfs.'],
  [
    'gradient boosted trees',
    'A machine learning method combining many small decision trees, each correcting its predecessors’ errors. Standard for tabular data; not a neural network.'
  ],
  [
    'hindcast',
    'Replaying history as though the system had been running through it, to build a track record it would otherwise lack.'
  ],
  ['horizon', 'How far ahead a forecast reaches: 24, 48 or 72 hours here.'],
  ['hydrograph', 'A chart of river flow over time.'],
  ['idempotent', 'Safe to run more than once; running it twice changes nothing the second time.'],
  [
    'leakage',
    'Accidentally training or testing a model with information it could not have had at the time. Makes a worthless model look excellent.'
  ],
  ['max(a, b)', 'Whichever of the two values is larger.'],
  ['mean', 'The ordinary average: add the values, divide by how many there are.'],
  [
    'median',
    'The middle value of a sorted list. Unlike the mean, a single extreme value barely moves it.'
  ],
  [
    'percentile',
    'A position in a sorted sample. The 10th percentile is the value 10 percent of the sample falls below.'
  ],
  ['persistence', 'The forecast that nothing will change. Deceptively hard to beat on rivers.'],
  [
    'prediction interval',
    'A published low and high bound with a stated confidence, here 80 percent.'
  ],
  [
    'provisional / approved',
    'A USGS reading published automatically, versus one reviewed by a hydrologist and possibly corrected.'
  ],
  [
    'quantile',
    'The general form of percentile, expressed as a fraction: the 0.9 quantile is the 90th percentile.'
  ],
  [
    'ratio (actual ÷ predicted)',
    'An error as a multiplier. 1.0 is perfect; below 1.0 means the forecast was too high.'
  ],
  [
    'recession',
    'A river draining down after a storm. Slow, smooth, and systematically over-forecast by persistence.'
  ],
  ['regime', 'What the river was doing at a moment: rising, falling, at a peak, or at baseflow.'],
  [
    'rolling mean',
    'An average over a moving window — here the previous seven days, recomputed each day.'
  ],
  ['schema', 'The definition of a database’s tables and columns.'],
  ['SQL', 'Structured Query Language, used to ask a relational database for data.'],
  [
    'unique constraint',
    'A database rule saying a given combination of columns may not repeat.'
  ],
  [
    'USGS',
    'United States Geological Survey, the agency operating the gauge and publishing its readings.'
  ],
  [
    'UTC',
    'Coordinated Universal Time, the global reference clock. Everything here is stored in it and displayed in Ohio time.'
  ]
] as const;

const REFERENCES = [
  {
    href: 'https://waterdata.usgs.gov/monitoring-location/03230500/',
    name: 'USGS 03230500 · Big Darby Creek at Darbyville, Ohio',
    what: 'The gauge itself. Every river reading in this system comes from here.'
  },
  {
    href: 'https://waterservices.usgs.gov/docs/instantaneous-values/instantaneous-values-details/',
    name: 'USGS Instantaneous Values web service',
    what: 'The open, keyless service the ingest job requests readings from, and the source of the qualifier codes that become provisional or approved.'
  },
  {
    href: 'https://waterdata.usgs.gov/provisional-data-statement/',
    name: 'USGS provisional data statement',
    what: 'USGS’s own statement that unreviewed data may be revised. The premise the whole two timestamp design rests on.'
  },
  {
    href: 'https://martinfowler.com/articles/bitemporal-history.html',
    name: 'Bitemporal History — Martin Fowler',
    what: 'A clear introduction to storing both when a fact was true and when it was recorded.'
  },
  {
    href: 'https://www.postgresql.org/docs/current/sql-select.html#SQL-DISTINCT',
    name: 'PostgreSQL: DISTINCT ON',
    what: 'The database feature the as-of rebuild is built from.'
  },
  {
    href: 'https://robjhyndman.com/publications/quantiles/',
    name: 'Hyndman & Fan (1996), Sample Quantiles in Statistical Packages',
    what: 'The paper cataloguing the nine competing definitions of a percentile, and why pinning one matters on small samples.'
  },
  {
    href: 'https://scikit-learn.org/stable/modules/ensemble.html#gradient-boosting',
    name: 'scikit-learn: Gradient Boosting',
    what: 'The method planned for the first real model, including the quantile loss used to produce a range directly.'
  },
  {
    href: 'https://open-meteo.com/en/docs/historical-forecast-api',
    name: 'Open-Meteo Historical Forecast API',
    what: 'The archive of past weather forecasts the rain stage will train on. Free for non-commercial use, CC BY 4.0.'
  }
];

function SectionHeading({ file }: { file: string }) {
  return (
    <h2 className="text-term-sm text-term-muted">
      <span aria-hidden="true">$ </span>
      {file}
    </h2>
  );
}

export default function StreamflowWalkthroughPage() {
  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        {/* ---------- intro + vocabulary ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/projects/streamflow/walkthrough$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat README.md
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Inside Streamflow
          </h1>
          <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
            A river forecasting pipeline that predicts water flow on Big Darby Creek 24, 48 and 72
            hours ahead, then publicly grades every prediction it has ever made. This is a walk
            through how it works, written for someone who has never seen it: what each part does,
            how a river reading becomes a forecast, and what every number in the system actually
            means.
          </p>

          {/* Every text block on this page shares one right edge, the 65
              character measure the prose is set to. A rule that ran wider
              than the paragraph above it would make the measure look like an
              accident. Tables and diagrams are the deliberate exception. */}
          {/* The text size lives on the rows, not on the list. `max-w-prose`
              is 65ch, and `ch` scales with the element's own font, so putting
              a smaller size here too would resolve the cap to a narrower
              column than the prose above and the rules would stop short of
              the measure they are meant to share. */}
          <dl className="mt-6 grid w-full max-w-prose gap-x-8 gap-y-2 border-y border-term-border py-4 sm:grid-cols-2">
            {[
              ['gauge', 'USGS 03230500'],
              ['readings held', '86,945'],
              ['forecasts graded', '17,615'],
              ['figures measured', '2026-08-29']
            ].map(([key, value]) => (
              <div key={key} className="flex gap-2 text-term-xs">
                <dt className="text-term-muted">{key}</dt>
                <dd className="text-term-body tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <section className="mt-10">
            <SectionHeading file="cat vocabulary.txt" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-muted">
              This project sits where hydrology meets forecasting, and both fields bring their own
              vocabulary. These six carry most of the weight.
            </p>
            <dl className="mt-4 max-w-prose space-y-4">
              {VOCABULARY.map((entry) => (
                <div key={entry.term} className="border-l border-term-border pl-4">
                  <dt className="text-term-sm font-bold text-term-ink">{entry.term}</dt>
                  <dd className="mt-1 max-w-prose text-term-sm leading-relaxed text-term-body">
                    {entry.body}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </TerminalWindow>

        {/* ---------- the central idea ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/two-timestamps$">
          <SectionHeading file="cat why-two-timestamps.txt" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            USGS publishes a reading within minutes of taking it, marked provisional. Months later
            a hydrologist reviews it, and the number can change. If you store one timestamp per
            reading, that correction overwrites history, and your record quietly becomes something
            that was never true at the time.
          </p>
          <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
            So every reading here carries two timestamps.{' '}
            <span className="font-bold text-term-ink">validTime</span> is when it was true at the
            river. <span className="font-bold text-term-ink">recordedAt</span> is when this
            pipeline learned it. Nothing is ever updated in place: a revision arrives as a new row
            with a later recordedAt, and the old row stays exactly where it was. A store built this
            way is called bitemporal — two time axes, one for when things happened and one for when
            you found out.
          </p>
          <p className="mt-3 max-w-prose border-l-2 border-term-accent pl-4 text-term-sm leading-relaxed text-term-body">
            This is what lets the system grade itself honestly. You can ask what was knowable at any
            past instant and get a truthful answer, rather than one flattered by numbers that did
            not exist yet.
          </p>

          <TwoTimestampsDiagram />
        </TerminalWindow>

        {/* ---------- architecture + schema ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/architecture$">
          <SectionHeading file="ls jobs/" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            The pipeline has no web server at all. It is four programs that run top to bottom and
            exit, started on a schedule — traditionally called cron jobs, after the old Unix program
            that ran things at fixed times. The public website is separate, and reads the same
            database.
          </p>

          <JobsDiagram />

          <section className="mt-10">
            <SectionHeading file="cat schema" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Seven tables, and the interesting part of each is its unique constraint — a rule the
              database itself enforces, naming the combination of columns that may not repeat. Those
              rules are what make revision expressible without ever editing a row.
            </p>

            <div className="mt-4 overflow-x-auto border border-term-border">
              <table className="w-full border-collapse text-term-sm">
                <thead>
                  <tr className="border-b border-term-border">
                    <th className="px-3 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
                      Table
                    </th>
                    <th className="px-3 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
                      What it holds
                    </th>
                    <th className="px-3 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
                      What may not repeat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TABLES.map((row) => (
                    <tr key={row.name} className="border-b border-term-border last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 align-top font-bold text-term-ink">
                        {row.name}
                      </td>
                      <td className="px-3 py-2 align-top leading-relaxed text-term-body">
                        {row.holds}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-term-muted">
                        {row.unique}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              <span className="font-bold text-term-ink">The grade table’s rule is the one worth
              pausing on.</span>{' '}
              It says a forecast may not be graded twice against the same version of the truth — but
              it may be graded again against a newer one. So when USGS revises a reading you already
              graded against, the old grade is not corrected; a second grade is written. Every grade
              can therefore say which version of reality it was judged against.
            </p>
            <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
              The river’s state is likewise stored twice, meaning two different things. On the
              forecast it is what the river was doing when the forecast was made, which is all a
              forecaster can see. On the grade it is what the river was doing when the forecast came
              true, which is what decides whether it was any good. Ranges are chosen using the
              first, reporting is grouped by the second, and the gap between them is the forecasting
              problem itself.
            </p>
          </section>
        </TerminalWindow>

        {/* ---------- ingest + as-of ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/pipeline$">
          <SectionHeading file="run ingest" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            Pulling new readings in, without ever overwriting an old one.
          </p>

          <Calc
            label="the request window"
            formula={'start = (newest reading already stored) − 2 hours\nend   = now'}
          >
            <p>
              <CalcLead>in plain words</CalcLead>
              Ask USGS for everything from slightly before the newest reading we hold, up to this
              moment.
            </p>
            <p>
              The two hour overlap deliberately re-requests data we already have. That is the window
              in which USGS most often changes its mind, and re-asking is how we would notice.
            </p>
            <p>
              Anchoring to the newest reading we hold rather than to the clock is what makes missed
              runs harmless. If the job does not run for thirty hours, the next window is
              automatically thirty hours wide. There is no separate recovery code to get wrong.
            </p>
          </Calc>

          <Calc
            label="write a row only if"
            formula={'incoming value  ≠ stored value\n   OR incoming status ≠ stored status'}
          >
            <p>
              <CalcLead>in plain words</CalcLead>
              Save this reading only if the number changed, or its provisional/approved status
              changed.
            </p>
            <p>
              The second half is easy to leave out and would quietly defeat the project. When a
              hydrologist reviews a reading and confirms the number was right, the value is
              identical and only the status moves. Comparing values alone would silently discard
              exactly the event this store exists to capture.
            </p>
            <p>
              A useful consequence: running the job twice over the same window writes nothing the
              second time. A job safe to re-run like that is called idempotent.
            </p>
          </Calc>

          <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
            Ingest only looks at the recent edge of the record, so it is structurally blind to a two
            year old reading being approved today. That is what the second job, rescan, is for. It
            re-checks a rolling 90 day window plus every reading anywhere in the record still marked
            provisional, at any age, grouping those scattered readings into merged spans so a single
            stranded reading from 2024 does not force every run to re-request everything since.
          </p>

          <section className="mt-10">
            <SectionHeading file="cat as-of-rebuild" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              The mechanism the whole project rests on is one database query.
            </p>

            <Calc
              label="the as-of query"
              formula={
                'SELECT DISTINCT ON (gauge, validTime) *\n  FROM readings\n WHERE recordedAt <= $cutoff\n ORDER BY validTime, recordedAt DESC'
              }
            >
              <p>
                <CalcLead>in plain words</CalcLead>
                For every moment in the river’s history, keep exactly one reading: the most recently
                learned version that we already knew about by the cutoff.
              </p>
              <p>
                DISTINCT ON is a PostgreSQL feature meaning “give me one row per group.” The group
                here is one river moment. The sort decides which row survives: newest learned first,
                so the one kept is the freshest version available at the cutoff.
              </p>
              <p>
                The WHERE line is the honesty clause. Corrections learned after the cutoff are still
                sitting in the table, but they are invisible to this query. Move the cutoff and the
                same river moment can honestly return a different number.
              </p>
            </Calc>

            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The same rule exists a second time in plain TypeScript, so tests can prove the two
              agree, and a third time as a forward only walk that answers the question thousands of
              times efficiently — which is what makes the historical replay finish in minutes rather
              than hours.
            </p>
            <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
              There are two ways to ask it. The strict version asks what this pipeline had learned
              by a given instant, and that is the rule for everything live. The loose version asks
              what was true at the river by then, and exists for exactly one caller: the historical
              archive was imported in a single pass, so all of those rows were learned on the same
              day in August 2026, and under the strict rule asking what was knowable in early 2024
              correctly returns nothing at all. An automated check proves no other caller uses it.
            </p>
          </section>

          <section className="mt-10">
            <SectionHeading file="run predict" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Every six hours the job loads the river’s history as known at that instant, works out
              what state the river is in once, and shares that single judgement across all six
              forecasts the slot produces: two forecasters, three horizons.
            </p>

            <Calc label="persistence" formula={'central guess = the newest reading at or before now'}>
              <p>
                <CalcLead>in plain words</CalcLead>
                Predict that the river will be exactly what it is right now — whether that is 24
                hours or 72 hours from now.
              </p>
              <p>
                It sounds too simple to be useful and it is brutally hard to beat, because rivers
                have enormous inertia. Anything that cannot beat this has learned nothing.
              </p>
            </Calc>

            <Calc
              label="climatology"
              formula={
                'central guess = mean of every reading whose calendar date\n                falls within ±7 days of the target’s date,\n                taken from earlier years only'
              }
            >
              <p>
                <CalcLead>in plain words</CalcLead>
                Predict that the river will do what it usually does at this time of year.
              </p>
              <p>
                Mean is the ordinary average: add the values, divide by how many there are. The ±7
                days widens the sample — one calendar day across two years is a handful of readings,
                while a fifteen day window is thousands.
              </p>
              <p>
                Earlier years only matters: it stops the forecaster averaging in the very season it
                is trying to predict, which would be a quiet form of cheating. It refuses to answer
                at all below 96 readings, because under that the average is an anecdote rather than
                a climate.
              </p>
            </Calc>

            <Calc
              label="matching a calendar date across years"
              formula={'dayKey = month × 100 + day       (Aug 31 → 831)'}
            >
              <p>
                <CalcLead>in plain words</CalcLead>
                Turn a date into a single number that ignores the year.
              </p>
              <p>
                The obvious alternative, counting days from January 1st, drifts by one after
                February in a leap year, so “day 240” is a different calendar date in 2024 than in
                2025. Keeping month and day apart cannot drift.
              </p>
              <p>
                The calendar day is resolved in the gauge’s own timezone, so a reading just after
                midnight in Ohio is filed under that day rather than the next one — which is what it
                would be in UTC, the global reference clock every timestamp here is stored in.
              </p>
            </Calc>
          </section>
        </TerminalWindow>

        {/* ---------- intervals ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/intervals$">
          <SectionHeading file="cat interval-rules" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            A forecast of “262 cfs” alone is close to useless, because it says nothing about how
            sure it is. So every forecast carries a prediction interval: a low and a high bound with
            a stated confidence. Here that confidence is 80 percent, meaning we expect the truth to
            land inside the range about four times in five. The system does not derive it from
            theory — it looks up how wrong this same forecaster has been before in similar
            conditions, and uses its own track record.
          </p>

          <Calc
            label="how one past mistake is recorded"
            formula={'ratio = what actually happened ÷ what we predicted'}
          >
            <p>
              <CalcLead>in plain words</CalcLead>
              Express each past error as a multiplier rather than a difference.
            </p>
            <p>
              1.0 is a perfect forecast. 0.8 means the river came in at 80 percent of what we said,
              so we forecast too high. 1.5 means it came in half again above our guess.
            </p>
            <p>
              Multipliers rather than plain differences, because being 50 cfs wrong is trivial on a
              flooding river and catastrophic on a dry one. A ratio means the same thing at every
              scale.
            </p>
          </Calc>

          <Calc
            label="turning a track record into a range"
            formula={
              'lower bound = central × (10th percentile of past ratios)\nupper bound = central × (90th percentile of past ratios)'
            }
          >
            <p>
              <CalcLead>in plain words</CalcLead>
              Take every past ratio, sort them, and find the values 10 percent and 90 percent of the
              way up the list. Multiply today’s central guess by both.
            </p>
            <p>
              A percentile is a position in a sorted list: the 10th percentile is the value that 10
              percent of the sample falls below. Trimming 10 percent off each end leaves the middle
              80 percent — exactly the confidence the range claims.
            </p>
            <p>
              The precise definition of percentile is pinned in code to one of the nine standard
              ones, the definition R and NumPy use by default, because they disagree by a few
              percent on small samples and drifting between them would silently change published
              bounds.
            </p>
          </Calc>

          <Calc
            label="a real forecast, published 2026-08-29 12:00 UTC"
            formula={
              'persistence · 24 hours ahead · river state: falling\n\ncentral guess   262 cfs   (the river’s level right now)\n10th percentile 0.610     drawn from 835 past errors\n90th percentile 1.128\n\nlower  262 × 0.610 = 160 cfs\nupper  262 × 1.128 = 296 cfs'
            }
          >
            <p>
              <CalcLead>what this one tells you</CalcLead>
              The range is not centred on the guess. It reaches much further below (−102) than above
              (+34).
            </p>
            <p>
              That asymmetry is the system working. The river was falling when this was issued, and
              persistence assumes no change — so historically it has been too high far more often
              than too low in that state. The 835 past errors say so, and the published range leans
              down to match.
            </p>
            <p>
              Pooled with calm day errors, this range would have been roughly symmetrical and wrong.
              That is the entire argument for conditioning on river state.
            </p>
          </Calc>

          <p className="mt-6 max-w-prose text-term-sm leading-relaxed text-term-body">
            Not all past mistakes count. Errors are grouped into buckets — one forecaster, one
            horizon, one river state. Storm errors should not set a calm day’s range, because they
            are vastly larger. Mixing them makes storm ranges far too narrow and calm ranges
            absurdly wide, while the overall average still looks healthy.
          </p>

          <IntervalLadderDiagram />

          <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
            Each forecast permanently stores the two percentiles it used and how many past errors
            they came from. That is necessary rather than tidy: the bucket keeps growing, so a range
            published today could not be reproduced from the same query tomorrow.
          </p>
        </TerminalWindow>

        {/* ---------- scoring + river states ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/scoring$">
          <SectionHeading file="run score" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            Every hour, the job finds forecasts whose target time has passed and for which a real
            reading now exists, skipping any already graded against that same version of the truth.
            Then it computes three numbers.
          </p>

          <Calc label="how wrong, in cfs" formula={'absolute error = | actual − predicted |'}>
            <p>
              <CalcLead>in plain words</CalcLead>
              The size of the miss, ignoring direction.
            </p>
            <p>
              The bars mean absolute value: drop the minus sign. Being 40 cfs under and 40 cfs over
              are both a 40 cfs error. Direction is not lost — the ratio above captures it.
            </p>
          </Calc>

          <Calc
            label="how wrong, as a share"
            formula={'percentage error = absolute error ÷ max(actual, floor)'}
          >
            <p>
              <CalcLead>in plain words</CalcLead>
              Express the miss as a share of the river’s size — but never divide by a number smaller
              than the floor. max(a, b) simply means whichever of the two is larger.
            </p>
            <p>
              Without the floor, a summer trickle wrecks the statistic. If the river is at 2 cfs and
              the forecast said 12, dividing by 2 reports a 500 percent error: technically true,
              practically meaningless, and large enough to swamp every other number on the chart.
            </p>
          </Calc>

          <Calc
            label="the floor itself"
            formula={
              'floor = 5th percentile of every reading ever taken here\n      = 18.9 cfs, then frozen permanently'
            }
          >
            <p>
              <CalcLead>in plain words</CalcLead>
              A stand-in for “about as low as this river ever gets” — the level only 5 percent of
              readings fall below.
            </p>
            <p>
              Calculated once, then frozen. If it drifted as the record grew, two grades of the same
              forecast written months apart would sit on different scales, with nothing recording
              the difference.
            </p>
          </Calc>

          <Calc label="did the range work?" formula={'inside = (lower ≤ actual ≤ upper)'}>
            <p>
              <CalcLead>in plain words</CalcLead>
              A simple yes or no: did the truth land inside the range we published?
            </p>
            <p>
              One of these says little. Across thousands they answer the question that decides
              whether any of the interval machinery works. That comparison is called calibration,
              and the current figure is further down.
            </p>
          </Calc>

          <section className="mt-10">
            <SectionHeading file="cat river-states" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Everything above depends on knowing what the river was doing at a given moment. That
              is its regime, and one small function decides it. It matters far out of proportion to
              its size, because it picks which bucket of past errors a forecast’s range comes from.
              It works from three measurements and one constant:
            </p>

            <div className="mt-4 overflow-x-auto border border-term-border">
              <table className="w-full border-collapse text-term-sm">
                <thead>
                  <tr className="border-b border-term-border">
                    <th className="px-3 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
                      Symbol
                    </th>
                    <th className="px-3 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
                      What it is
                    </th>
                    <th className="px-3 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
                      Why that one
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {REGIME_INPUTS.map((row) => (
                    <tr key={row.symbol} className="border-b border-term-border last:border-b-0">
                      <td className="px-3 py-2 align-top font-bold text-term-ink">{row.symbol}</td>
                      <td className="px-3 py-2 align-top leading-relaxed text-term-body">
                        {row.what}
                      </td>
                      <td className="px-3 py-2 align-top leading-relaxed text-term-muted">
                        {row.why}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The four states are tested strictly in this order, and the first match wins.
            </p>

            <Calc label="1 · rising" formula={'d ≥ 0.1 × m'}>
              <p>
                <CalcLead>in plain words</CalcLead>
                The river came up, in the last 12 hours, by at least a tenth of its normal level.
              </p>
              <p>
                Measured against normal rather than its current size, because a rise is caused by
                rain arriving — an absolute quantity of water entering the catchment — so an
                absolute yardstick suits it. This is the hardest state to forecast, and it is tested
                first so nothing else can claim a rising river.
              </p>
            </Calc>

            <Calc label="2 · falling" formula={'d ≤ −0.1 × max(v, f)'}>
              <p>
                <CalcLead>in plain words</CalcLead>
                The river dropped, in the last 12 hours, by at least a tenth of its current size.
              </p>
              <p>
                Measured against its current size, because a draining river decays by roughly a
                constant fraction: it loses far more cfs per hour at 3,000 than at 300, but a
                similar share. Only a fraction of the current value keeps a stable meaning all the
                way down that curve.
              </p>
              <p>
                The max(v, f) stops the threshold shrinking to nothing at very low flow. Without it,
                a river at 2 cfs would count as falling for a drop of 0.2, which is noise rather
                than a recession.
              </p>
            </Calc>

            <Calc label="3 · peak" formula={'v ≥ 1.5 × m'}>
              <p>
                <CalcLead>in plain words</CalcLead>
                The river is sitting at least half again above its normal level, without rising or
                falling fast.
              </p>
              <p>
                Because the two moving states were tested first, what reaches here is high water
                that is holding steady: the crest of a flood and the plateau just after it.
              </p>
            </Calc>

            <Calc label="4 · baseflow" formula={'everything else'}>
              <p>
                <CalcLead>in plain words</CalcLead>
                An ordinary calm day. Most of the record, and the easiest state to forecast.
              </p>
            </Calc>

            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The function returns “unknown” rather than guessing in three cases: fewer than 224
              readings in the seven day window (a third of the 672 a complete week would hold, which
              tolerates real gauge outages without letting a handful of readings decide), a median
              at or below zero, or no reading within two hours of the twelve hour mark. Guessing
              “calm” in those cases would file storm errors under the easy state and flatter every
              summary built on top.
            </p>

            <h3 className="mt-8 text-term-base font-bold text-term-ink">
              Why the falling rule was rewritten
            </h3>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              It originally measured the drop against the larger of the current value and the seven
              day median. Measured against the whole record that was wrong, and the reason
              generalises.
            </p>
            <p className="mt-3 max-w-prose border-l-2 border-term-accent pl-4 text-term-sm leading-relaxed text-term-body">
              A seven day median is not a baseline in the week after a flood. It is mostly made of
              the flood. So a threshold anchored to it grows exactly as the river shrinks, and the
              rule goes quiet precisely where a recession gets long.
            </p>
            <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
              The measured cost: 742 forecasts whose errors behaved exactly like a draining river
              were filed as calm days. Their ratios had a median of 0.816 with 80 percent of
              forecasts too high — against 0.970, near enough unbiased, for genuinely calm days.
              Pooling two populations that different produces ranges wrong for both. Fixing a rule
              like this means relabelling history, which a dedicated tool does: it rebuilds each
              row’s original view of the river, refuses to write if any forbidden state change
              appears, and records that it finished so the same migration cannot silently run twice.
              It last moved 1,323 forecasts and 1,294 grades.
            </p>
          </section>
        </TerminalWindow>

        {/* ---------- bootstrap + limitations ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/limitations$">
          <SectionHeading file="run hindcast" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            Ranges come from past errors, and a brand new pipeline has none. Every early forecast
            would have shipped the placeholder band — and because a published range is never
            recomputed, those useless bounds would sit in the public record permanently.
          </p>
          <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
            The fix is a hindcast: replaying history as though the system had been running through
            it. It walks 3,870 six hourly moments from January 2024 forward and, at each one, makes
            forecasts using only what was knowable then, grades the ones whose target has passed,
            and steps forward. Crucially it goes moment by moment rather than forecasting everything
            and then grading everything, so the buckets fill as they would have in real life and
            each simulated forecast’s range is drawn only from errors that existed by that point. It
            produced 18,849 forecasts, all flagged as replayed and filtered out of every public page
            — so the scorecard’s claim to show every forecast it ever made stays literally true.
          </p>

          <section className="mt-10">
            <SectionHeading file="cat limitations.txt" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-muted">
              What the numbers currently say, including where they are uncomfortable.
            </p>

            <h3 className="mt-6 text-term-base font-bold text-term-ink">
              The ranges are slightly too narrow
            </h3>
            <Calc
              label="measured coverage, all 17,615 grades"
              formula={
                '13,807 landed inside the published range\n÷ 17,615 grades\n\n= 78.4%   against the 80% claimed'
              }
            >
              <p>
                <CalcLead>what it means</CalcLead>
                Slightly overconfident. When this system publishes an 80 percent range, the truth
                lands inside it 78.4 percent of the time.
              </p>
              <p>
                Close, and honest, but not yet broken down. A single overall figure can hide a state
                that is badly wrong while another compensates, which is exactly what the next piece
                of work is for.
              </p>
            </Calc>

            <h3 className="mt-8 text-term-base font-bold text-term-ink">
              One river state is still mislabelled
            </h3>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Forecasts issued at a peak measure 0.831 with 74 percent too high, across 408 grades.
              A genuine plateau should be close to unbiased, so that number suggests “peak” still
              mixes the crest with the first hours of the drop, and may want splitting again. It is
              measured, recorded, and deliberately unresolved.
            </p>

            <h3 className="mt-8 text-term-base font-bold text-term-ink">
              No correction has actually arrived yet
            </h3>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              The store holds 86,945 readings, and every one of them appears exactly once. The
              entire two timestamp design exists for revisions, and in the record so far there have
              been none — because the pipeline has only been ingesting since August 2026, and USGS
              review runs months behind. The machinery is proven by tests rather than by production
              evidence, and until a real correction lands, the rewind slider on the dashboard is
              showing readings arriving, not values changing.
            </p>

            <h3 className="mt-8 text-term-base font-bold text-term-ink">One gauge, one creek</h3>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              Every number here comes from a single unregulated stream in central Ohio, over about
              twenty months. Nothing proves the approach generalises to a river whose flow is set by
              a dam operator rather than by rainfall.
            </p>
          </section>
        </TerminalWindow>

        {/* ---------- build order ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/build-order$">
          <SectionHeading file="cat build-order.txt" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
            The order is not the fastest route to a model. It is arranged so that each stage teaches
            the thing the next one depends on — which is why a complete, live, publicly graded
            forecasting system exists before any machine learning does. If the plumbing cannot be
            trusted, no model built on it can be either.
          </p>

          <ol className="mt-6 max-w-prose space-y-0">
            {STAGES.map((stage) => (
              <li
                key={stage.n}
                className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-term-border py-4 last:border-b-0"
              >
                <span aria-hidden="true" className="pt-0.5 text-term-sm text-term-muted tabular-nums">
                  {stage.n}
                </span>
                <div>
                  <h3 className="text-term-base font-bold text-term-ink">
                    {stage.name}
                    <span
                      className={
                        stage.tag === 'next'
                          ? 'ml-2 bg-term-accent px-1.5 py-0.5 text-term-xs uppercase tracking-wide text-term-on-accent'
                          : stage.tag === 'shipped'
                            ? 'ml-2 text-term-xs uppercase tracking-wide text-term-accent'
                            : 'ml-2 text-term-xs uppercase tracking-wide text-term-muted'
                      }
                    >
                      {stage.tag}
                    </span>
                  </h3>
                  <p className="mt-1 max-w-prose text-term-sm leading-relaxed text-term-body">
                    {stage.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </TerminalWindow>

        {/* ---------- glossary + references ---------- */}
        <TerminalWindow path="tonychou@portfolio:~/walkthrough/reference$">
          <SectionHeading file="cat glossary.txt" />
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-muted">
            Every term and abbreviation used above, in one place.
          </p>
          <dl className="mt-4 max-w-prose">
            {GLOSSARY.map(([term, meaning]) => (
              <div key={term} className="border-b border-term-border py-3 last:border-b-0">
                <dt className="text-term-sm font-bold text-term-ink">{term}</dt>
                <dd className="mt-1 max-w-prose text-term-sm leading-relaxed text-term-body">
                  {meaning}
                </dd>
              </div>
            ))}
          </dl>

          <section className="mt-10">
            <SectionHeading file="cat references.txt" />
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-muted">
              Sources for the data, the services, and the methods named above.
            </p>
            <ul className="mt-4 max-w-prose">
              {REFERENCES.map((ref) => (
                <li key={ref.href} className="border-b border-term-border py-3 last:border-b-0">
                  <a
                    href={ref.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="terminal-select text-term-sm text-term-ink"
                  >
                    {ref.name} ↗
                  </a>
                  <p className="mt-1 max-w-prose text-term-sm leading-relaxed text-term-muted">
                    {ref.what}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10 border-t border-term-border pt-6">
            <div className="flex flex-wrap gap-3">
              <a
                href="/streamflow"
                className="terminal-select inline-flex min-h-[44px] items-center border border-term-accent px-4 py-2 text-term-base font-bold text-term-accent"
              >
                [ open the dashboard ]
              </a>
              <a
                href="/projects/streamflow"
                className="terminal-select inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink"
              >
                [ back to the case study ]
              </a>
            </div>
            <p className="mt-3 max-w-prose text-term-xs leading-relaxed text-term-muted">
              Every figure above was measured against the live database on 2026-08-29 and will drift
              as the record grows. Where this page and the running system disagree, the system is
              right. Discharge data courtesy of the U.S. Geological Survey, National Water
              Information System. This is an engineering demonstration, not a flood forecast, and
              nothing here should be used to make decisions about water.
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
