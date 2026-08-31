import { rainWindow } from './rain';
import type { RainCriteria } from './rain';
import type { StoredForecast } from '../types';

/**
 * The window is 24 hours long, so a complete one holds 24 rows and the
 * fixtures are built rather than written out. One millimetre an hour makes the
 * expected total the same number as the hour count, which keeps every
 * assertion below readable at a glance.
 */
const GAUGE = 'gauge-darby';
const MODEL = 'gfs_seamless';
const H = 24;
const T = new Date('2026-08-19T00:00:00.000Z');

const CRITERIA: RainCriteria = {
  gaugeId: GAUGE,
  model: MODEL,
  horizonHours: H,
  issuedAt: T,
};

interface Options {
  leadHours?: number;
  recordedAt?: Date;
  gaugeId?: string;
  model?: string;
}

/** One row valid `offsetHours` after the issue instant. */
function at(offsetHours: number, precipMm: number, options: Options = {}): StoredForecast {
  const leadHours = options.leadHours ?? H;
  const validTime = new Date(T.getTime() + offsetHours * 3600 * 1000);
  // Derived exactly as the writer derives it, so a fixture cannot drift from
  // the invariant that `leadHours` is canonical.
  const issuedAt = new Date(validTime.getTime() - leadHours * 3600 * 1000);

  return {
    gaugeId: options.gaugeId ?? GAUGE,
    validTime,
    leadHours,
    issuedAt,
    // Defaults to the issue instant, so an ordinary fixture row is visible on
    // either axis and a test that cares about visibility has to say so.
    recordedAt: options.recordedAt ?? issuedAt,
    precipMm,
    tempC: null,
    model: options.model ?? MODEL,
  };
}

/** Hours 1 to 24 after the issue instant, one row each. */
function completeWindow(precipPerHour = 1): StoredForecast[] {
  return Array.from({ length: H }, (_, i) => at(i + 1, precipPerHour));
}

