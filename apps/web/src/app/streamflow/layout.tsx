import { ResumeModalProvider } from '@/components/ResumeModalProvider';
import { SiteNav } from '@/components/SiteNav';

/**
 * The same nav the case studies get, for the same reason.
 *
 * This page is not a case study, but it had the identical problem: one
 * `$ cd ~/portfolio` link at the top and no other way back into the site.
 * It is also the page most likely to be linked to directly, since it is the
 * one with something live on it, so it is the worst place to leave a visitor
 * with a single unlabelled exit.
 *
 * See `app/projects/layout.tsx` for why this is a per route layout rather
 * than something higher up.
 */
export default function StreamflowLayout({
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
