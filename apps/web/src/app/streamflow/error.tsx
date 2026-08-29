'use client';

import { TerminalWindow } from '@/components/TerminalWindow';

/**
 * What a visitor gets when the store will not answer.
 *
 * Without this the route falls back to Next's own unbranded page: no nav, no
 * theme, and "A server error occurred" as the whole explanation. This page
 * reads a live database on every request, so an outage here is a normal
 * event rather than an exceptional one, and it should look like the rest of
 * the site while it lasts.
 *
 * The message itself is deliberately not rendered. Next replaces it with a
 * generic string in production anyway, and the digest is the part that can
 * actually be matched against a server log.
 */
export default function StreamflowError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-dvh">
      <main
        id="main-content"
        className="mx-auto max-w-4xl px-4 py-10 sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/streamflow$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            read --gauge active
          </p>
          <h1 className="mt-4 text-term-lg font-bold text-term-ink terminal-glow">
            The store did not answer
          </h1>
          <p className="mt-3 max-w-2xl text-term-sm text-term-body">
            This page is drawn from a live database on every request, so there
            is nothing cached to fall back on. The pipeline itself is a
            scheduled job and keeps running without the page: whatever the
            river did while this was down is still being recorded, and will be
            here when the read succeeds.
          </p>

          <div className="mt-6 border-t border-term-border pt-5">
            <button
              type="button"
              onClick={reset}
              className="terminal-select text-term-sm text-term-ink"
            >
              [ try the read again ]
            </button>
          </div>

          {error.digest && (
            <p className="mt-6 text-term-xs text-term-muted">
              reference{' '}
              <span className="tabular-nums text-term-body">
                {error.digest}
              </span>
            </p>
          )}
        </TerminalWindow>
      </main>
    </div>
  );
}
