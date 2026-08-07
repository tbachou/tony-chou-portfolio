import { aboutSummary, skillGroups } from '@/lib/resume-data';

export function AboutSection() {
  return (
    <section id="about" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 sm:px-8 sm:py-24">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-interviewer">About</p>
      <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-12">
        <p className="max-w-prose text-base leading-relaxed text-muted sm:text-lg">{aboutSummary}</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          {skillGroups.map((group) => (
            <div key={group.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">{group.label}</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground"
                  >
                    {item}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
