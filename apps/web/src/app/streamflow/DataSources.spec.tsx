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
const HOUR = 3_600_000;

afterEach(cleanup);

/** The two links the licence actually rests on, addressed by href. */
const CREDIT_HREFS = [
  'https://open-meteo.com/',
  'https://creativecommons.org/licenses/by/4.0/',
];

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

    // Selected by href rather than by taking every link in the block: a third
    // link added here later is somebody else's business, and failing on it
    // would be a false alarm. The length check still earns its keep, because
    // unlinking either credit to plain text drops the count to one, which is
    // the one regression a per link loop alone would miss.
    const credits = screen
      .getAllByRole('link')
      .filter((link) => CREDIT_HREFS.includes(link.getAttribute('href') ?? ''));

    expect(credits).toHaveLength(2);
    for (const link of credits) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('says this is not a flood forecast, on the page that shows forecasts', () => {
    // `/streamflow` was the only one of the three streamflow pages carrying no
    // such line, and it is the one showing live predictions for a real river.
    // The wording is shared with `/projects/streamflow` and the walkthrough on
    // purpose, so this asserts the load bearing half of it rather than a
    // paraphrase.
    render(<DataSources timeZone="America/New York" />);

    expect(
      screen.getByText(/not a flood forecast/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/should be used to make decisions about water/i),
    ).toBeTruthy();
    expect(screen.getByText(/subject to revision/i)).toBeTruthy();
  });

  it('leads with the disclaimer rather than trailing it', () => {
    // The component's own header comment claims this and the audit record
    // repeats it, so it is asserted rather than left as prose: moving the
    // paragraph to the end of the block used to pass.
    const { container } = render(<DataSources timeZone="America/New York" />);

    expect(container.querySelector('p')?.textContent).toMatch(
      /not a flood forecast/i,
    );
  });

  it('keeps the decorative arrow out of each link accessible name', () => {
    // The glyph is decoration: left in the name, a screen reader reads the
    // licence link as "CC BY 4.0 north east arrow".
    //
    // Asserted as an EXACT accessible name, which is the property itself
    // rather than a proxy for it. The first version of this test checked that
    // a `span[aria-hidden]` holding the arrow existed, and the pre deploy
    // audit broke it on 2026-08-31: markup carrying a bare arrow AND the
    // hidden span passed, while computing to the name `Open-Meteo ↗`. Roles
    // are matched here through testing library's own accessible name
    // computation, so aria-hidden subtrees drop out the way they do for a
    // screen reader, and an exact string is what fails if the arrow returns.
    render(<DataSources timeZone="America/New York" />);

    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeTruthy();

    // And it is still on screen for everyone who is not using one.
    for (const href of CREDIT_HREFS) {
      expect(
        document.querySelector(`a[href="${href}"]`)?.textContent,
      ).toContain('↗');
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
 * Rendering costs two module mocks and three panel stubs, and in exchange
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
    // Shaped like production, not like an empty store. The mocks used to
    // return 0, null and empty arrays everywhere, which is the page's EMPTY
    // state: a credit gated on there being data would then have been proven
    // in exactly the wrong direction.
    observation: {
      count: async () => 18_849,
      findFirst: async () => ({
        validTime: new Date('2026-08-31T12:00:00.000Z'),
        recordedAt: new Date('2026-08-31T12:05:00.000Z'),
        valueCfs: 142.5,
        qualifier: 'PROVISIONAL' as const,
      }),
    },
    pipelineRun: {
      findFirst: async () => ({
        // Deliberately the one PipelineJob member carrying two underscores.
        // It is the only value that tells `replace` from `replaceAll`, and
        // the page renders this label through that call, so the fixture is
        // what gives the underscore fix a regression guard at all.
        job: 'OPEN_METEO_INGEST' as const,
        status: 'OK' as const,
        startedAt: new Date('2026-08-31T12:00:00.000Z'),
        rowsWritten: 96,
      }),
    },
  }),
}));

