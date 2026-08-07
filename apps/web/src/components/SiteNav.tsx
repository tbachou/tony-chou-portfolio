'use client';

import { useResumeModal } from './ResumeModalProvider';
import { useSiteIntro } from './SiteIntroProvider';

const NAV_LINKS = [
  { href: '#about', label: 'about' },
  { href: '#interview', label: 'interview' },
  { href: '#contact', label: 'contact' }
];

export function SiteNav() {
  const { open } = useResumeModal();
  const { reenter } = useSiteIntro();

  return (
    <header className="sticky top-0 z-20 border-b border-term-border bg-term-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-0">
        <a href="#top" className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          tonychou@portfolio:~
        </a>
        <nav aria-label="Section navigation">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-term-sm">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-term-muted transition-colors duration-term-instant hover:text-term-ink"
                >
                  [ {link.label} ]
                </a>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={open}
                className="text-term-ink transition-colors duration-term-instant hover:text-term-accent"
              >
                [ resume ]
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={reenter}
                className="text-term-muted transition-colors duration-term-instant hover:text-term-ink"
              >
                [ zoom out ]
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
