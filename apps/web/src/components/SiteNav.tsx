'use client';

import { usePathname } from 'next/navigation';
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

/**
 * Highlights whichever section is crossing the vertical center of the viewport
 * as you scroll.
 *
 * Only the home page has those sections. On a subpage the observer would find
 * nothing to watch and every item would sit inactive, which is the right answer
 * there anyway: you are not in any of them.
 */
function useActiveSection(enabled: boolean): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (sections.length === 0) return;

    // Which sections are currently crossing the centre line, kept across
    // callbacks. An IntersectionObserver batch only carries the sections
    // whose state CHANGED, so a callback can be nothing but "#about just
    // left" while "#projects" is still there from an earlier batch —
    // reading the batch alone would clear a section that is still current.
    // Tracking the set makes "nothing is intersecting" a real question we
    // can answer, which is what the clear has to be gated on.
    const intersecting = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) intersecting.add(entry.target.id);
          else intersecting.delete(entry.target.id);
        }
        // The -50%/-50% rootMargin collapses the root to a single line, so
        // at most one section can be on it — but there are real moments
        // when NONE is: the hero above #about (which has no id and so is
        // never observed), and the gaps at either end of the page. Those
        // are exactly the moments the nav used to keep claiming you were
        // in a section you had already scrolled out of, aria-current and
        // all. Clearing only on an empty set means normal section-to-
        // section scrolling — where the incoming section is added in the
        // same batch the outgoing one is removed — never flickers through
        // null. `find` over `sections` rather than the Set's own order so
        // that if the line ever does hold two, document order decides.
        const current = sections.find((section) => intersecting.has(section.id));
        setActiveId(current ? current.id : null);
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [enabled]);

  return activeId;
}

export function SiteNav() {
  const { open } = useResumeModal();

  /**
   * The nav is one component on every page, and the links have to change
   * shape off the home page.
   *
   * Every section it points at lives on `/`, so a bare `#about` is only a
   * real link there. On a case study it would look identical and do nothing,
   * scrolling to an anchor that does not exist, which is worse than no nav at
   * all. Prefixing with `/` makes each one navigate home and then scroll.
   */
  const pathname = usePathname();
  const isHome = pathname === '/';
  const to = (fragment: string) => (isHome ? fragment : `/${fragment}`);

  const activeId = useActiveSection(isHome);

  return (
    <header className="sticky top-0 z-20 border-b border-term-border bg-[color:var(--chrome-bg)] backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-0">
        <a href={to('#top')} className="text-term-sm text-term-muted">
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
                    href={to(link.href)}
                    aria-current={isActive ? 'true' : undefined}
                    className={
                      // The active item carries no text-colour utility on
                      // purpose: `.terminal-select[aria-current]` in
                      // terminal.css owns BOTH channels for it, off the
                      // --select-current-bg/-fg pair. That pair is where the
                      // per-palette difference lives — a filled block on the
                      // light printout (where ink vs muted is only 1.77:1 and
                      // could not be seen), plain brighter ink on the CRT
                      // (where the same pair is 2.86:1 and always read fine).
                      // Adding `text-term-ink` here would be a dead class the
                      // stylesheet outranks, and putting the light/dark split
                      // in this component instead of the palette blocks would
                      // move an art-direction decision out of design.md's
                      // token layer. `aria-current` is set independently of
                      // all of it, so dark losing the fill never costs the
                      // announced state.
                      isActive ? 'terminal-select' : 'terminal-select text-term-muted'
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
                className="terminal-select text-term-ink"
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
