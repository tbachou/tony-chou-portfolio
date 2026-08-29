import type { Metadata } from 'next';
import { BackToProjects } from '@/components/BackToProjects';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';

const SOURCE_URL = 'https://github.com/tbachou/carryover';
// GitHub's "latest release" alias - always resolves to whatever the newest
// release's asset with this exact name is, so cutting a new release never
// requires touching this file (see electron-builder.yml's artifactName).
const DOWNLOAD_URL = 'https://github.com/tbachou/carryover/releases/latest/download/Carryover-arm64.dmg';

const title = 'Carryover — Project Case Study';
const description =
  'Carryover is a drafting aid for OT/PT clinicians building home exercise program handouts, built as a standalone Electron app. Early release (v0.1.0) — a personal tool, still actively evolving.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/carryover' },
  openGraph: {
    title,
    description,
    url: '/projects/carryover',
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
    name: 'Exercise Selection agent',
    role: 'Drafts a candidate set of exercises against the case profile — functional presentation, goals, cognitive/mobility level.'
  },
  {
    name: 'Safety & Precautions agent',
    role: 'Checks the draft against the entered precautions and flags anything that conflicts.'
  },
  {
    name: 'Patient Instructions agent',
    role: 'Drafts plain-language, patient-facing instructions for each selected exercise.'
  },
  {
    name: 'Orchestrator agent',
    role: 'Merges the three specialist drafts into one coherent handout for clinician review.'
  }
];

const GUARDRAILS = [
  'No diagnosis field, by design — the case profile captures functional presentation, precautions, goals, and cognitive/mobility level, not a diagnosis. This keeps the tool clearly on the drafting-aid side of the line, not diagnosing or delivering treatment.',
  'Every generated exercise is labeled "suggested," never presented as a finished recommendation.',
  'Each suggested item requires explicit per-item acceptance before it can be included in a handout.',
  'Nothing is exportable or printable until an explicit sign-off: "I am the treating clinician and have reviewed this draft."'
];

export default function CarryoverProjectPage() {
  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[46rem] px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/projects/carryover$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat status.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-accent">
            [ v0.1.0 — early release, personal tool ]
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Carryover
          </h1>
          <p className="mt-1 max-w-prose text-term-base text-term-body">
            A drafting aid for OT/PT clinicians building home exercise program handouts.
          </p>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-it-does.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
              Carryover is a standalone Electron app, separate from this portfolio&apos;s codebase.
              A clinician enters a case profile — functional presentation, precautions, goals, and
              cognitive/mobility level — and the app drafts a home exercise program (HEP) handout
              for review. It&apos;s built on the same local-first, multi-agent architecture pattern
              as Panel, Tony&apos;s other project here.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat architecture.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              Four Claude agents run per draft: three specialists work the case profile
              concurrently, and a fourth orchestrator merges their output into one handout.
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
              This is a drafting aid, not a clinical decision system. A few things are load-bearing
              to that:
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
              Before engineering, Tony spent 6 years as an Occupational Therapist in neuro rehab
              and skilled nursing — M.S. in Occupational Therapy from Ohio State, no longer in
              clinical practice. Carryover comes directly out of that background: home exercise
              program handouts are a real, recurring drafting task in OT/PT practice.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              ls demo/
            </h2>
            <div className="mt-3 border border-term-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF, next/image would strip motion */}
              <img
                src="/carryover-demo.gif"
                alt="Carryover drafting a home exercise program: a case profile is filled in, three agents run (exercise selection, safety review, patient instructions), then a draft handout appears with clinician-review flags and exercise cards awaiting sign-off."
                className="w-full"
              />
            </div>
          </section>

          <section className="mt-10 border-t border-term-border pt-6">
            <div className="flex flex-wrap gap-3">
              <a
                href={SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
              >
                [ source → ]
              </a>
              <a
                href={DOWNLOAD_URL}
                className="inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
              >
                [ download → ]
              </a>
            </div>
            <p className="mt-3 max-w-prose text-term-xs text-term-muted">
              macOS (Apple Silicon) only. Ad-hoc signed, not notarized — right-click the app and
              choose &quot;Open&quot; the first time to get past Gatekeeper. If macOS still calls
              it damaged, that&apos;s the quarantine flag, not a corrupt download — clear it in
              Terminal: <code>xattr -d com.apple.quarantine /Applications/Carryover.app</code>.
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
