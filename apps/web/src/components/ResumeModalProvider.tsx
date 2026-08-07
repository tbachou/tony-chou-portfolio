'use client';

import { createContext, useCallback, useContext, useRef } from 'react';
import { RESUME_PDF_PATH, education, experience } from '@/lib/resume-data';
import { TerminalWindow } from './TerminalWindow';

const ResumeModalContext = createContext<{ open: () => void } | null>(null);

export function useResumeModal() {
  const ctx = useContext(ResumeModalContext);
  if (!ctx) {
    throw new Error('useResumeModal must be used within ResumeModalProvider');
  }
  return ctx;
}

export function ResumeModalProvider({ children }: { children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const open = useCallback(() => dialogRef.current?.showModal(), []);
  const close = useCallback(() => dialogRef.current?.close(), []);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) close();
  }

  return (
    <ResumeModalContext.Provider value={{ open }}>
      {children}

      <dialog
        ref={dialogRef}
        onClick={handleBackdropClick}
        aria-label="Résumé"
        className="m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-term-canvas/85 open:flex open:items-start open:justify-center open:overflow-y-auto open:p-4 sm:open:items-center sm:open:p-8"
      >
        <TerminalWindow
          path="tonychou@portfolio:~/resume$"
          className="max-h-full max-w-2xl overflow-y-auto bg-term-canvas"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-term-xl font-bold text-term-ink terminal-glow">Résumé</h2>
            <div className="flex shrink-0 gap-3">
              <a
                href={RESUME_PDF_PATH}
                download
                className="text-term-sm text-term-ink underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:decoration-term-accent"
              >
                [ DOWNLOAD PDF ]
              </a>
              <button
                type="button"
                onClick={close}
                className="text-term-sm text-term-muted transition-colors duration-term-instant hover:text-term-ink"
              >
                [ CLOSE ]
              </button>
            </div>
          </div>

          <ol className="mt-8 space-y-8">
            {experience.map((entry) => (
              <li key={`${entry.org}-${entry.dates}`} className="border-l border-term-border pl-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-term-base font-bold text-term-ink">
                    {entry.org} <span className="font-normal text-term-muted">— {entry.role}</span>
                  </h3>
                  <span className="text-term-xs tabular-nums text-term-muted">{entry.dates}</span>
                </div>
                {entry.context ? <p className="mt-1 text-term-xs italic text-term-muted">{entry.context}</p> : null}
                {entry.stack ? (
                  <p className="mt-2 text-term-xs text-term-muted">{entry.stack.join(' · ')}</p>
                ) : null}
                <ul className="mt-3 space-y-1.5">
                  {entry.bullets.map((bullet, index) => (
                    <li key={index} className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                      <span aria-hidden="true" className="text-term-muted">
                        ›
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <div className="mt-8 border-l border-term-border pl-4">
            <p className="text-term-xs uppercase tracking-wide text-term-muted">Education</p>
            <h3 className="mt-1 text-term-sm font-bold text-term-ink">{education.degree}</h3>
            <p className="text-term-sm text-term-muted">{education.school}</p>
          </div>
        </TerminalWindow>
      </dialog>
    </ResumeModalContext.Provider>
  );
}
