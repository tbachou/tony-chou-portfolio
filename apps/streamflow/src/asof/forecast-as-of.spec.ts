import { forecastKnowableAt, forecastsVisibleAt } from './forecast-as-of';
import type { KnowabilityAxis, StoredForecast } from '../types';

/**
 * The fixture is built so that the two columns disagree, which is what AC-R8a
 * asks a test to prove.
 *
 * Every row is at lead 48, so `issuedAt` sits exactly two days before
 * `validTime`, and the issue time `T` is chosen to fall between them. The
 * archive axis must then judge these rows on `issuedAt` and see them; the
 * `row[axis]` lookup the rest of the codebase uses would judge them on
 * `validTime` and hide them. `naiveVisible` below is that wrong version,
 * written out so the disagreement is asserted rather than assumed.
 */
const GAUGE = 'gauge-darby';
const MODEL = 'gfs_seamless';
const LEAD = 48;

const T = new Date('2026-08-19T00:00:00.000Z');

function forecast(
  validTime: string,
  recordedAt: string,
  precipMm: number,
): StoredForecast {
  const valid = new Date(validTime);

  return {
    gaugeId: GAUGE,
    validTime: valid,
    leadHours: LEAD,
    // Derived exactly as the writer derives it, so the fixture cannot drift
    // from the invariant that `leadHours` is canonical.
    issuedAt: new Date(valid.getTime() - LEAD * 60 * 60 * 1000),
    recordedAt: new Date(recordedAt),
    precipMm,
    tempC: null,
    model: MODEL,
  };
}

/** Issued 08-18, due 08-20. Visible on both axes at T. */
const IN_WINDOW = forecast('2026-08-20T00:00:00.000Z', '2026-08-18T00:05:00.000Z', 4);

/** The same hour, refetched a week later. Only the archive axis may see it. */
const LATE_REVISION = forecast(
  '2026-08-20T00:00:00.000Z',
  '2026-08-25T00:00:00.000Z',
  9,
);

/** Issued exactly at T. Inclusive, so the archive axis sees it. */
const ISSUED_AT_T = forecast('2026-08-21T00:00:00.000Z', '2026-08-19T00:05:00.000Z', 2);

/** Issued a day after T. Invisible on either axis. */
const ISSUED_AFTER_T = forecast(
  '2026-08-22T00:00:00.000Z',
  '2026-08-20T00:05:00.000Z',
  7,
);

const ROWS = [IN_WINDOW, LATE_REVISION, ISSUED_AT_T, ISSUED_AFTER_T];

/**
 * The bug AC-R8a names, written out so it can be compared against rather than
 * described. This is `reconstructAsOf`'s idiom applied to a weather row: it
 * compiles, because a `StoredForecast` carries a `validTime` too.
 */
function naiveVisible(
  rows: readonly StoredForecast[],
  asOf: Date,
  axis: KnowabilityAxis,
): StoredForecast[] {
  return rows.filter((row) => row[axis].getTime() <= asOf.getTime());
}

describe('forecastKnowableAt', () => {
  it('reads recordedAt when no axis is given', () => {
    expect(forecastKnowableAt(IN_WINDOW)).toEqual(IN_WINDOW.recordedAt);
  });

  it('reads recordedAt on the live axis', () => {
    expect(forecastKnowableAt(IN_WINDOW, 'recordedAt')).toEqual(IN_WINDOW.recordedAt);
  });

  // AC-R8a. The axis is spelled `validTime` and the column is `issuedAt`.
  it('reads issuedAt, not validTime, on the archive axis', () => {
    expect(forecastKnowableAt(IN_WINDOW, 'validTime')).toEqual(IN_WINDOW.issuedAt);
    expect(forecastKnowableAt(IN_WINDOW, 'validTime')).not.toEqual(IN_WINDOW.validTime);
  });

  // The fixture earns its keep only if the two columns actually differ.
  it('is built on a row whose two columns disagree', () => {
    expect(IN_WINDOW.issuedAt.getTime()).toBeLessThan(IN_WINDOW.validTime.getTime());
    expect(IN_WINDOW.issuedAt.getTime()).toBeLessThanOrEqual(T.getTime());
    expect(IN_WINDOW.validTime.getTime()).toBeGreaterThan(T.getTime());
  });
});

