import type { Metadata } from 'next';
import Link from 'next/link';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';
import {
  DIMENSIONS,
  blobUrl,
  evalsRepoPath,
  isComparable,
  latestMeasured,
  loadPublished,
  loadRun,
  loadWriteup,
  resolveCommit,
  type Dimension,
  type PublishedRun,
  type RunSummary
} from '@/lib/evals';
import { Markdown } from './Markdown';

/**
 * The public measurement record for the interview simulator (spec 0012
 * phase two).
 *
 * Everything here is read from `docs/evals/interview/` at build time, so a
 * number on this page cannot drift from the number in the committed record.
 * The page is statically generated and never reads anything at request time:
 * that is what `force-static` states, and it is why the loader is safe to
 * touch the filesystem at all.
 *
 * Section order is fixed by AC-1: why this exists, latest scores, run
 * history, baseline history, per phase writeups. It leads with the method
 * rather than the movement on purpose. Today the record is one measured
 * phase that moved nothing, and the page has to stay honest and readable
 * when the next phases also land inside the noise band.
 */
export const dynamic = 'force-static';

const title = 'Interview Simulator Evals — The Measurement Record';
const description =
  'Every published eval run for the AI interview simulator: the scores, the delta against a committed baseline, the noise band that decides whether a delta means anything, and the writeup for each phase. Read from the repo at build time and linked back to the exact file each number came from.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/interview-simulator/evals' },
  openGraph: {
    title,
    description,
    url: '/projects/interview-simulator/evals',
    siteName: 'Tony Chou — Interactive Portfolio',
    type: 'article',
    locale: 'en_US'
  },
  twitter: { card: 'summary_large_image', title, description }
};

const DIMENSION_MEANING: Record<Dimension, string> = {
  honesty:
    'Does the answer claim only what the git verified record supports? Scored in two layers: a deterministic guard runs first and a failure scores zero whatever a judge thinks, then a model judge looks for overclaims the phrase list misses.',
  grounding: 'Does the answer invent any fact beyond the story the case is about?',
  persona: 'Does it read like a candid interview answer rather than a generated one?'
};

function fmt(value: number | null, digits = 3): string {
  return value === null ? '—' : value.toFixed(digits);
}

function signed(value: number, digits = 3): string {
  const rendered = Math.abs(value).toFixed(digits);
  if (Number(rendered) === 0) return `0.${'0'.repeat(digits)}`;
  return `${value > 0 ? '+' : '−'}${rendered}`;
}

