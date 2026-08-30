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

    // The literal, not the constant: comparing the constant against itself
    // would pass no matter what the builder sent.
    expect(url.searchParams.get('models')).toBe('gfs_seamless');
    expect(buildPreviousRunsUrl(WINDOW, 24)).not.toContain('best_match');
  });

  it('requests only suffixed columns for the lead it was given', () => {
    const hourly = new URL(buildPreviousRunsUrl(WINDOW, 72)).searchParams.get('hourly');

    expect(hourly).toBe('precipitation_previous_day3,temperature_2m_previous_day3');
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

  // Open-Meteo's start_date/end_date have calendar day granularity, so a window
  // ending mid day returns that whole day. Anything past the window end is an
  // hour that has not happened yet.
  it('drops hours past the end of the requested window', async () => {
    const wholeDay = {
      hourly: {
        time: [
          '2026-08-30T11:00',
          '2026-08-30T12:00',
          '2026-08-30T13:00',
          '2026-08-30T23:00',
        ],
        precipitation_previous_day1: [1, 2, 3, 4],
        temperature_2m_previous_day1: [1, 1, 1, 1],
      },
    };
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => wholeDay });

    const values = await fetchPreviousRuns(
      {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-08-30T12:00:00.000Z'),
      },
      24,
      fetchImpl as unknown as typeof fetch,
    );

    expect(values.map((v) => v.validTime.toISOString())).toEqual([
      '2026-08-30T11:00:00.000Z',
      '2026-08-30T12:00:00.000Z',
    ]);
  });

  it('drops hours before the start of the requested window', async () => {
    const payload = {
      hourly: {
        time: ['2026-07-31T23:00', '2026-08-01T00:00'],
        precipitation_previous_day1: [9, 1],
        temperature_2m_previous_day1: [1, 1],
      },
    };
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });

    const values = await fetchPreviousRuns(
      {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-08-31T23:00:00.000Z'),
      },
      24,
      fetchImpl as unknown as typeof fetch,
    );

    expect(values).toHaveLength(1);
    expect(values[0].validTime.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
