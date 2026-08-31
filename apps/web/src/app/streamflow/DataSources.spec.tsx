import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DataSources } from './DataSources';

/**
 * The licence, not the layout.
 *
 * Open-Meteo's data is CC BY 4.0, so this block is a condition of using the
 * data at all, and the failure mode is silent: a credit dropped in a copy
 * edit breaks no build, fails no typecheck, and looks like nothing on a
 * screenshot. CC BY asks for the source AND the licence, so both halves are
 * asserted here, and each by its `href` rather than by its wording, because
 * naming a licence without pointing at it is not carrying the licence.
 */
afterEach(cleanup);

function hrefOf(name: RegExp): string | null {
  return screen.getByRole('link', { name }).getAttribute('href');
}

describe('DataSources', () => {
  it('credits Open-Meteo and links to it', () => {
    render(<DataSources timeZone="America/New York" />);

    expect(hrefOf(/open-meteo/i)).toBe('https://open-meteo.com/');
  });

  it('names CC BY 4.0 and links to the licence itself', () => {
    render(<DataSources timeZone="America/New York" />);

    expect(hrefOf(/cc by 4\.0/i)).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
  });

  it('opens both credits without handing over the opener', () => {
    render(<DataSources timeZone="America/New York" />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('keeps the USGS credit the discharge data already carried', () => {
    render(<DataSources timeZone="America/New York" />);

    expect(screen.getByText(/U\.S\. Geological Survey/)).toBeTruthy();
  });

  it('says the weather rows are forecast rain, not rain that fell', () => {
    // The distinction the whole child spec turns on. A visitor reading the
    // credit should not conclude the pipeline knows what actually fell.
    render(<DataSources timeZone="America/New York" />);

    expect(screen.getByText(/never what actually fell/i)).toBeTruthy();
  });

  it('shows the timezone it was given rather than a baked in one', () => {
    render(<DataSources timeZone="Australia/Perth" />);

    expect(screen.getByText(/Australia\/Perth/)).toBeTruthy();
  });
});

/**
 * That the dashboard page still renders this at all.
 *
 * Everything above proves the component is correct. None of it proves the
 * page uses it, because every test above renders `DataSources` directly. The
 * pre deploy audit on 2026-08-31 confirmed the hole by deleting the import
 * and the JSX call from `page.tsx`: 87 tests passed, `tsc` exited 0, and lint
 * was byte for byte identical to baseline. The site would have gone out of
 * licence with the whole gate green, which is the exact failure the block
 * comment at the top of `DataSources.tsx` claims this suite prevents.
 *
 * This reads the page source rather than rendering it, and that is a
 * deliberate trade. Rendering `page.tsx` means mocking four Prisma methods,
 * six package functions and the fetch driven client panels, which would tie a
 * licence assertion to the entire data layer: it would then fail for reasons
 * that have nothing to do with the licence, and the first person to hit that
 * would delete it as flaky. A narrow assertion that survives is worth more
 * than a thorough one that gets removed.
 *
 * What it therefore does NOT catch, stated so nobody mistakes its reach: a
 * render that is present but unreachable, `{false && <DataSources />}` or a
 * branch that never runs. It catches deletion, which is the realistic edit.
 */
const PAGE = resolve(process.cwd(), 'src/app/streamflow/page.tsx');

/**
 * The page source with comments stripped, so a commented out render cannot
 * satisfy these. The line comment rule skips `://` so a URL in the source is
 * not mistaken for the start of a comment.
 *
 * `import.meta.url` is not a `file:` URL under jsdom, so the path is resolved
 * from the vitest root (`apps/web`) instead. A wrong path would make every
 * assertion below vacuous, so the marker check fails loudly rather than
 * letting the licence guard quietly test an empty string.
 */
function pageSource(): string {
  const source = readFileSync(PAGE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/.*$/gm, '');

  if (!source.includes('export default async function StreamflowPage')) {
    throw new Error(`Read the wrong file, or the page was renamed: ${PAGE}`);
  }

  return source;
}

describe('the dashboard page wiring', () => {
  it('imports DataSources', () => {
    expect(pageSource()).toMatch(
      /import\s*\{[^}]*\bDataSources\b[^}]*\}\s*from\s*'\.\/DataSources'/,
    );
  });

  it('renders DataSources, which is what actually carries the licence', () => {
    // The assertion the audit's failing input demanded: deleting the JSX call
    // must not leave the suite green.
    expect(pageSource()).toMatch(/<DataSources[\s/>]/);
  });
});
