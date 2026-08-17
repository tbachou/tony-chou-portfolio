import type { Metadata } from 'next';
import { BackToProjects } from '@/components/BackToProjects';
import { RequestAccessForm } from '@/components/RequestAccessForm';
import { TerminalWindow } from '@/components/TerminalWindow';

const title = 'Panel — Project Case Study';
const description =
  'Panel is a local-first, multi-agent code review companion built as a standalone Electron app. Early-stage — walking skeleton in progress, no public release yet.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/panel' },
  openGraph: {
    title,
    description,
    url: '/projects/panel',
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
    name: 'Security agent',
    role: 'Scans the diff for vulnerabilities, unsafe patterns, and exposure risks, scoped by its own skill file.'
  },
  {
    name: 'Correctness agent',
    role: 'Checks the diff for logic errors, edge cases, and bugs against the surrounding code, scoped by its own skill file.'
  },
  {
    name: 'Simplification agent',
    role: 'Flags unnecessary complexity, duplication, and opportunities to reduce the diff, scoped by its own skill file.'
  },
  {
    name: 'Orchestrator agent',
    role: 'Merges and ranks findings from the three specialist agents into one coherent review.'
  }
];

export default function PanelProjectPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-term-border">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-0">
          <BackToProjects />
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-0 sm:py-14">
        <TerminalWindow path="tonychou@portfolio:~/projects/panel$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat status.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-accent">
            [ in progress — walking skeleton, no public release yet ]
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            Panel
          </h1>
          <p className="mt-1 max-w-prose text-term-base text-term-body">
            A local-first, multi-agent code review companion.
          </p>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-it-does.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
              Panel is a standalone Electron app, separate from this portfolio&apos;s codebase.
              Point it at a local git repo and it reviews the current diff — no cloud upload, no
              hosted service in the loop. It&apos;s a personal tool for catching what a human
              reviewer might miss before a PR goes out, built as a real testbed for multi-agent
              orchestration patterns.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat architecture.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              Four Claude agents run per review: three specialists work the diff concurrently,
              each scoped by its own skill file, and a fourth orchestrator reconciles what they
              find.
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
              ls demo/
            </h2>
            <div className="mt-3 flex min-h-[10rem] flex-col items-center justify-center border border-dashed border-term-border p-8 text-center">
              <p className="text-term-sm text-term-muted">[ demo coming soon ]</p>
              <p className="mt-1 max-w-prose text-term-xs text-term-muted">
                A screenshot or GIF of Panel reviewing a real diff will go here once there&apos;s a
                working demo to show.
              </p>
            </div>
          </section>

          <section className="mt-10 border-t border-term-border pt-6">
            <span
              aria-disabled="true"
              className="inline-flex min-h-[44px] cursor-not-allowed items-center border border-term-border px-4 py-2 text-term-base text-term-muted"
            >
              [ source — coming soon ]
            </span>
            <p className="mt-3 text-term-xs text-term-muted">
              No public repo yet — this page will link out once one exists. There&apos;s no
              packaged download either, but you can request access below; approved requests get a
              direct download link.
            </p>

            <div className="mt-5">
              <RequestAccessForm appSlug="panel" appName="Panel" />
            </div>
          </section>

          <div className="mt-10 border-t border-term-border pt-6">
            <BackToProjects />
          </div>
        </TerminalWindow>
      </main>
    </div>
  );
}
