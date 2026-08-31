import type { Metadata } from 'next';
import Link from 'next/link';
import { BackToProjects } from '@/components/BackToProjects';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';
import { blobUrl, resolveCommit } from '@/lib/evals';

/**
 * A deliberate stub (spec 0012 phase two, AC-10).
 *
 * The simulator is the most distinctive thing on this site and was the only
 * one with no case study route, which left the evals page with no parent to
 * sit under. This says what the thing is and points at the two places that
 * carry the detail: the measurement record, and the specs. It does not
 * attempt the full case study, because the story it would tell is three
 * phases from being finished, and a thin case study written early tends to
 * stay thin. Finishing it is tracked in the phase two spec's follow ups.
 */
export const dynamic = 'force-static';

const title = 'Interview Simulator — Project Case Study';
const description =
  'An AI that answers interview questions as Tony Chou, held to a git verified record by a deterministic ownership guard, and measured by a committed eval suite that publishes its own scoreboard.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/interview-simulator' },
  openGraph: {
    title,
    description,
    url: '/projects/interview-simulator',
    siteName: 'Tony Chou — Interactive Portfolio',
    type: 'website',
    locale: 'en_US'
  },
  twitter: { card: 'summary_large_image', title, description }
};

const SPEC_0011 = 'docs/specs/_root/0011-interview-simulator-eval-suite/index.md';
const SPEC_0012 = 'docs/specs/_root/0012-grounded-portfolio-agent/index.md';

export default function InterviewSimulatorProjectPage() {
  const commit = resolveCommit();

  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[46rem] px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/projects/interview-simulator$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat status.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-accent">
            [ live — on the home page, and measured ]
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Interview simulator
          </h1>
          <p className="mt-1 max-w-[39rem] text-term-base text-term-body">
            An AI that answers interview questions as me, and a suite that measures whether it is
            telling the truth.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/#interview"
              className="terminal-select inline-flex min-h-[44px] items-center border border-term-accent px-4 py-2 text-term-base font-bold text-term-accent"
            >
              [ talk to ai-tony ]
            </Link>
            <Link
              href="/projects/interview-simulator/evals"
              className="terminal-select inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink"
            >
              [ read the evals ]
            </Link>
          </div>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-it-does.txt
            </h2>
            <p className="mt-2 max-w-[39rem] text-term-base leading-relaxed text-term-body">
              Pick a topic on the home page and an interviewer asks a question about a real project
              I worked on. A second model answers it in the first person, as me, streamed live. Both
              turns are generated; neither is scripted. The interesting part is not that it talks,
              it is what it is allowed to say.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat the-honesty-problem.txt
            </h2>
            <p className="mt-2 max-w-[39rem] text-term-base leading-relaxed text-term-body">
              A model answering as a candidate is a resume that can hallucinate. It will happily
              take credit for a teammate&apos;s work, inflate a number, or claim a qualification I do
              not hold, and it will do all of that in a confident first person voice. Asking a
              prompt nicely not to is not a control.
            </p>
            <p className="mt-3 max-w-[39rem] text-term-base leading-relaxed text-term-body">
              So the answers are grounded in a corpus of stories built from real commit attribution,
              and a deterministic ownership guard runs over every generated turn before it reaches
              the screen. The guard is code, not a prompt: it fires on the phrases that overclaim,
              whatever the model felt like saying.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat but-does-it-hold.txt
            </h2>
            <p className="mt-2 max-w-[39rem] text-term-base leading-relaxed text-term-body">
              A guarantee nobody measures is a guarantee nobody has, and prompts and models change
              underneath it. So there is an eval suite: a fixed set of cases, several written
              specifically to bait the model into overclaiming, run through the same code path the
              live conversation uses and scored on honesty, grounding, and persona. Every run is
              committed, compared against an accepted baseline, and published with the noise band
              that decides whether a movement means anything at all.
            </p>
            <p className="mt-3 max-w-[39rem] text-term-base leading-relaxed text-term-body">
              That record is public, including the phases where nothing moved.
            </p>
            <p className="mt-4">
              <Link
                href="/projects/interview-simulator/evals"
                className="text-term-base text-term-accent underline underline-offset-2 hover:no-underline"
              >
                [ the measurement record → ]
              </Link>
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              ls specs/
            </h2>
            <p className="mt-2 max-w-[39rem] text-term-sm leading-relaxed text-term-muted">
              This page is a stub on purpose: the build it describes is partway through a phased
              plan, and the specs carry more than a case study written now honestly could.
            </p>
            <ul className="mt-4 space-y-3 text-term-sm">
              <li>
                <a
                  className="text-term-accent underline underline-offset-2 hover:no-underline"
                  href={blobUrl(SPEC_0011, commit)}
                >
                  [ spec 0011 — the eval suite ]
                </a>
                <span className="mt-1 block text-term-xs text-term-body">
                  The measurement instrument: the case set, the two layer honesty score, the
                  baseline and the noise band.
                </span>
              </li>
              <li>
                <a
                  className="text-term-accent underline underline-offset-2 hover:no-underline"
                  href={blobUrl(SPEC_0012, commit)}
                >
                  [ spec 0012 — the grounded portfolio agent ]
                </a>
                <span className="mt-1 block text-term-xs text-term-body">
                  The phased build the suite measures: a context engineering pass, this public
                  record, retrieval, and guided steering.
                </span>
              </li>
            </ul>
          </section>

          <p className="mt-12">
            <BackToProjects />
          </p>
        </TerminalWindow>
      </main>
    </div>
  );
}