// Partial: the constants stay real, so the timezone the page passes down is
// the one production uses rather than one invented here.
vi.mock('@portfolio/streamflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@portfolio/streamflow')>()),
  // One reading, three hours before the forecast was issued, so the page's
  // stale input derivation has something real to find rather than falling
  // through to its no-input-found branch.
  observationsAsOf: async () => [
    {
      gaugeId: 'gauge-1',
      validTime: new Date(Date.now() - 3 * HOUR),
      recordedAt: new Date(Date.now() - 3 * HOUR),
      valueCfs: 142.5,
      qualifier: 'PROVISIONAL' as const,
    },
  ],
  // One current forecast, so the forecast table renders. Without it the
  // table is absent and the disclaimer beside it cannot be asserted.
  //
  // Dates are relative to now on purpose. Fixed instants made this test
  // time dependent the moment the page began filtering forecasts whose
  // target has passed: a hardcoded 2026-09-01 target silently stops
  // rendering the table once that date goes by.
  publicPredictions: async () => [
    {
      id: 'pred-1',
      horizonHours: 24,
      issuedAt: new Date(Date.now() - 2 * HOUR),
      targetTime: new Date(Date.now() + 22 * HOUR),
      centralCfs: 150,
      lowerCfs: 110,
      upperCfs: 230,
      intervalSeeded: true,
      bucketSize: 240,
      modelVersion: { name: 'persistence', kind: 'BASELINE' },
    },
  ],
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

    // The page swallows read failures by design (`settled` in page.tsx turns a
    // rejected read into a console.error and a fallback), so a mock that has
    // drifted out of step with a new query would otherwise leave this test
    // certifying a page whose data layer is broken.
    const swallowed: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        swallowed.push(String(args[0]));
      });

    try {
      render(await StreamflowPage());
    } finally {
      spy.mockRestore();
    }

    // Checked FIRST, and deliberately separate from the licence assertions.
    // `render(await StreamflowPage())` is the client renderer: it can await
    // this page, but not a nested async child. If someone moves the footer
    // into its own `async function` server component, which is the ordinary
    // Next 15 pattern, the whole tree collapses to nothing and every
    // assertion below fails with a message identical to the credit having
    // been deleted. This line makes those two cases say different things.
    // If it fails, the page rendered nothing: look for a new async child,
    // not for a missing credit.
    expect(screen.getByRole('main')).toBeTruthy();

    expect(swallowed.filter((line) => line.includes('[streamflow]'))).toEqual(
      [],
    );

    // Matched by `href` rather than by accessible name, so that adding a
    // second, perfectly legitimate Open-Meteo link elsewhere on the page
    // cannot fail this while the site is fully in licence.
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    expect(hrefs).toContain('https://open-meteo.com/');
    expect(hrefs).toContain('https://creativecommons.org/licenses/by/4.0/');
  });

  it('spaces every underscore in the job label, not only the first', async () => {
    // Reverting `page.tsx` to `replace` renders `open meteo_ingest`. Nothing
    // asserted on this label before, so the audit found the fix could be
    // reverted or lost in a merge with the whole suite green.
    const { default: StreamflowPage } = await import('./page');

    render(await StreamflowPage());

    expect(screen.getByText('open meteo ingest')).toBeTruthy();
  });

  it('repeats the safety line beside the numbers, not only in the footer', async () => {
    // The whole point of the audit finding: roughly 3,400px separates the
    // forecast table from the footer, so a footer only disclaimer is one a
    // visitor who acts on a number plausibly never reaches. Three occurrences
    // means the latest reading and the forecast table each carry it as well.
    const { default: StreamflowPage } = await import('./page');

    render(await StreamflowPage());

    expect(screen.getAllByText(/not a flood forecast/i)).toHaveLength(3);
  });

  it('points at an authority instead of only saying what not to trust', async () => {
    const { default: StreamflowPage } = await import('./page');

    render(await StreamflowPage());

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    expect(hrefs).toContain(
      'https://waterdata.usgs.gov/monitoring-location/03230500/',
    );
    expect(hrefs).toContain('https://water.noaa.gov/');
  });
});