describe('rainWindow', () => {
  it('sums a complete window', () => {
    expect(rainWindow(completeWindow(), CRITERIA)).toBe(24);
  });

  // The distinction the whole criterion turns on. Both of these are complete
  // windows; one of them is a forecast of no rain and the other cannot be a
  // forecast of anything, and a feature that returned 0 for both would tell
  // the model a gap was a dry spell.
  it('returns 0 for a dry window and null for a missing one', () => {
    expect(rainWindow(completeWindow(0), CRITERIA)).toBe(0);
    expect(rainWindow(completeWindow(0).slice(1), CRITERIA)).toBeNull();
  });

  it('returns null when one hour is missing, never a partial sum', () => {
    const short = completeWindow().filter((row) => row.precipMm >= 0).slice(0, H - 1);

    expect(short).toHaveLength(23);
    expect(rainWindow(short, CRITERIA)).toBeNull();
  });

  it('returns null on an empty set rather than 0', () => {
    expect(rainWindow([], CRITERIA)).toBeNull();
  });

  // AC-R7. The table is append only, so the revised hour is present twice.
  it('counts a revised hour once, at its newest visible value', () => {
    const window = completeWindow();
    const revised = at(5, 5, { recordedAt: T });

    // 23 hours at 1mm, plus the revised hour at 5 rather than at 1.
    expect(rainWindow([...window, revised], CRITERIA)).toBe(28);
  });

  // The same fixture with the superseded row taken out must give the same
  // answer. If it does not, the older value is still reaching the sum.
  it('agrees with the same window holding only the newer revision', () => {
    const window = completeWindow();
    const revised = at(5, 5, { recordedAt: T });
    const withoutOld = window.filter(
      (row) => row.validTime.getTime() !== revised.validTime.getTime(),
    );

    expect(rainWindow([...window, revised], CRITERIA)).toBe(
      rainWindow([...withoutOld, revised], CRITERIA),
    );
  });

  it('ignores a revision that is not visible yet on the live axis', () => {
    const window = completeWindow();
    const later = at(5, 99, { recordedAt: new Date(T.getTime() + 3600 * 1000) });

    expect(rainWindow([...window, later], CRITERIA)).toBe(24);
  });

  /**
   * AC-R7 and AC-R10 together, and the case a raw row count gets wrong.
   *
   * Twenty four rows, so anything counting what it filtered sees a complete
   * window. Reduced they are twenty three hours, because one hour is present
   * twice and another not at all, and the honest answer is null.
   */
  it('is null when a revised hour pads a window that is really short', () => {
    const rows = [...completeWindow().slice(0, H - 1), at(5, 5, { recordedAt: T })];

    expect(rows).toHaveLength(H);
    expect(new Set(rows.map((row) => row.validTime.getTime())).size).toBe(H - 1);
    expect(rainWindow(rows, CRITERIA)).toBeNull();
  });

  /**
   * The lead rule, which is a leakage rule rather than a tidiness one.
   *
   * A 24 hour row valid 48 hours out was issued a full day after the
   * prediction. Admitting it would hand the model rain it learned about after
   * committing.
   */
  it('takes only rows whose lead equals the horizon', () => {
    const window = completeWindow();
    const wrongLead = at(5, 99, { leadHours: 48 });

    expect(rainWindow([...window, wrongLead], CRITERIA)).toBe(24);
  });

  it('is null when every row carries a different lead', () => {
    const rows = Array.from({ length: H }, (_, i) => at(i + 1, 1, { leadHours: 48 }));

    expect(rainWindow(rows, CRITERIA)).toBeNull();
  });

  // The property that makes the lead rule work: matching the lead to the
  // horizon puts every row in the window at an issue time at or before T.
  it('draws only on rows issued at or before the issue instant', () => {
    for (const row of completeWindow()) {
      expect(row.issuedAt.getTime()).toBeLessThanOrEqual(T.getTime());
    }
  });

  it('excludes another gauge and another model', () => {
    const window = completeWindow();

    expect(rainWindow([...window, at(5, 99, { gaugeId: 'other' })], CRITERIA)).toBe(24);
    expect(rainWindow([...window, at(5, 99, { model: 'icon_seamless' })], CRITERIA)).toBe(
      24,
    );
  });

  // The window runs after T, up to and including T plus H. Both ends matter
  // and getting either wrong shifts the feature by an hour without changing
  // its shape.
  it('excludes the hour at the issue instant', () => {
    const window = completeWindow();

    expect(rainWindow([...window, at(0, 99)], CRITERIA)).toBe(24);
  });

  it('includes the hour at the target instant', () => {
    const withoutLast = completeWindow().slice(0, H - 1);

    expect(rainWindow(withoutLast, CRITERIA)).toBeNull();
    expect(rainWindow([...withoutLast, at(H, 1)], CRITERIA)).toBe(24);
  });

  it('excludes an hour past the target instant', () => {
    const window = completeWindow();

    expect(rainWindow([...window, at(H + 1, 99)], CRITERIA)).toBe(24);
  });

  describe('knowability', () => {
    // Every row refetched after T. On the live axis the pipeline had none of
    // them, so there is no window at all.
    const refetched = () =>
      Array.from({ length: H }, (_, i) =>
        at(i + 1, 1, { recordedAt: new Date(T.getTime() + 86400 * 1000) }),
      );

    it('hides rows fetched after the issue instant on the live axis', () => {
      expect(rainWindow(refetched(), CRITERIA)).toBeNull();
    });

    // AC-R8. The archive axis judges on issuedAt, and matching the lead to the
    // horizon already put every issue time at or before T.
    it('sees the same rows on the archive axis, where they were issued in time', () => {
      expect(rainWindow(refetched(), { ...CRITERIA, axis: 'validTime' })).toBe(24);
    });

    it('defaults to the strict axis when none is given', () => {
      expect(rainWindow(refetched(), CRITERIA)).toBe(
        rainWindow(refetched(), { ...CRITERIA, axis: 'recordedAt' }),
      );
    });
  });
});
