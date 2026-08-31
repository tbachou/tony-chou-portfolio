import {
  clampWindowTo,
  expectedHourCount,
  isCalendarMonth,
  isWindowElapsed,
  judgeForecastCompleteness,
  judgeWindowCompleteness,
  liveForecastWindow,
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

describe('judgeWindowCompleteness', () => {
  const window = {
    start: new Date('2024-02-14T00:00:00.000Z'),
    end: new Date('2024-02-14T23:00:00.000Z'),
  };

  it('is OK when every hour the window implies came back', () => {
    expect(judgeWindowCompleteness(expectedHourCount(window), window)).toBe('OK');
  });

  it('is PARTIAL when the response fell short', () => {
    expect(judgeWindowCompleteness(expectedHourCount(window) - 1, window)).toBe(
      'PARTIAL',
    );
  });

  // The difference that matters against `judgeForecastCompleteness`. A live
  // window always ends in the future, so a month rule would call every live run
  // PARTIAL for ever and the status would stop meaning anything.
  it('does not care whether the window has elapsed', () => {
    const ahead = {
      start: new Date('2024-02-14T00:00:00.000Z'),
      end: new Date('2024-02-16T00:00:00.000Z'),
    };

    expect(judgeWindowCompleteness(expectedHourCount(ahead), ahead)).toBe('OK');
    expect(judgeForecastCompleteness(expectedHourCount(ahead), ahead, false)).toBe(
      'PARTIAL',
    );
  });
});

describe('isCalendarMonth', () => {
  const midFebruary = new Date('2024-02-14T00:00:00.000Z');

  it('recognises a window the backfill produced', () => {
    expect(isCalendarMonth(monthWindow(midFebruary))).toBe(true);
    expect(isCalendarMonth(monthWindow(new Date('2024-12-11T00:00:00.000Z')))).toBe(
      true,
    );
  });

  // The reachable collision. A live window can start exactly on a month
  // boundary, and keying the backfill's resume set on the start alone would
  // then read the live run as a finished month.
  it('rejects a live shaped window that starts on a month boundary', () => {
    const live = {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-09-02T02:00:00.000Z'),
    };

    expect(live.start).toEqual(monthWindow(live.start).start);
    expect(isCalendarMonth(live)).toBe(false);
  });

  it('rejects a window that ends on a month boundary but starts inside', () => {
    const partial = {
      start: new Date('2024-02-14T00:00:00.000Z'),
      end: monthWindow(midFebruary).end,
    };

    expect(isCalendarMonth(partial)).toBe(false);
  });

  // What the backfill's own clamp produces for the month in progress. It is
  // recorded against the whole month, not this, which is why the resume read
  // still recognises it; a window shaped like this is not a covered chunk.
  it('rejects a month clamped short at the live edge', () => {
    const clamped = clampWindowTo(monthWindow(midFebruary), midFebruary);

    expect(isCalendarMonth(clamped)).toBe(false);
  });
});

describe('liveForecastWindow', () => {
  const NOW = new Date('2026-08-31T06:07:23.000Z');
  const STORED_24 = new Date('2026-09-01T00:00:00.000Z');

  // AC-R13's whole shape: the start is read off the store, not the clock.
  it('starts at the greatest stored validTime less the ingest overlap', () => {
    const window = liveForecastWindow(STORED_24, 24, NOW);

    expect(window.start).toEqual(new Date('2026-08-31T22:00:00.000Z'));
  });

  // The boundary the job exists for. A prediction issued now at horizon 24
  // needs every hour up to now plus 24, and the last of them was issued now.
  it('ends one lead ahead of now, so the last hour was issued exactly now', () => {
    const window = liveForecastWindow(STORED_24, 24, NOW);

    expect(window.end).toEqual(new Date('2026-09-01T06:07:23.000Z'));
  });

  // One hour further and the nominal issuedAt would postdate the recordedAt we
  // would write it with, which is the axis inversion the whole child refuses.
  it('never reaches an hour whose nominal issue time is after now', () => {
    const HOUR_MS = 3_600_000;

    for (const leadHours of [24, 48, 72]) {
      const window = liveForecastWindow(STORED_24, leadHours, NOW);
      // The last hourly slot the fetch can keep, since it trims on validTime.
      const lastHour = Math.floor(window.end.getTime() / HOUR_MS) * HOUR_MS;
      const issuedAt = lastHour - leadHours * HOUR_MS;

      expect(issuedAt).toBeLessThanOrEqual(NOW.getTime());
      // And the very next hour would break it, so this is the boundary rather
      // than a cautious margin.
      expect(lastHour + HOUR_MS - leadHours * HOUR_MS).toBeGreaterThan(NOW.getTime());
    }
  });

  it('reaches further ahead at a longer lead', () => {
    const short = liveForecastWindow(STORED_24, 24, NOW);
    const long = liveForecastWindow(STORED_24, 72, NOW);

    expect(long.end.getTime() - short.end.getTime()).toBe(48 * 3_600_000);
  });

  // Gap recovery (AC-R13), the same property AC-6 asks of the observation
  // ingest. Nothing here consults the schedule, so a missed run is not a
  // special case.
  it('asks for the whole gap when a run was missed', () => {
    const stale = new Date('2026-08-29T00:00:00.000Z');
    const window = liveForecastWindow(stale, 24, NOW);

    expect(window.start).toEqual(new Date('2026-08-28T22:00:00.000Z'));
    expect(window.end.getTime() - window.start.getTime()).toBeGreaterThan(
      3 * 24 * 3_600_000,
    );
  });

  // History is the backfill's job, chunked by month for the cost reason
  // AC-R16 sets out. A live job falling back to the archive's beginning would
  // ask for two and a half years, every six hours.
  it('starts at the live edge when the store holds nothing for the lead', () => {
    const window = liveForecastWindow(null, 48, NOW);

    expect(window.start).toEqual(new Date('2026-08-31T04:07:23.000Z'));
    expect(window.end).toEqual(new Date('2026-09-02T06:07:23.000Z'));
  });

  it('collapses to an empty window rather than inverting under clock skew', () => {
    const skewed = new Date('2026-09-30T00:00:00.000Z');
    const window = liveForecastWindow(skewed, 24, NOW);

    expect(window.start).toEqual(window.end);
    expect(expectedHourCount(window)).toBe(0);
  });
});
