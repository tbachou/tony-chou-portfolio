import { parsePreviousRuns, previousRunColumn, assertStorableLead } from './parse';

/**
 * Shaped from a real Previous Runs response, trimmed to three hours, and
 * deliberately carrying the unsuffixed `precipitation` column alongside the
 * suffixed ones. That column is the trap AC-R1 exists to refuse: for a past
 * date it is very nearly what actually fell.
 */
function response(overrides: Record<string, unknown> = {}) {
  return {
    hourly: {
      time: ['2024-02-01T00:00', '2024-02-01T01:00', '2024-02-01T02:00'],
      precipitation: [9.9, 9.9, 9.9],
      precipitation_previous_day1: [0.1, 0, 2.4],
      temperature_2m_previous_day1: [3.5, 3.1, null],
      precipitation_previous_day2: [0.5, 0.5, 0.5],
      temperature_2m_previous_day2: [1, 1, 1],
      ...overrides,
    },
  };
}

describe('previousRunColumn', () => {
  it('builds the suffixed name from the lead', () => {
    expect(previousRunColumn('precipitation', 24)).toBe('precipitation_previous_day1');
    expect(previousRunColumn('temperature_2m', 72)).toBe('temperature_2m_previous_day3');
  });
});

describe('assertStorableLead', () => {
  it.each([0, 12, 23, 36])('refuses a lead of %i hours', (lead) => {
    expect(() => assertStorableLead(lead)).toThrow(/multiple of 24/);
  });

  it.each([24, 48, 72])('accepts a lead of %i hours', (lead) => {
    expect(() => assertStorableLead(lead)).not.toThrow();
  });
});

describe('parsePreviousRuns', () => {
  it('stores from the suffixed columns alone, never the unsuffixed one', () => {
    const values = parsePreviousRuns(response(), 24);

    expect(values.map((value) => value.precipMm)).toEqual([0.1, 0, 2.4]);
    // 9.9 is the unsuffixed column. Its absence is the acceptance criterion.
    expect(values.some((value) => value.precipMm === 9.9)).toBe(false);
  });

  it('reads the lead it was asked for, not the first suffixed column present', () => {
    expect(parsePreviousRuns(response(), 48).map((value) => value.precipMm)).toEqual([
      0.5, 0.5, 0.5,
    ]);
  });

  it('throws rather than falling back when the suffixed column is absent', () => {
    const hourly: Record<string, unknown> = { ...response().hourly };
    delete hourly.precipitation_previous_day1;

    expect(() => parsePreviousRuns({ hourly }, 24)).toThrow(
      /missing column precipitation_previous_day1/,
    );
  });

  it('tags every value with the lead it was requested at', () => {
    expect(parsePreviousRuns(response(), 72.0 - 24).map((v) => v.leadHours)).toEqual([
      48, 48, 48,
    ]);
  });

  it('reads times as UTC', () => {
    expect(parsePreviousRuns(response(), 24)[0].validTime.toISOString()).toBe(
      '2024-02-01T00:00:00.000Z',
    );
  });

  it('leaves tempC absent rather than null when the hour has none', () => {
    const values = parsePreviousRuns(response(), 24);

    expect(values[0].tempC).toBe(3.5);
    expect('tempC' in values[2]).toBe(false);
  });

  it('drops an hour with null precipitation rather than storing a confident zero', () => {
    const values = parsePreviousRuns(
      response({ precipitation_previous_day1: [0.1, null, 2.4] }),
      24,
    );

    expect(values).toHaveLength(2);
    expect(values.map((value) => value.validTime.toISOString())).toEqual([
      '2024-02-01T00:00:00.000Z',
      '2024-02-01T02:00:00.000Z',
    ]);
  });

  it('refuses a lead the store may never hold', () => {
    expect(() => parsePreviousRuns(response(), 0)).toThrow(/at least 24/);
  });
});
