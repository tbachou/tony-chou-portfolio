'use client';

import { contactInfo } from '@/lib/resume-data';
import { FeedbackForm } from './FeedbackForm';
import { TerminalWindow } from './TerminalWindow';

export function ContactSection() {
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
        <p className="mt-3 max-w-[39rem] text-term-base leading-relaxed text-term-body">
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
        <p className="mt-3 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
          This site is hand-built — Next.js and Tailwind up front, NestJS behind it.
        </p>

        <h3 className="mt-10 text-term-sm font-normal text-term-muted">
          <span aria-hidden="true">$ </span>
          cat feedback.txt
        </h3>
        <p className="mt-3 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
          Spot a bug or have a feature idea? Send it anonymously below — no account or email
          required. The message is stored, run through an automated classifier on AWS, and
          emailed to me.
        </p>
        <FeedbackForm source="portfolio" variant="terminal" className="mt-4 max-w-[39rem]" />
      </TerminalWindow>
    </section>
  );
}
