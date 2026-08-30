import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';
import { GradeGame } from './GradeGame';

/**
 * Hidden until release, matching the api's own flag. Read server side (no
 * NEXT_PUBLIC_ prefix) so the value never ships to the browser, and absent
 * means OFF so the page cannot appear by forgetting to set something.
 *
 * `notFound()` rather than a redirect or a "coming soon" panel: the route
 * should be indistinguishable from one that does not exist, since the api
 * behind it is not mounted either.
 */
const gradeGameEnabled = process.env.GRADE_GAME_ENABLED === 'true';

const title = 'Grade Guesser — a climbing grade game';
const description =
  "Read a real boulder problem and call its V grade, then see the gym's answer, how everyone else guessed, and what Claude made of the same photo.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/grade' },
  openGraph: {
    title,
    description,
    url: '/grade',
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

const HOW_IT_WORKS = [
  {
    step: 'The photo',
    detail:
      'A fixed set of real problems, each one photographed and graded by hand. You work through them one at a time, in the same order everyone else gets, and the set grows when new walls are shot.'
  },
  {
    step: 'Your guess',
    detail:
      'Nine buttons, V0 to V8. The request body is a single integer — there is no text field anywhere in this game — and the server adds one to an anonymous count for that grade. That count is the only trace a play leaves.'
  },
  {
    step: "Claude's read",
    detail:
      'The first guess on a problem sends the photo to Claude with a forced structured response: a grade, a confidence, what it noticed on the wall, and why it landed where it did. That single answer is cached and shown to everyone who plays that problem afterwards, so each problem costs exactly one model call, ever.'
  },
  {
    step: 'The verdict',
    detail:
      "The gym's grade is the scoreboard, but it is one gym's opinion. Disagreeing with it — or with Claude — is most of the fun, and a two-grade spread between reasonable climbers is completely normal."
  }
];

export default function GradePage() {
  if (!gradeGameEnabled) notFound();

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
        {/*
          The page owns the chrome; the game owns itself. GradeGame imports
          nothing from this shell, so re-mounting it under a different identity
          means replacing this file only (AC-10).
        */}
        <TerminalWindow path="tonychou@portfolio:~/grade$">
          <GradeGame />
        </TerminalWindow>

        <TerminalWindow path="tonychou@portfolio:~/grade/how-it-works$" className="mt-8">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat how-it-works.txt
          </p>
          <h2 className="mt-4 text-term-xl font-bold text-term-ink">How the game works</h2>
          <ol className="mt-6 space-y-5">
            {HOW_IT_WORKS.map((item, index) => (
              <li key={item.step} className="flex gap-3 border-l border-term-border pl-4">
                <span aria-hidden="true" className="text-term-muted tabular-nums">
                  {index + 1}.
                </span>
                <div>
                  <p className="text-term-sm font-bold text-term-ink">{item.step}</p>
                  <p className="mt-1 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <section className="mt-10">
            <p className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-is-stored.txt
            </p>
            <h2 className="mt-4 text-term-xl font-bold text-term-ink">What gets stored</h2>
            <p className="mt-2 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
              Per problem, the server keeps one row: Claude&apos;s analysis of that photo, a count
              of how many people guessed each grade, and how many played. That is the whole
              record. There is no account, no cookie for the game, no identifier of any kind, and
              no free-text field for anything to be typed into. Which problems you have read, and
              the reveals themselves, live in this browser&apos;s local storage and are never
              transmitted.
            </p>
          </section>

          <section className="mt-10">
            <p className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat also-here.txt
            </p>
            <p className="mt-4 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
              If the climbing angle is what brought you here, Beta is the serious version:{' '}
              <Link
                href="/projects/beta"
                className="text-term-ink underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:decoration-term-accent"
              >
                an AI return-to-climbing rehab planner
              </Link>{' '}
              with hard safety rails, built on the same api as this game.
            </p>
          </section>
        </TerminalWindow>
      </main>
    </div>
  );
}
