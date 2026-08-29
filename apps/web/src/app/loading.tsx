import { TerminalWindow } from '@/components/TerminalWindow';

/**
 * The app-wide route-loading fallback. It is the one blinking cursor on
 * the screen while it is up, which is the use design.md reserves the
 * motif for.
 *
 * Terminal identity on purpose: this renders above every nested layout,
 * so it is never inside Beta's `.beta-theme` wrapper. A same-tab client
 * navigation into /beta would therefore flash terminal chrome — in
 * practice every link into /beta is a new-tab hard load, and the page
 * itself fetches nothing, so it does not suspend.
 */
export default function Loading() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
    >
      <TerminalWindow path="tonychou@portfolio:~$">
        <p className="text-term-sm text-term-muted" role="status" aria-live="polite">
          <span aria-hidden="true">$ </span>
          loading
          <span className="terminal-cursor ml-1" aria-hidden="true" />
        </p>

        {/* Three dim rules standing in for the copy that is on its way.
            Decorative only — the status line above is the announcement. */}
        <div className="mt-8 space-y-3" aria-hidden="true">
          <div className="h-3 w-1/3 bg-term-border" />
          <div className="h-3 w-full bg-term-border" />
          <div className="h-3 w-4/5 bg-term-border" />
        </div>
      </TerminalWindow>
    </main>
  );
}
