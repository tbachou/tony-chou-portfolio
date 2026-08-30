import { AboutSection } from '@/components/AboutSection';
import { ContactSection } from '@/components/ContactSection';
import { ConversationPanel } from '@/components/ConversationPanel';
import { ProjectsSection } from '@/components/ProjectsSection';
import { ResumeModalProvider } from '@/components/ResumeModalProvider';
import { DeskSceneProvider } from '@/components/DeskSceneProvider';
import { SiteNav } from '@/components/SiteNav';
import { TerminalWindow } from '@/components/TerminalWindow';
import { aboutSummary, contactInfo } from '@/lib/resume-data';
import { siteUrl } from '@/lib/site';

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Tony Chou',
  jobTitle: 'Senior Software Engineer',
  description: aboutSummary,
  url: siteUrl,
  email: `mailto:${contactInfo.email}`,
  sameAs: [contactInfo.linkedin],
  address: {
    '@type': 'PostalAddress',
    addressLocality: contactInfo.location
  }
};

export default function HomePage() {
  return (
    <DeskSceneProvider>
      <ResumeModalProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
        />
        <div id="top">
          <SiteNav />

          <main>
            <section className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 py-10 sm:px-0 sm:py-14">
              <TerminalWindow path="tonychou@portfolio:~$">
                <p className="text-term-sm text-term-muted">
                  <span aria-hidden="true">$ </span>
                  whoami
                </p>
                <h1 className="mt-2 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
                  Tony Chou
                </h1>
                <p className="mt-1 text-term-base text-term-body">
                  Senior Software Engineer — TypeScript, React &amp; AI-integrated products
                </p>

                <p className="mt-8 text-term-sm text-term-muted">
                  <span aria-hidden="true">$ </span>
                  cat mission.txt
                </p>
                <p className="mt-2 max-w-[39rem] text-term-base leading-relaxed text-term-body">
                  I ship production AI features and real-time systems for growth-stage teams — AI
                  content generation at Mailchimp, collaborative editing at Product Forge, trading
                  analytics at Topstep. Six years in, still happiest when I own a problem end to
                  end.
                </p>

                <a
                  href="#interview"
                  className="mt-8 inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
                >
                  [ talk to ai-tony → ]
                </a>
              </TerminalWindow>
            </section>

            <AboutSection />

            <ProjectsSection />

            <section
              id="interview"
              className="mx-auto flex min-h-dvh max-w-4xl scroll-mt-20 flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
            >
              <h2 className="sr-only">Interview</h2>
              <ConversationPanel />
            </section>

            <ContactSection />
          </main>

          <footer className="mx-auto max-w-4xl px-4 pb-10 sm:px-0">
            <p className="text-term-xs text-term-muted">
              Built with a NestJS backend, streamed live from Claude. No answer here claims more
              credit than the real, git-verified story allows.
            </p>
          </footer>
        </div>
      </ResumeModalProvider>
    </DeskSceneProvider>
  );
}
