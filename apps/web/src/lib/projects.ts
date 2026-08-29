/**
 * The case studies, in the order the projects list shows them.
 *
 * Lives here rather than inside `ProjectsSection` because two surfaces need
 * it and they must not disagree: the list a visitor scrolls, and the sitemap
 * that tells search engines the pages exist. The sitemap was previously a
 * hand written copy and had silently fallen three projects behind.
 */
export type Project = {
  slug: string;
  name: string;
  pitch: string;
  status: string;
  href: string;
  /**
   * Pages that live under this case study and deserve their own sitemap
   * entry. Declared here so a new deep dive is listed by adding it to the
   * project it belongs to, rather than by remembering the sitemap exists.
   */
  subPages?: string[];
};

export const PROJECTS: Project[] = [
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
  },
  {
    slug: 'streamflow',
    name: 'streamflow/',
    pitch:
      'A river forecasting pipeline that scores every prediction it has ever made, in public.',
    status: 'live',
    href: '/projects/streamflow',
    subPages: ['/projects/streamflow/walkthrough']
  },
  {
    slug: 'aws-genai',
    name: 'aws-genai/',
    pitch:
      'The event-driven GenAI infrastructure behind this site - Terraform, SNS, Lambda, Bedrock, SES.',
    status: 'live',
    href: '/projects/aws-genai'
  }
];

/**
 * The live things a visitor can actually use, as opposed to read about.
 *
 * Separate from the case studies because they rank differently and change at
 * a different rate: the streamflow dashboard rewrites itself every six hours,
 * while a case study is edited a few times a year. `/beta` keeps its own
 * visual identity and opens as a site of its own, which is exactly why it
 * needs its own sitemap entry rather than being folded into its case study.
 */
export const LIVE_APPS = ['/beta', '/streamflow'];
