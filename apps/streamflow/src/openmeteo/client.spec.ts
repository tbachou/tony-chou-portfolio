import { OPEN_METEO_MODEL } from '../config';
import { buildPreviousRunsUrl, fetchPreviousRuns, toArchiveDate } from './client';

const WINDOW = {
  start: new Date('2024-02-01T00:00:00.000Z'),
  end: new Date('2024-02-29T23:00:00.000Z'),
};

describe('buildPreviousRunsUrl', () => {
  it('names the pinned host', () => {
    expect(buildPreviousRunsUrl(WINDOW, 24)).toContain(
      'https://previous-runs-api.open-meteo.com/v1/forecast',
    );
  });

  it('names the pinned model and never best_match', () => {
    const url = new URL(buildPreviousRunsUrl(WINDOW, 24));

    expect(url.searchParams.get('models')).toBe(OPEN_METEO_MODEL);
    expect(url.searchParams.get('models')).toBe('gfs_seamless');
    expect(buildPreviousRunsUrl(WINDOW, 24)).not.toContain('best_match');
  });

  it('requests only suffixed columns for the lead it was given', () => {
    const hourly = new URL(buildPreviousRunsUrl(WINDOW, 72)).searchParams.get('hourly');

    expect(hourly).toBe('precipitation_previous_day3,temperature_2m_previous_day3');
    expect(hourly?.split(',')).not.toContain('precipitation');
  });

  it('pins GMT so the parser and the service agree on the clock', () => {
    expect(new URL(buildPreviousRunsUrl(WINDOW, 24)).searchParams.get('timezone')).toBe(
      'GMT',
    );
  });

  it('sends the window as plain UTC calendar days', () => {
    const url = new URL(buildPreviousRunsUrl(WINDOW, 24));

    expect(url.searchParams.get('start_date')).toBe('2024-02-01');
    expect(url.searchParams.get('end_date')).toBe('2024-02-29');
  });

  it('refuses to build a request for a lead the store may never hold', () => {
    expect(() => buildPreviousRunsUrl(WINDOW, 0)).toThrow(/at least 24/);
  });
});

describe('toArchiveDate', () => {
  it('derives the day in UTC, not the machine zone', () => {
    expect(toArchiveDate(new Date('2024-02-01T23:30:00.000Z'))).toBe('2024-02-01');
  });
});

describe('fetchPreviousRuns', () => {
  const payload = {
    hourly: {
      time: ['2024-02-01T00:00'],
      precipitation: [9.9],
      precipitation_previous_day1: [1.25],
      temperature_2m_previous_day1: [2.5],
    },
  };

  it('parses a successful response from the suffixed columns', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });

    const values = await fetchPreviousRuns(WINDOW, 24, fetchImpl as unknown as typeof fetch);

    expect(values).toEqual([
      {
        validTime: new Date('2024-02-01T00:00:00.000Z'),
        leadHours: 24,
        precipMm: 1.25,
        tempC: 2.5,
      },
    ]);
  });

  it('throws on a failed response rather than returning a short list', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(
      fetchPreviousRuns(WINDOW, 24, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/429/);
  });
});