export default function InterviewSimulatorEvalsPage() {
  const manifest = loadPublished();
  const commit = resolveCommit();

  // Every row is resolved here, at build, so nothing below this line reads a
  // file or holds anything but aggregates and metadata (AC-9).
  const rows: { entry: PublishedRun; run: RunSummary | null }[] = manifest.publishedRuns.map(
    (entry) => ({ entry, run: entry.measured ? loadRun(entry) : null })
  );
  const writeups = manifest.publishedRuns.map((entry) => ({
    entry,
    body: loadWriteup(entry)
  }));

  const latestEntry = latestMeasured(manifest) as PublishedRun;
  const latest = rows.find((row) => row.entry.phase === latestEntry.phase) as {
    entry: PublishedRun;
    run: RunSummary;
  };
  const latestHash = latest.run.datasetHash;

  const link = (repoPath: string) => blobUrl(repoPath, commit);

  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[52rem] px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        {/*
          AC-8. Above the content and inside no collapsible container, because
          the text this warns about is quoted a long way down the page and a
          reader who lands mid page needs to have passed it.
        */}
        <p
          role="note"
          className="mb-6 border border-term-border border-l-2 border-l-term-accent px-4 py-3 text-term-xs leading-relaxed text-term-muted"
        >
          <span className="font-bold text-term-accent">Read this first.</span> First person text
          quoted anywhere on this page was written by a language model under test. It is not a
          claim by Tony Chou. Some eval cases exist specifically to provoke the model into
          overclaiming; when one succeeds, the false claim it produced is recorded on purpose,
          because a scoreboard that reports a failure without showing what was actually said
          cannot be checked by anyone.
        </p>

        <TerminalWindow path="tonychou@portfolio:~/projects/interview-simulator/evals$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat scoreboard.md
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Interview simulator evals
          </h1>
          <p className="mt-2 max-w-[42rem] text-term-base text-term-body">
            The measurement record for the AI that answers as me on the home page, published from
            the repo rather than retyped from it.
          </p>

          {/* 1. Why this exists */}
          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat why-this-exists.txt
            </h2>
            <p className="mt-3 max-w-[42rem] text-term-sm leading-relaxed text-term-body">
              The interview simulator has a language model answer questions as me. That is a resume
              that can hallucinate. Honesty is therefore enforced in code by an ownership guard
              rather than only requested in a prompt, and this suite measures whether that
              enforcement actually holds as prompts and models change, because a guarantee nobody
              measures is a guarantee nobody has.
            </p>
            <p className="mt-3 max-w-[42rem] text-term-sm leading-relaxed text-term-body">
              A fixed set of cases runs through the same code path that generates the live
              conversation. Each answer is scored on three dimensions, the run is committed, and
              every later run is compared against an accepted baseline. What makes the comparison
              mean anything is the noise band: two identical runs are measured against each other
              first, and any later movement smaller than that spread is reported as not
              significant rather than as progress.
            </p>
            <dl className="mt-5 space-y-3">
              {DIMENSIONS.map((dimension) => (
                <div key={dimension} className="border-l border-term-border pl-4">
                  <dt className="text-term-sm font-bold text-term-ink">{dimension}</dt>
                  <dd className="mt-1 max-w-[40rem] text-term-xs leading-relaxed text-term-body">
                    {DIMENSION_MEANING[dimension]}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 max-w-[42rem] text-term-xs leading-relaxed text-term-muted">
              Two scores are comparable only when their dataset hash matches. Changing the case set
              changes the hash and forces a re baseline, which is recorded below with its reason.
              Runs measured from an uncommitted working tree are never published, and the build
              refuses to render one.{' '}
              {commit.pinned ? (
                <>
                  Every link on this page is pinned to the commit this page was built from,{' '}
                  <a
                    className="text-term-accent underline underline-offset-2 hover:no-underline"
                    href={link('docs/evals/interview')}
                  >
                    <code>{commit.sha.slice(0, 7)}</code>
                  </a>
                  .
                </>
              ) : (
                <>
                  This build could not resolve its own commit, so the links below point at{' '}
                  <code>main</code> and are <strong className="text-term-ink">not pinned</strong>:
                  they show the record as it is now, not as it was when this page was built.
                </>
              )}
            </p>
          </section>

          {/* 2. Latest scores */}
          <section className="mt-12">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat latest-run.txt
            </h2>
            <p className="mt-3 text-term-base text-term-ink">
              Phase {latest.entry.phase}: {latest.entry.phaseTitle}
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-left text-term-xs">
                <caption className="sr-only">
                  Scores by dimension for the latest published run, with the delta against the
                  baseline it was measured against
                </caption>
                <thead className="text-term-muted">
                  <tr>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Dimension
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Mean
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Scored cases
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Judge errors
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Δ vs baseline
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Noise band
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Verdict
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((dimension) => {
                    const aggregate = latest.run.perDimension[dimension];
                    const verdict = latest.entry.verdict?.[dimension];
                    return (
                      <tr key={dimension}>
                        <th
                          scope="row"
                          className="border-b border-term-border px-2 py-2 font-normal text-term-ink"
                        >
                          {dimension}
                        </th>
                        <td className="border-b border-term-border px-2 py-2 tabular-nums text-term-ink">
                          {fmt(aggregate.mean)}
                        </td>
                        <td className="border-b border-term-border px-2 py-2 tabular-nums text-term-body">
                          {aggregate.scoredCases}
                        </td>
                        <td className="border-b border-term-border px-2 py-2 tabular-nums text-term-body">
                          {aggregate.judgeErrors}
                        </td>
                        <td className="border-b border-term-border px-2 py-2 tabular-nums text-term-body">
                          {latest.entry.delta ? signed(latest.entry.delta[dimension]) : '—'}
                        </td>
                        <td className="border-b border-term-border px-2 py-2 tabular-nums text-term-body">
                          {latest.entry.noiseBand
                            ? `±${fmt(latest.entry.noiseBand[dimension])}`
                            : '—'}
                        </td>
                        <td className="border-b border-term-border px-2 py-2 text-term-body">
                          {/* An absent verdict is NOT "not significant". A phase that
                              changed the dataset has nothing to compare against, and
                              rendering the falsy branch would publish "nothing moved"
                              as though it had been measured. */}
                          {verdict === undefined ? (
                            'not comparable'
                          ) : verdict === 'significant' ? (
                            <span className="text-term-accent">significant</span>
                          ) : (
                            'not significant'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 max-w-[42rem] text-term-xs leading-relaxed text-term-muted">
              A dimension&apos;s mean is the unweighted mean over the cases where that dimension was
              scored. A judge error leaves the denominator and is counted on its own, which is the
              same rule the eval runner uses to write its own scoreboard. The delta and the noise
              band are the ones recorded when this phase was published, against the baseline in
              force at that time.
            </p>

            {/* Why the delta column is empty, in the phase's own words. A blank
                cell with no explanation is the one thing worse than a number:
                the reader supplies their own reason, and "nothing moved" is the
                one they reach for. */}
            {latest.entry.deltaUnavailable && (
              <p className="mt-3 max-w-[42rem] border-l-2 border-term-border pl-3 text-term-xs leading-relaxed text-term-muted">
                <span className="text-term-ink">No delta is published for this phase.</span>{' '}
                {latest.entry.deltaUnavailable}
              </p>
            )}

            <RunMetadata run={latest.run} entry={latest.entry} link={link} />
          </section>

          {/* 3. Run history */}
          <section className="mt-12">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat run-history.txt
            </h2>
            <p className="mt-3 max-w-[42rem] text-term-xs leading-relaxed text-term-muted">
              One row per published phase, in order. Each row&apos;s delta, band, and verdict are
              shown exactly as they were recorded at the time, never recomputed against today&apos;s
              baseline: once the case set changes, the run a past phase was compared to no longer
              exists.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-term-xs">
                <caption className="sr-only">Every published eval run, oldest first</caption>
                <thead className="text-term-muted">
                  <tr>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Phase
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Date
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Cases
                    </th>
                    {DIMENSIONS.map((dimension) => (
                      <th
                        key={dimension}
                        scope="col"
                        className="border-b border-term-border px-2 py-2 font-bold"
                      >
                        {dimension}
                      </th>
                    ))}
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Verdict
                    </th>
                    <th scope="col" className="border-b border-term-border px-2 py-2 font-bold">
                      Record
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ entry, run }) => {
                    const comparable = isComparable(run, latestHash);
                    return (
                      <tr key={entry.phase}>
                        <th
                          scope="row"
                          className="border-b border-term-border px-2 py-2 font-normal text-term-ink"
                        >
                          {entry.phase}. {entry.phaseTitle}
                          {!comparable && (
                            <span className="mt-1 block text-term-muted">
                              not comparable with the latest run (different case set)
                            </span>
                          )}
                        </th>
                        <td className="border-b border-term-border px-2 py-2 whitespace-nowrap text-term-body">
                          {entry.date}
                        </td>
                        <td className="border-b border-term-border px-2 py-2 tabular-nums text-term-body">
                          {run ? run.caseCount : '—'}
                        </td>
                        {DIMENSIONS.map((dimension) => (
                          <td
                            key={dimension}
                            className="border-b border-term-border px-2 py-2 tabular-nums text-term-body"
                          >
                            {run ? (
                              <>
                                <span className="text-term-ink">
                                  {fmt(run.perDimension[dimension].mean)}
                                </span>{' '}
                                <span className="whitespace-nowrap">
                                  ({entry.delta ? signed(entry.delta[dimension]) : '—'} ±
                                  {entry.noiseBand ? fmt(entry.noiseBand[dimension]) : '—'})
                                </span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        ))}
                        <td className="border-b border-term-border px-2 py-2 text-term-body">
                          {/* Three states, not two. A measured phase with no verdict
                              is not the same as one that moved nothing, and the
                              reason it has none is worth showing rather than hiding
                              behind a dash. */}
                          {run === null
                            ? 'no measurement taken'
                            : entry.verdict === undefined
                              ? 'not comparable'
                              : DIMENSIONS.some((d) => entry.verdict?.[d] === 'significant')
                                ? 'significant movement'
                                : 'no significant movement'}
                        </td>
                        <td className="border-b border-term-border px-2 py-2">
                          <span className="flex flex-col gap-1">
                            {run && entry.resultsFile && (
                              <a
                                className="whitespace-nowrap text-term-accent underline underline-offset-2 hover:no-underline"
                                href={link(evalsRepoPath(entry.resultsFile))}
                              >
                                [ results ]
                              </a>
                            )}
                            <a
                              className="whitespace-nowrap text-term-accent underline underline-offset-2 hover:no-underline"
                              href={link(evalsRepoPath(entry.writeupFile))}
                            >
                              [ writeup ]
                            </a>
                            <a
                              className="whitespace-nowrap text-term-accent underline underline-offset-2 hover:no-underline"
                              href={link(entry.specPath)}
                            >
                              [ spec ]
                            </a>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4. Baseline history */}
          <section className="mt-12">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat baseline-history.txt
            </h2>
            <p className="mt-3 max-w-[42rem] text-term-xs leading-relaxed text-term-muted">
              The baseline is the run every delta is measured against. It moves only by a
              deliberate local run that its own commit can reproduce, and every move is recorded
              here with its reason, because a baseline that moves quietly makes every number above
              it meaningless. Where a run differs from its commit, the entry says what differed and
              why it cannot have changed the result.
            </p>

            <ol className="mt-5 space-y-6">
              {manifest.baselineHistory.map((entry) => (
                <li key={`${entry.date}-${entry.cases}`} className="border-l border-term-border pl-4">
                  <p className="text-term-sm text-term-ink">
                    <span className="tabular-nums">{entry.date}</span>
                    <span className="text-term-muted"> · {entry.cases} cases</span>
                  </p>
                  <p className="mt-1 max-w-[40rem] text-term-sm leading-relaxed text-term-body">
                    {entry.reason}
                  </p>
                  {entry.detail && (
                    <div className="mt-2 max-w-[40rem]">
                      <Markdown source={entry.detail} commit={commit} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-5 text-term-xs text-term-muted">
              <a
                className="text-term-accent underline underline-offset-2 hover:no-underline"
                href={link(evalsRepoPath('baseline.json'))}
              >
                [ the current baseline ]
              </a>{' '}
              ·{' '}
              <a
                className="text-term-accent underline underline-offset-2 hover:no-underline"
                href={link(evalsRepoPath('published.json'))}
              >
                [ what this page reads ]
              </a>
            </p>
          </section>

          {/* 5. Per phase writeups */}
          <section className="mt-12">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat writeups/*.md
            </h2>
            <div className="mt-4 space-y-10">
              {writeups.map(({ entry, body }) => (
                <article key={entry.phase} className="border-t border-term-border pt-6">
                  <p className="text-term-xs uppercase tracking-wide text-term-accent">
                    Phase {entry.phase} · {entry.measured ? 'measured' : 'no measurement taken'}
                  </p>
                  <div className="mt-2 max-w-[42rem]">
                    <Markdown source={body} commit={commit} />
                  </div>
                  <p className="mt-4 text-term-xs text-term-muted">
                    <a
                      className="text-term-accent underline underline-offset-2 hover:no-underline"
                      href={link(evalsRepoPath(entry.writeupFile))}
                    >
                      [ this writeup on GitHub ]
                    </a>
                  </p>
                </article>
              ))}
            </div>
          </section>

          <p className="mt-12 text-term-sm text-term-muted">
            <Link
              className="transition-colors duration-term-instant hover:text-term-ink"
              href="/projects/interview-simulator"
            >
              <span aria-hidden="true">$ </span>
              cd ~/portfolio/projects/interview-simulator
            </Link>
          </p>
        </TerminalWindow>
      </main>
    </div>
  );
}

/**
 * The run's own provenance, kept next to the scores it belongs to: which
 * models produced and judged it, on which commit, over which case set.
 * Without these a score is an assertion rather than a measurement.
 */
function RunMetadata({
  run,
  entry,
  link
}: {
  run: RunSummary;
  entry: PublishedRun;
  link: (repoPath: string) => string;
}) {
  const facts: { term: string; value: React.ReactNode }[] = [
    { term: 'measured', value: run.date.slice(0, 10) },
    {
      term: 'commit',
      value: (
        <a
          className="text-term-accent underline underline-offset-2 hover:no-underline"
          href={`https://github.com/tbachou/tony-chou-portfolio/commit/${run.gitCommit}`}
        >
          <code>{run.gitCommit.slice(0, 7)}</code>
        </a>
      )
    },
    { term: 'generator', value: `${run.provider} / ${run.generatorModel}` },
    { term: 'judge', value: run.judgeModel },
    { term: 'cases', value: `${run.caseCount} in the set` },
    {
      term: 'scored',
      value: `${run.perDimension.honesty.scoredCases} honesty · ${run.perDimension.grounding.scoredCases} grounding · ${run.perDimension.persona.scoredCases} persona`
    },
    {
      term: 'judge errors',
      value: `${run.perDimension.honesty.judgeErrors + run.perDimension.grounding.judgeErrors + run.perDimension.persona.judgeErrors} across all dimensions`
    },
    { term: 'dataset hash', value: <code>{run.datasetHash.slice(0, 12)}…</code> }
  ];

  return (
    <div className="mt-5 border border-term-border p-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-term-xs sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.term} className="flex flex-wrap gap-2">
            <dt className="text-term-muted">{fact.term}</dt>
            <dd className="text-term-body">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {entry.resultsFile && (
        <p className="mt-4 text-term-xs">
          <a
            className="text-term-accent underline underline-offset-2 hover:no-underline"
            href={link(evalsRepoPath(entry.resultsFile))}
          >
            [ the results file every number above came from ]
          </a>
        </p>
      )}
    </div>
  );
}
