import {
  clampWindowTo,
  expectedHourCount,
  isWindowElapsed,
  judgeForecastCompleteness,
  monthWindow,
  nextMonthWindow,
} from './forecast-window';

describe('monthWindow', () => {
  it('spans the whole calendar month in UTC, last hour inclusive', () => {
    const window = monthWindow(new Date('2024-02-14T17:23:00.000Z'));

    expect(window.start.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2024-02-29T23:00:00.000Z');
  });

  it('handles a 31 day month', () => {
    expect(monthWindow(new Date('2024-01-05T00:00:00.000Z')).end.toISOString()).toBe(
      '2024-01-31T23:00:00.000Z',
    );
  });

  it('handles December rolling into the next year', () => {
    expect(monthWindow(new Date('2024-12-09T00:00:00.000Z')).end.toISOString()).toBe(
      '2024-12-31T23:00:00.000Z',
    );
  });
});

describe('nextMonthWindow', () => {
  it('steps to the following month', () => {
    const next = nextMonthWindow(monthWindow(new Date('2024-01-15T00:00:00.000Z')));

    expect(next.start.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(next.end.toISOString()).toBe('2024-02-29T23:00:00.000Z');
  });

  it('steps across a year boundary', () => {
    expect(
      nextMonthWindow(monthWindow(new Date('2024-12-01T00:00:00.000Z'))).start.toISOString(),
    ).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('expectedHourCount', () => {
  it.each([
    ['2024-01-01T00:00:00.000Z', 744],
    ['2024-02-01T00:00:00.000Z', 696],
    ['2024-04-01T00:00:00.000Z', 720],
  ])('counts the hours in the month containing %s as %i', (within, hours) => {
    expect(expectedHourCount(monthWindow(new Date(within)))).toBe(hours);
  });
});

describe('clampWindowTo', () => {
  const august = monthWindow(new Date('2026-08-01T00:00:00.000Z'));

  it('leaves a wholly past window alone', () => {
    const now = new Date('2026-09-05T00:00:00.000Z');

    expect(clampWindowTo(august, now)).toEqual(august);
  });

  // The defect this exists to stop: Open-Meteo rejects an end_date more than
  // fifteen days ahead with a 400, which killed the whole walk.
  it('pulls a future end back to now', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');

    const clamped = clampWindowTo(august, now);

    expect(clamped.start).toEqual(august.start);
    expect(clamped.end).toEqual(now);
    expect(clamped.end.getTime()).toBeLessThan(august.end.getTime());
  });

  it('never returns an end after now', () => {
    const now = new Date('2026-08-02T03:00:00.000Z');

    expect(clampWindowTo(august, now).end.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe('isWindowElapsed', () => {
  const august = monthWindow(new Date('2026-08-01T00:00:00.000Z'));

  it('is true once the month has ended', () => {
    expect(isWindowElapsed(august, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
  });

  it('is false while the month is still running', () => {
    expect(isWindowElapsed(august, new Date('2026-08-30T12:00:00.000Z'))).toBe(false);
  });

  it('is true exactly at the final hour', () => {
    expect(isWindowElapsed(august, august.end)).toBe(true);
  });
});

describe('judgeForecastCompleteness', () => {
  const february = monthWindow(new Date('2024-02-01T00:00:00.000Z'));

  it('is OK when every hour of an elapsed month came back', () => {
    expect(judgeForecastCompleteness(696, february, true)).toBe('OK');
  });

  // AC-R14: the archive ramps in at its start, so this is expected there and is
  // not a failure.
  it('is PARTIAL when the response fell short of the window', () => {
    expect(judgeForecastCompleteness(400, february, true)).toBe('PARTIAL');
  });

  it('is PARTIAL when nothing came back at all', () => {
    expect(judgeForecastCompleteness(0, february, true)).toBe('PARTIAL');
  });

  // The freeze this prevents: an OK chunk is skipped forever, so a month still
  // in progress would keep whatever the service said about hours that had not
  // happened yet.
  it('is never OK while the month is still in progress, however complete it looks', () => {
    const august = monthWindow(new Date('2026-08-01T00:00:00.000Z'));
    const clamped = clampWindowTo(august, new Date('2026-08-30T12:00:00.000Z'));

    expect(judgeForecastCompleteness(expectedHourCount(clamped), clamped, false)).toBe(
      'PARTIAL',
    );
  });
});
