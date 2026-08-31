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
