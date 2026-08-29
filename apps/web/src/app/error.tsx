'use client';

import Link from 'next/link';
import { TerminalWindow } from '@/components/TerminalWindow';

/**
 * The app-wide error boundary: it catches anything thrown below the root
 * layout that no nested boundary handled.
 *
 * It renders in the terminal identity even when the route that threw was
 * /beta. Beta's whole palette hangs off the `.beta-theme` div in
 * `beta/layout.tsx` (see the `body:has(.beta-theme)` escape rules at the
 * top of `beta/beta.css`), and this boundary replaces the root layout's
 * children — that div included — so those rules simply stop matching and
 * the terminal chrome the root layout already painted comes back.
 */
export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
    >
      <TerminalWindow path="tonychou@portfolio:~$">
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          cat error.txt
        </p>

        <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
          This page threw
        </h1>
        <p className="mt-3 max-w-prose text-term-base leading-relaxed text-term-body">
          Something on this route failed while it was rendering. The rest of the site is still
          running — run it again, or head back to the start.
        </p>

        {/* Next strips the message from server errors in production and
            leaves only this hash, which is what matches a report to a log
            line. The message itself is deliberately not printed: it can
            carry whatever the failing code was holding. */}
        {error.digest && (
          <p className="mt-4 text-term-xs text-term-muted">
            digest: <span className="text-term-body">{error.digest}</span>
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[44px] items-center border border-term-accent px-4 py-2 text-term-base font-bold text-term-accent transition-colors duration-term-instant hover:bg-term-accent hover:text-term-on-accent"
          >
            [ try again ]
          </button>
          <Link href="/" className="terminal-select text-term-sm text-term-muted">
            [ cd ~ ]
          </Link>
        </div>
      </TerminalWindow>
    </main>
  );
}
