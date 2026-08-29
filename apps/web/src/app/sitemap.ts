import type { MetadataRoute } from 'next';
import { LIVE_APPS, PROJECTS } from '@/lib/projects';
import { siteUrl } from '@/lib/site';

/**
 * Derived from the same list the projects section renders, so a new case
 * study is announced by adding it there rather than by remembering this file.
 * The hand written version of this list had fallen three projects behind.
 *
 * `/internal` is absent on purpose and stays absent: robots.ts disallows it,
 * and listing it here would undo that.
 */

/**
 * Grade Guesser only exists when its flag is on; the page itself answers 404
 * otherwise. Read the same variable the page and the teaser read, so the
 * route is announced and served under exactly one condition. Announcing a
 * route that answers 404 is worse than not announcing it.
 */
const gradeGameEnabled = process.env.GRADE_GAME_ENABLED === 'true';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const home = {
    url: siteUrl,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 1
  };

  // The dashboard rewrites itself every six hours, so it is the one page here
  // that genuinely changes daily.
  const liveApps = LIVE_APPS.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency: path === '/streamflow' ? ('daily' as const) : ('monthly' as const),
    priority: 0.7
  }));

  const caseStudies = PROJECTS.map((project) => ({
    url: `${siteUrl}${project.href}`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.6
  }));

  const deepDives = PROJECTS.flatMap((project) => project.subPages ?? []).map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.5
  }));

  const grade = gradeGameEnabled
    ? [
        {
          url: `${siteUrl}/grade`,
          lastModified,
          changeFrequency: 'monthly' as const,
          priority: 0.5
        }
      ]
    : [];

  return [home, ...liveApps, ...caseStudies, ...deepDives, ...grade];
}