describe('forecastsVisibleAt', () => {
  it('bounds on recordedAt when no axis is given', () => {
    expect(forecastsVisibleAt(ROWS, T)).toEqual([IN_WINDOW]);
  });

  it('gives the same answer for an explicit recordedAt axis', () => {
    expect(forecastsVisibleAt(ROWS, T, 'recordedAt')).toEqual(
      forecastsVisibleAt(ROWS, T),
    );
  });

  // AC-R8. A row the pipeline fetched after T is invisible on the live axis,
  // however long ago the forecast behind it was issued.
  it('hides a row fetched after the issue time on the live axis', () => {
    const visible = forecastsVisibleAt(ROWS, T, 'recordedAt');

    expect(visible).not.toContain(LATE_REVISION);
    expect(visible).not.toContain(ISSUED_AT_T);
  });

  // AC-R8. On the archive axis a row counts once it had been issued by T,
  // whenever this pipeline got round to fetching it.
  it('judges the archive axis on issuedAt', () => {
    const visible = forecastsVisibleAt(ROWS, T, 'validTime');

    expect(visible).toContain(IN_WINDOW);
    expect(visible).toContain(LATE_REVISION);
    expect(visible).not.toContain(ISSUED_AFTER_T);
  });

  it('includes a row issued exactly at the issue time', () => {
    expect(forecastsVisibleAt(ROWS, T, 'validTime')).toContain(ISSUED_AT_T);
    expect(forecastKnowableAt(ISSUED_AT_T, 'validTime')).toEqual(T);
  });

  /**
   * AC-R8a, stated as a difference rather than as a claim.
   *
   * The `row[axis]` version hides every row here, because a rain window is
   * drawn from the hours after the issue time and each of those hours has a
   * `validTime` later than T by construction. The failure starves rather than
   * leaks, so nothing would throw and every rain feature would simply come back
   * null under AC-R10. That is why it needs a test rather than review.
   */
  it('disagrees with a row[axis] lookup on the archive axis', () => {
    const correct = forecastsVisibleAt(ROWS, T, 'validTime');
    const naive = naiveVisible(ROWS, T, 'validTime');

    expect(correct).not.toEqual(naive);
    expect(correct).toHaveLength(3);
    expect(naive).toHaveLength(0);
  });

  it('agrees with a row[axis] lookup on the live axis, where the idiom is right', () => {
    expect(forecastsVisibleAt(ROWS, T, 'recordedAt')).toEqual(
      naiveVisible(ROWS, T, 'recordedAt'),
    );
  });

  /**
   * Visibility and reduction are two separate steps (AC-R8), and this function
   * is only the first. Both revisions of the 08-20 hour come back on the
   * archive axis. Summing this set would count that hour twice, which is the
   * double count AC-R7's reduction exists to prevent, and counting it would let
   * one revised hour pad a short window to the length AC-R10 requires.
   */
  it('does not reduce, so a revised hour appears more than once', () => {
    const visible = forecastsVisibleAt(ROWS, T, 'validTime');
    const sameHour = visible.filter(
      (row) => row.validTime.getTime() === IN_WINDOW.validTime.getTime(),
    );

    expect(sameHour).toHaveLength(2);
    expect(sameHour.map((row) => row.precipMm).sort()).toEqual([4, 9]);
  });

  it('returns nothing at all when the issue time predates every row', () => {
    expect(forecastsVisibleAt(ROWS, new Date('2024-01-01T00:00:00.000Z'), 'validTime'))
      .toEqual([]);
  });

  it('leaves the rows it was given untouched', () => {
    const before = [...ROWS];

    forecastsVisibleAt(ROWS, T, 'validTime');

    expect(ROWS).toEqual(before);
  });
});
