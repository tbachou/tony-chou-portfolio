import Link from 'next/link';
import { TerminalWindow } from './TerminalWindow';

type Project = {
  slug: string;
  name: string;
  pitch: string;
  status: string;
  href: string;
};

const PROJECTS: Project[] = [
  {
    slug: 'beta',
    name: 'beta/',
    pitch:
      'An AI return-to-climbing rehab planner - three agents with hard safety rails, live in the browser.',
    status: 'live',
    href: '/projects/beta'
  },
  {
    slug: 'panel',
    name: 'panel/',
    pitch: 'A local-first, multi-agent code review companion for git repos.',
    status: 'in progress',
    href: '/projects/panel'
  },
  {
    slug: 'carryover',
    name: 'carryover/',
    pitch: 'A drafting aid for OT/PT clinicians building home exercise program handouts.',
    status: 'in progress',
    href: '/projects/carryover'
  }
];

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
            <li key={project.slug} className="border border-term-border p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-term-base font-bold text-term-ink">{project.name}</h3>
                <span className="text-term-xs uppercase tracking-wide text-term-muted">
                  [ {project.status} ]
                </span>
              </div>
              <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
                {project.pitch}
              </p>
              <Link
                href={project.href}
                className="mt-4 inline-flex text-term-sm text-term-ink transition-colors duration-term-instant hover:text-term-accent"
              >
                [ view case study → ]
              </Link>
            </li>
          ))}
        </ul>
      </TerminalWindow>
    </section>
  );
}
