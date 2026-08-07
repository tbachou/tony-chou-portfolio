import { AboutSection } from '@/components/AboutSection';
import { ContactSection } from '@/components/ContactSection';
import { ConversationPanel } from '@/components/ConversationPanel';
import { ResumeSection } from '@/components/ResumeSection';
import { SiteNav } from '@/components/SiteNav';

export default function HomePage() {
  return (
    <div id="top" className="min-h-dvh bg-background text-foreground">
      <SiteNav />

      <main>
        <section className="mx-auto max-w-3xl px-6 pb-10 pt-14 sm:px-8 sm:pb-14 sm:pt-20">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-interviewer">Interactive portfolio</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-foreground sm:text-5xl">
            Watch an AI interview me about my actual work.
          </h1>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-muted sm:text-lg">
            Pick a topic below. An AI interviewer and an AI version of me talk it through, a few
            exchanges at a time — every claim checked against what I actually built, git history
            and all, never inflated for a better story.
          </p>
        </section>

        <AboutSection />

        <section id="interview" className="mx-auto max-w-3xl scroll-mt-20 px-6 py-16 sm:px-8 sm:py-24">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-interviewer">Interview</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl">Live interview</h2>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted sm:text-base">
            Streamed live from Claude, grounded in the real stories below — no answer here claims
            more credit than the git-verified history allows.
          </p>
          <div className="mt-8">
            <ConversationPanel />
          </div>
        </section>

        <ResumeSection />
        <ContactSection />
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
