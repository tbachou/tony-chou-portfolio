import { RESUME_PDF_PATH, education, experience } from '@/lib/resume-data';

export function ResumeSection() {
  return (
    <section id="resume" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 sm:px-8 sm:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-interviewer">Resume</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl">Experience</h2>
        </div>
        <a
          href={RESUME_PDF_PATH}
          download
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-foreground transition-colors hover:border-white/30 hover:bg-white/5"
        >
          Download PDF
          <span aria-hidden="true">↓</span>
        </a>
      </div>

      <ol className="mt-10 space-y-10">
        {experience.map((entry) => (
          <li key={`${entry.org}-${entry.dates}`} className="border-l border-white/10 pl-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-lg font-medium text-foreground">
                {entry.org} <span className="font-normal text-muted">— {entry.role}</span>
              </h3>
              <span className="text-sm tabular-nums text-muted">{entry.dates}</span>
            </div>
            {entry.context ? <p className="mt-1 text-sm italic text-muted">{entry.context}</p> : null}
            {entry.stack ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {entry.stack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            ) : null}
            <ul className="mt-4 space-y-2">
              {entry.bullets.map((bullet, index) => (
                <li key={index} className="flex gap-2 text-sm leading-relaxed text-muted">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/30" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="mt-10 border-l border-white/10 pl-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Education</p>
        <h3 className="mt-2 text-base font-medium text-foreground">{education.degree}</h3>
        <p className="text-sm text-muted">{education.school}</p>
      </div>
    </section>
  );
}
