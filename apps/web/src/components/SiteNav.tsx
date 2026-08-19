'use client';

import { useEffect, useState } from 'react';
import { useResumeModal } from './ResumeModalProvider';
import { ThemeToggle } from './ThemeToggle';

const NAV_LINKS = [
  { href: '#about', label: 'about' },
  { href: '#projects', label: 'projects' },
  { href: '#interview', label: 'interview' },
  { href: '#contact', label: 'contact' }
];

const SECTION_IDS = NAV_LINKS.map((link) => link.href.slice(1));

/** Highlights whichever section is crossing the vertical center of the viewport as you scroll. */
function useActiveSection(): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return activeId;
}

export function SiteNav() {
  const { open } = useResumeModal();
  const activeId = useActiveSection();

  return (
    <header className="sticky top-0 z-20 border-b border-term-border bg-[color:var(--chrome-bg)] backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-0">
        <a href="#top" className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          tonychou@portfolio:~
        </a>
        <nav aria-label="Section navigation">
          {/* gap-x-4 rather than the gap-x-5 this row used before the theme
              control joined it. The row has to fit inside the same 896px
              max-w-4xl the content columns use (widening it would unalign
              the nav from the TerminalWindow edges below), and with eight
              items that is seven gaps — dropping each by 4px buys back 28px
              of the headroom the control spent. Measured: the row needs
              857px at gap-x-5 and 829px here, against the 896px cap. */}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-term-sm">
            {NAV_LINKS.map((link) => {
              const isActive = activeId === link.href.slice(1);
              return (
                <li key={link.href}>
                  <a
                    href={link.href}
                    aria-current={isActive ? 'true' : undefined}
                    className={
                      isActive
                        ? 'text-term-ink transition-colors duration-term-instant'
                        : 'text-term-muted transition-colors duration-term-instant hover:text-term-ink'
                    }
                  >
                    [ {link.label} ]
                  </a>
                </li>
              );
            })}
            <li aria-hidden="true" className="text-term-border">
              |
            </li>
            <li>
              <button
                type="button"
                onClick={open}
                className="text-term-ink transition-colors duration-term-instant hover:text-term-accent"
              >
                [ resume ]
              </button>
            </li>
            <li aria-hidden="true" className="text-term-border">
              |
            </li>
            <li>
              <ThemeToggle />
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
