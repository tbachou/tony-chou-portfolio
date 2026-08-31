import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
 * That the dashboard page actually renders this, which the suite above does
 * not prove.
 *
 * Every test above renders `DataSources` directly, so all of them pass with
 * the component orphaned. The pre deploy audit on 2026-08-31 confirmed that
 * by deleting the import and the JSX call from `page.tsx`: 87 tests passed,
 * `tsc` exited 0, and lint was byte for byte identical to baseline, so the
 * site could have gone out of licence with the whole gate green.
 *
 * The first attempt at closing it asserted against the page SOURCE TEXT, and
 * the adversarial re run took it apart, which is why this renders instead.
 * Text matching could not tell the difference between a render and a mention:
 * an aliased import (`DataSources as _Legacy`) rebinding the JSX to a stub
 * module passed, and so did a bare string containing `<DataSources />` in a
 * comment about restoring the credit. It also FAILED when the credit was
 * correctly wired, because a `/*` inside an ordinary line comment opened a
 * phantom block comment that swallowed the import. A guard that cries wolf is
 * worse than none, because it is the one that gets deleted.
 *
 * Rendering costs three module mocks and three panel stubs, and in exchange
 * it cannot be fooled by any of that: only markup that really reaches the
 * screen satisfies it.
 */
vi.mock('@/lib/streamflow-db', () => ({
  streamflowDb: () => ({
    gauge: {
      findFirst: async () => ({
        id: 'gauge-1',
        usgsSiteId: '03230500',
        name: 'Big Darby Creek at Darbyville OH',
        lat: 39.7006,
        lon: -83.1102,
        timezone: 'America/New_York',
        active: true,
      }),
    },
    observation: { count: async () => 0, findFirst: async () => null },
    pipelineRun: { findFirst: async () => null },
  }),
}));

// Partial: the constants stay real, so the timezone the page passes down is
// the one production uses rather than one invented here.
vi.mock('@portfolio/streamflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@portfolio/streamflow')>()),
  observationsAsOf: async () => [],
  publicPredictions: async () => [],
  publicScoredErrors: async () => [],
  gradedIntervals: async () => [],
}));

// The charting and fetching panels are not what this is testing.
vi.mock('./HydrographPanel', () => ({ HydrographPanel: () => null }));
vi.mock('./SkillChart', () => ({ SkillChart: () => null }));
vi.mock('./CalibrationPanel', () => ({ CalibrationPanel: () => null }));

describe('the dashboard page', () => {
  it('renders the Open-Meteo credit and its licence link', async () => {
    const { default: StreamflowPage } = await import('./page');

    render(await StreamflowPage());

    expect(
      screen.getByRole('link', { name: /open-meteo/i }).getAttribute('href'),
    ).toBe('https://open-meteo.com/');
    expect(
      screen.getByRole('link', { name: /cc by 4\.0/i }).getAttribute('href'),
    ).toBe('https://creativecommons.org/licenses/by/4.0/');
  });
});
