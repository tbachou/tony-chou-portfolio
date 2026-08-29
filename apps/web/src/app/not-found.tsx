import Link from 'next/link';
import { TerminalWindow } from '@/components/TerminalWindow';

/**
 * The app-wide 404. Next renders it inside the root layout only — an
 * unmatched URL matches no nested segment, so /beta/anything lands here
 * without Beta's `.beta-theme` wrapper and therefore in terminal chrome,
 * which is the identity this file is written in.
 */
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
    >
      <TerminalWindow path="tonychou@portfolio:~$">
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          cat 404.txt
        </p>

        <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
          No such file or directory
        </h1>
        <p className="mt-3 max-w-[39rem] text-term-base leading-relaxed text-term-body">
          That path is not on this machine. It may have moved, or it may never have been here.
          Everything that does exist is one directory up.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-term-sm">
          <Link href="/" className="terminal-select text-term-ink">
            [ cd ~ ]
          </Link>
          <Link href="/#projects" className="terminal-select text-term-muted">
            [ ls ~/projects ]
          </Link>
        </div>
      </TerminalWindow>
    </main>
  );
}
