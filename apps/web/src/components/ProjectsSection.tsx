import Link from 'next/link';
import { PROJECTS } from '@/lib/projects';
import { TerminalWindow } from './TerminalWindow';

/**
 * The one line teaser for Grade Guesser (spec 0006, AC-12).
 *
 * Read server side, exactly as `/grade/page.tsx` reads it, so the teaser and
 * the route it points at appear and disappear together. Absent means OFF, so
 * the link cannot outlive the page and leave a 404 on the front door.
 *
 * A callout rather than a fifth entry in the list above, because the list is
 * case studies and this is a thing you play. Wording carries no "today":
 * there is no daily problem any more (AC-12, revised 2026-08-22).
 */
const gradeGameEnabled = process.env.GRADE_GAME_ENABLED === 'true';

export function ProjectsSection() {
  return (
    <section
      id="projects"
      className="mx-auto flex min-h-dvh max-w-4xl scroll-mt-20 flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
    >
      <TerminalWindow path="tonychou@portfolio:~/projects$">
        <h2 className="text-term-sm font-normal text-term-muted">
          <span aria-hidden="true">$ </span>
          ls projects/
        </h2>

        <ul className="mt-4 space-y-4">
          {PROJECTS.map((project) => (
            // The whole card is the click target, but only the link below is a
            // real link: its ::after stretches over the card. Wrapping the card
            // in an anchor instead would give it one accessible name made of
            // the title, status, pitch and label read as a single run.
            <li
              key={project.slug}
              className="relative border border-term-border p-4 transition-colors duration-term-instant hover:border-term-accent has-[a:focus-visible]:border-term-accent sm:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-term-base font-bold text-term-ink">{project.name}</h3>
                <span className="text-term-xs uppercase tracking-wide text-term-muted">
                  [ {project.status} ]
                </span>
              </div>
              <p className="mt-2 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
                {project.pitch}
              </p>
              {/* hover:text-term-accent was a no-op: --color-accent aliases
                  --color-ink, so this text hovered to the colour it already
                  had. Underline is the channel the nav settled on for the
                  same reason. */}
              <Link
                href={project.href}
                className="mt-4 inline-flex text-term-sm text-term-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                [ view case study → ]
              </Link>
            </li>
          ))}
        </ul>

        {gradeGameEnabled && (
          <p className="mt-6 border-t border-term-border pt-5 text-term-sm leading-relaxed text-term-body">
            <span aria-hidden="true" className="text-term-muted">
              ${' '}
            </span>
            Or play one:{' '}
            <Link
              href="/grade"
              className="text-term-ink underline-offset-4 hover:underline"
            >
              [ grade guesser → ]
            </Link>{' '}
            <span className="text-term-muted">
              read a real boulder problem, call its grade, then see how Claude read the same photo.
            </span>
          </p>
        )}
      </TerminalWindow>
    </section>
  );
}
