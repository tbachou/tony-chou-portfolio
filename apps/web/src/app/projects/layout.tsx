import { ResumeModalProvider } from '@/components/ResumeModalProvider';
import { SiteNav } from '@/components/SiteNav';

/**
 * The site's own nav on every case study, rather than a single back link.
 *
 * Each of these pages used to open with `$ cd ~/portfolio/projects` and
 * nothing else. It is the right joke for a terminal site, but it is not
 * legible as navigation: it does not look like a control, it says nothing
 * about where else you could go, and a visitor arriving from search or a
 * shared link had one exit from the whole site. The real nav answers all
 * three, and it is the row they already know from the home page.
 *
 * `ResumeModalProvider` comes with it because the nav's `[ resume ]` button
 * reads that context and `useResumeModal` throws without it. Wrapping here
 * rather than per page means a new case study gets both by existing.
 *
 * A layout under `projects/` rather than the root layout, deliberately.
 * `/beta` has its own visual identity and must not inherit the terminal
 * chrome, and `/internal` is an authenticated admin surface with no reason
 * to advertise the portfolio's sections.
 */
export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ResumeModalProvider>
      <SiteNav />
      {children}
    </ResumeModalProvider>
  );
}
