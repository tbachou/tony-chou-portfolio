import { climatologyForecast, persistenceForecast } from './baselines';
import type { StoredObservation } from '../types';

const GAUGE = 'gauge_darby';

function row(validTime: string, valueCfs: number): StoredObservation {
  return {
    gaugeId: GAUGE,
    validTime: new Date(validTime),
    recordedAt: new Date(validTime),
    valueCfs,
    qualifier: 'PROVISIONAL',
  };
}

/** Readings every 15 minutes across a span, at a constant value. */
function series(from: string, hours: number, valueCfs: number) {
  const start = new Date(from).getTime();
  const out: StoredObservation[] = [];
  for (let minute = 0; minute < hours * 60; minute += 15) {
    out.push(row(new Date(start + minute * 60000).toISOString(), valueCfs));
  }
  return out;
}

describe('persistenceForecast', () => {
  const history = [
    row('2026-08-23T11:30:00Z', 900),
    row('2026-08-23T11:45:00Z', 950),
    row('2026-08-23T12:00:00Z', 1000),
  ];

  it('forecasts the newest reading, unchanged', () => {
    expect(persistenceForecast(history, new Date('2026-08-23T12:00:00Z'))).toBe(
      1000,
    );
  });

  it('gives the same answer for every horizon, since it predicts no change', () => {
    // The caller asks once and reuses it for 24, 48 and 72 hours. There is no
    // horizon term in the method at all.
    const issued = new Date('2026-08-23T12:00:00Z');
    expect(persistenceForecast(history, issued)).toBe(1000);
  });

  it('never uses a reading from after the issue time', () => {
    // The leakage rule, at its simplest. A reading the forecaster could not
    // have seen must not become the forecast.
    const withFuture = [...history, row('2026-08-23T18:00:00Z', 7000)];

    expect(
      persistenceForecast(withFuture, new Date('2026-08-23T12:00:00Z')),
    ).toBe(1000);
  });

  it('uses a reading recorded exactly at the issue time', () => {
    expect(persistenceForecast(history, new Date('2026-08-23T12:00:00Z'))).toBe(
      1000,
    );
  });

  it('is unaffected by the order rows arrive in', () => {
    expect(
      persistenceForecast([...history].reverse(), new Date('2026-08-23T12:00:00Z')),
    ).toBe(1000);
  });

  it('returns null rather than guessing when nothing is known yet', () => {
    expect(
      persistenceForecast(history, new Date('2026-08-23T10:00:00Z')),
    ).toBeNull();
    expect(persistenceForecast([], new Date('2026-08-23T12:00:00Z'))).toBeNull();
  });
});

describe('climatologyForecast', () => {
  it('averages readings near the same date in earlier years', () => {
    const history = [
      ...series('2024-08-20T00:00:00Z', 24, 200),
      ...series('2025-08-20T00:00:00Z', 24, 400),
    ];

    // Both earlier years fall inside the plus or minus seven day window.
    expect(
      climatologyForecast(history, new Date('2026-08-22T12:00:00Z')),
    ).toBeCloseTo(300, 5);
  });

  it('ignores the target year, so it cannot see the season it predicts', () => {
    const history = [
      ...series('2024-08-20T00:00:00Z', 24, 200),
      // A wild value in the target's own year must not enter the average.
      ...series('2026-08-21T00:00:00Z', 24, 9000),
    ];

    expect(
      climatologyForecast(history, new Date('2026-08-22T12:00:00Z')),
    ).toBeCloseTo(200, 5);
  });

  it('ignores dates outside the window', () => {
    const history = [
      ...series('2024-08-20T00:00:00Z', 24, 200),
      // Two months away: same year, irrelevant season.
      ...series('2024-06-20T00:00:00Z', 24, 5000),
    ];

    expect(
      climatologyForecast(history, new Date('2026-08-22T12:00:00Z')),
    ).toBeCloseTo(200, 5);
  });

  it('gives the same answer regardless of horizon, for the same target date', () => {
    const history = series('2024-08-20T00:00:00Z', 24, 250);
    const target = new Date('2026-08-22T12:00:00Z');

    // Whether this target is 24 or 72 hours out changes nothing: the method
    // never looks at the issue time. That flatness is why its error barely
    // moves across horizons.
    expect(climatologyForecast(history, target)).toBeCloseTo(250, 5);
  });

  it('resolves the calendar day at the gauge, not in UTC', () => {
    const target = new Date('2026-01-08T12:00:00Z');

    // Squarely inside the window under either zone: 96 readings at 200.
    const inside = series('2025-01-08T00:00:00Z', 24, 200);

    // Midnight to 04:45 UTC on 1 January is 19:00 to 23:45 on 31 December in
    // New York, so all 20 of these sit on 1 January read as UTC and on 31
    // December read at the gauge. The window runs 1 to 15 January, so the zone
    // decides whether they count at all. One day of drift, right at the edge.
    const onTheEdge = series('2025-01-01T00:00:00Z', 5, 1000);
    const history = [...inside, ...onTheEdge];

    // Read as UTC the edge readings count, and drag the mean up.
    const draggedUp = (96 * 200 + 20 * 1000) / 116;
    expect(climatologyForecast(history, target, 'UTC')).toBeCloseTo(draggedUp, 5);

    // Read at the gauge they fall on 31 December and are correctly excluded.
    expect(
      climatologyForecast(history, target, 'America/New_York'),
    ).toBeCloseTo(200, 5);
  });

  it('refuses to answer from too small a sample', () => {
    // Four readings is an anecdote, not a climatology.
    const history = series('2024-08-20T00:00:00Z', 1, 200);

    expect(
      climatologyForecast(history, new Date('2026-08-22T12:00:00Z')),
    ).toBeNull();
  });

  it('returns null when no earlier year exists at all', () => {
    const history = series('2026-08-20T00:00:00Z', 24, 200);

    expect(
      climatologyForecast(history, new Date('2026-08-22T12:00:00Z')),
    ).toBeNull();
  });
});
