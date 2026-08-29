import { TerminalWindow } from '@/components/TerminalWindow';

/**
 * What fills the page while the store is being read.
 *
 * The page is `force-dynamic` and blocks on several reads of a hosted
 * Postgres before it renders anything, so without this a visitor gets the
 * previous page for as long as that takes. The layout's nav renders around
 * it, so the site does not disappear while it waits.
 */
export default function StreamflowLoading() {
  return (
    <div className="min-h-dvh">
      <main
        id="main-content"
        className="mx-auto max-w-4xl px-4 py-10 sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/streamflow$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            read --gauge active --window 30d
          </p>
          <p
            className="mt-4 text-term-sm text-term-ink"
            role="status"
            aria-live="polite"
          >
            READING THE STORE
            <span className="terminal-cursor" aria-hidden="true" />
          </p>
          <p className="mt-3 max-w-2xl text-term-sm text-term-muted">
            A month of readings, the current forecasts, and every score the
            pipeline has written since. Nothing here is cached: the answer
            depends on when you ask, which is the point of the page.
          </p>
        </TerminalWindow>
      </main>
    </div>
  );
}
