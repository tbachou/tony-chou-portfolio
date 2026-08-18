'use client';

import { contactInfo } from '@/lib/resume-data';
import { TerminalWindow } from './TerminalWindow';
import { useSiteIntro } from './SiteIntroProvider';

export function ContactSection() {
  const { reenter } = useSiteIntro();
  return (
    <section
      id="contact"
      className="mx-auto flex min-h-dvh max-w-4xl scroll-mt-20 flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
    >
      <TerminalWindow path="tonychou@portfolio:~/contact$">
        <h2 className="text-term-sm font-normal text-term-muted">
          <span aria-hidden="true">$ </span>
          cat contact.txt
        </h2>
        <p className="mt-3 max-w-prose text-term-base leading-relaxed text-term-body">
          Open to conversations about senior engineering roles at growth-stage companies.
        </p>

        <dl className="mt-6 space-y-3 text-term-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-term-muted">email:</dt>
            <dd>
              <a
                href={`mailto:${contactInfo.email}`}
                className="text-term-ink underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:decoration-term-accent"
              >
                {contactInfo.email}
              </a>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-term-muted">linkedin:</dt>
            <dd>
              <a
                href={contactInfo.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-term-ink underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:decoration-term-accent"
              >
                linkedin.com/in/tony-chou
              </a>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-term-muted">location:</dt>
            <dd className="text-term-ink">{contactInfo.location}</dd>
          </div>
        </dl>

        <h3 className="mt-10 text-term-sm font-normal text-term-muted">
          <span aria-hidden="true">$ </span>
          cat colophon.txt
        </h3>
        <p className="mt-3 max-w-prose text-term-sm leading-relaxed text-term-body">
          This site is hand-built — Next.js and Tailwind up front, NestJS behind it, React Three
          Fiber for the one corner of 3D I couldn&apos;t resist.
        </p>
        <button
          type="button"
          onClick={reenter}
          className="mt-3 text-term-sm text-term-ink transition-colors duration-term-instant hover:text-term-accent"
        >
          [ view the 3d desk ]
        </button>
      </TerminalWindow>
    </section>
  );
}
