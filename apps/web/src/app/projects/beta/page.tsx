import type { Metadata } from 'next';
import { BackToProjects } from '@/components/BackToProjects';
import { TerminalWindow } from '@/components/TerminalWindow';

const title = 'Beta — Project Case Study';
const description =
  'Beta is an AI return-to-climbing rehab planner — three agents with hard safety rails, running live in the browser. It drafts staged plans for the three most common climbing injuries.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/beta' },
  openGraph: {
    title,
    description,
    url: '/projects/beta',
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

const AGENTS = [
  {
    name: 'Safety screener (Claude Haiku)',
    role: 'Checks the symptom checklist and free text against red-flag rules before anything else runs. A red-flag verdict — returned as a structured tool call — hard-blocks the pipeline; no plan is drafted.'
  },
  {
    name: 'Progression drafter (Claude Sonnet)',
    role: 'The clinical reasoning core. Produces the staged return-to-climbing progression — time windows, exercises with sets and reps, allowed climbing, criteria to advance — as structured JSON via a forced tool call.'
  },
  {
    name: 'Plain-language coach (Claude Haiku)',
    role: 'Rewrites the structured draft into warm, plain language and streams it to the page as the final plan.'
  }
];

const GUARDRAILS = [
  'Red-flag symptoms — a sudden pop with swelling, numbness or tingling, inability to bear weight or use the hand, night pain — stop the pipeline cold. The visitor is pointed to the right kind of professional, and no plan is generated. This is a hard block, not a disclaimer.',
  'Nothing a visitor types into the planner is stored. No injury details, goals, or generated plans touch the database — the only writes are two anonymous counter tables. The feedback form is the one exception: that message is stored, run through an automated classifier on AWS, and emailed to Tony.',
  'Cost is capped at every layer: 3 requests per hour per IP (in memory), 6 plans per day per IP (persisted), and 40 plans per day globally. Worst-case daily AI spend is bounded no matter the traffic.',
  'Free-text fields are length-capped and treated as data, not instructions — off-topic or prompt-injection input gets a polite refusal, not arbitrary model output.'
];

export default function BetaProjectPage() {
  return (
    <div className="min-h-dvh">
      {/* The #main-content id below already existed with nothing pointing at
          it. Landmarks and headings already satisfy 2.4.1, so this is a
          convenience rather than a fix: invisible until focused, and first
          in the tab order. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-term-accent focus:bg-term-canvas focus:px-3 focus:py-2 focus:text-term-sm focus:text-term-accent"
      >
        [ skip to main content ]
      </a>

      <header className="border-b border-term-border">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-0">
          <BackToProjects />
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-4xl px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/projects/beta$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat status.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-accent">
            [ live — in-browser demo, no download ]
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Beta
          </h1>
          <p className="mt-1 max-w-prose text-term-base text-term-body">
            An AI return-to-climbing rehab planner with hard safety rails.
          </p>

          <div className="mt-6">
            {/* New tab on purpose: Beta has its own visual identity, so opening
                it over the terminal site made it unclear how to get back. */}
            <a
              href="/beta"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center border border-term-accent px-4 py-2 text-term-base font-bold text-term-accent transition-colors duration-term-instant hover:bg-term-accent hover:text-term-on-accent"
            >
              [ launch beta ↗ ]
            </a>
          </div>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-it-does.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
              Beta is a public web tool that drafts a staged, conservative return-to-climbing plan
              for the three most common climbing injuries: finger pulley strain, climber&apos;s
              elbow, and shoulder impingement. A visitor fills a structured form — injury, onset,
              symptoms, pain behavior, pre-injury grade, goals — and three AI agents run in
              sequence, streaming the plan in as graded stages. Unlike Panel and Carryover,
              Tony&apos;s downloadable desktop apps, it runs right here in the browser on the
              portfolio&apos;s own NestJS API, Anthropic client, throttler, and Prisma database —
              nothing new to operate.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat architecture.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              Three Claude agents run in sequence per request, each scoped by its own prompt kept
              as a markdown skill file on disk — the same pattern as Panel and Carryover.
            </p>
            <ol className="mt-4 space-y-4">
              {AGENTS.map((agent, index) => (
                <li key={agent.name} className="flex gap-3 border-l border-term-border pl-4">
                  <span aria-hidden="true" className="text-term-muted tabular-nums">
                    {index + 1}.
                  </span>
                  <div>
                    <p className="text-term-sm font-bold text-term-ink">{agent.name}</p>
                    <p className="mt-1 text-term-sm leading-relaxed text-term-body">{agent.role}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat guardrails.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              A public AI demo about injuries has to be safe and cheap by design, not by hope. A
              few things are load-bearing to that:
            </p>
            <ul className="mt-4 space-y-3">
              {GUARDRAILS.map((item) => (
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
              Before engineering, Tony spent 6 years as an Occupational Therapist — he no longer
              practices, but staged, criteria-based rehab progressions were his day job.
              He&apos;s also a climber, so this is a domain he rehabs in himself. Beta ties
              those two threads together, and adds something Panel and Carryover can&apos;t: a
              zero-friction live demo. No download, no Gatekeeper — just open it in the browser.
            </p>
          </section>

          <section className="mt-10 border-t border-term-border pt-6">
            <div className="flex flex-wrap gap-3">
              <a
                href="/beta"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
              >
                [ launch beta ↗ ]
              </a>
            </div>
            <p className="mt-3 max-w-prose text-term-xs text-term-muted">
              An educational starting point, not medical advice — red-flag symptoms are pointed to a
              professional instead of a plan. Rate-limited to keep the demo budget honest; if the
              daily cap is hit, come back tomorrow.
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
