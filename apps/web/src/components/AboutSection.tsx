import { aboutSummary, skillGroups } from '@/lib/resume-data';
import { TerminalWindow } from './TerminalWindow';

export function AboutSection() {
  return (
    <section
      id="about"
      className="mx-auto flex min-h-dvh max-w-4xl scroll-mt-20 flex-col justify-center px-4 py-10 sm:px-0 sm:py-14"
    >
      <TerminalWindow path="tonychou@portfolio:~/about$">
        <h2 className="text-term-sm font-normal text-term-muted">
          <span aria-hidden="true">$ </span>
          cat about.txt
        </h2>
        <p className="mt-3 max-w-prose text-term-base leading-relaxed text-term-body">{aboutSummary}</p>

        <p className="mt-8 text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          ls skills/
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {skillGroups.map((group) => (
            <div key={group.label}>
              <dt className="text-term-xs uppercase tracking-wide text-term-muted">{group.label}</dt>
              <dd className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-term-sm text-term-ink">
                {group.items.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </TerminalWindow>
    </section>
  );
}
