import { contactInfo } from '@/lib/resume-data';

export function ContactSection() {
  return (
    <section id="contact" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 sm:px-8 sm:py-24">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-interviewer">Contact</p>
      <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-snug text-foreground sm:text-3xl">
        Open to conversations about senior engineering roles at growth-stage companies.
      </h2>
      <div className="mt-8 flex flex-wrap gap-x-12 gap-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Email</p>
          <a
            href={`mailto:${contactInfo.email}`}
            className="mt-1 block text-base text-foreground underline decoration-white/20 underline-offset-4 transition-colors hover:decoration-white/60"
          >
            {contactInfo.email}
          </a>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">LinkedIn</p>
          <a
            href={contactInfo.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-base text-foreground underline decoration-white/20 underline-offset-4 transition-colors hover:decoration-white/60"
          >
            linkedin.com/in/tony-chou
          </a>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Location</p>
          <p className="mt-1 text-base text-foreground">{contactInfo.location}</p>
        </div>
      </div>
    </section>
  );
}
