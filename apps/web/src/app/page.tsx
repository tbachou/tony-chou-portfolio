'use client';

import dynamic from 'next/dynamic';
import { ConversationPanel } from '@/components/ConversationPanel';

// The 3D canvas touches the WebGL context on mount; skip server rendering
// so there's nothing to hydrate against.
const InterviewRoom = dynamic(() => import('@/components/InterviewRoom'), { ssr: false });

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-8">
        <span className="text-sm font-medium tracking-wide text-foreground">Tony Chou</span>
        <span className="text-xs text-muted">Senior Software Engineer</span>
      </header>

      <main id="main-content">
        <section className="mx-auto max-w-3xl px-6 pb-10 pt-6 sm:px-8 sm:pb-14 sm:pt-10">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-interviewer">
            Interactive portfolio
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-foreground sm:text-5xl">
            Watch an AI interview me about my actual work.
          </h1>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-muted sm:text-lg">
            Pick a topic below. An AI interviewer and an AI version of me talk it through, a few
            exchanges at a time &mdash; every claim checked against what I actually built, git
            history and all, never inflated for a better story.
          </p>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-16 sm:px-8 sm:pb-24 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:items-start md:gap-8">
          <div className="order-2 md:order-1 md:sticky md:top-8">
            <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_60px_-15px_rgba(91,127,255,0.35)]">
              <InterviewRoom />
            </div>
            <p className="mt-3 text-xs text-muted">
              A live, low-fi 3D preview of the room &mdash; drag to look around.
            </p>
          </div>

          <div className="order-1 md:order-2">
            <ConversationPanel />
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 sm:px-8">
        <p className="text-xs text-muted">
          Built with a NestJS backend, streamed live from Claude. No answer here claims more
          credit than the real, git-verified story allows.
        </p>
      </footer>
    </div>
  );
}
