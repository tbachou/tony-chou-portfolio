import { rainWindow } from './rain';
import type { RainCriteria } from './rain';
import type { StoredForecast } from '../types';

/**
 * The project's central correctness property, stated over weather rows.
 *
 * AC-R9. A prediction issued at `T` may draw on nothing that was not knowable
 * at `T`: no row this pipeline fetched after `T` on the live axis, and none
 * that was issued after `T` on the archive axis. This is the parent's AC-13
 * extended to the second data source, and it sits alongside the observation
 * side of the same rule rather than replacing it. That side is already held by
 * `asof/as-of.spec.ts` on the reconstruction itself, and by `baselines.spec.ts`,
 * `regime.spec.ts`, `bucket.spec.ts` and `predict.spec.ts` on the readers above
 * it.
 *
 * **How a number returning function is held to a rule about rows.**
 * `rainWindow` hands back millimetres, not the rows it summed, so the property
 * cannot be checked by looking at what came back. It is checked by contrast
 * instead. Every fixture below is a clean window at one millimetre an hour,
 * plus a shadow of that window: one row at every single hour, each carrying a
 * thousand millimetres and a newer `recordedAt` than the clean row it shadows,
 * so a visible shadow does not merely add to its hour, it replaces it. One
 * shadow leaking moves the total by three orders of magnitude and all of them
 * leaking is the total. There is no arrangement in which a leak looks like a
 * rounding difference.
 *
 * **Every fixture is read twice, and the second read is the point.** A shadow
 * hidden on one axis is legitimately visible on the other, where it does
 * dominate. That second read is the control: it proves the shadows are a real
 * leak candidate rather than rows the window bound, the lead rule or the gauge
 * filter had already thrown away for some unrelated reason. Without it this
 * whole file would pass just as happily against a fixture that could never
 * have leaked in the first place, which is the way a leakage test usually goes
 * wrong.
 */

const GAUGE = 'gauge-darby';
const MODEL = 'gfs_seamless';
const H = 24;
const HOUR = 3600 * 1000;
const T = new Date('2026-08-19T00:00:00.000Z');

/** A thousand millimetres, so a leak is never an argument about floats. */
const POISON_MM = 1000;

const LIVE: RainCriteria = {
  gaugeId: GAUGE,
  model: MODEL,
  horizonHours: H,
  issuedAt: T,
};

/** The archive axis, which only the hindcast passes. */
const ARCHIVE: RainCriteria = { ...LIVE, axis: 'validTime' };

interface Options {
  /** Overrides the derived issue time. Only a forged row passes this. */
  issuedAt?: Date;
  recordedAt?: Date;
  precipMm?: number;
}

/** One row valid `offsetHours` after the issue instant, at the matching lead. */
function at(offsetHours: number, options: Options = {}): StoredForecast {
  const validTime = new Date(T.getTime() + offsetHours * HOUR);

  return {
    gaugeId: GAUGE,
    validTime,
    leadHours: H,
    // Derived exactly as the writer derives it unless a test forges it, so an
    // ordinary fixture row cannot drift from the invariant that `leadHours` is
    // canonical and `issuedAt` follows from it.
    issuedAt: options.issuedAt ?? new Date(validTime.getTime() - H * HOUR),
    // An hour before the prediction, so the whole clean window is visible on
    // the live axis and no clean row can tie with the shadow over it. The
    // reduction breaks ties by keeping the first row seen, which would make
    // these assertions depend on array order rather than on the rule.
    recordedAt: options.recordedAt ?? new Date(T.getTime() - HOUR),
    precipMm: options.precipMm ?? 1,
    tempC: null,
    model: MODEL,
  };
}

/** Hours 1 to 24 after the issue instant, one millimetre each, all knowable. */
function cleanWindow(): StoredForecast[] {
  return Array.from({ length: H }, (_, index) => at(index + 1));
}

/**
 * A shadow of every hour, fetched an hour after the prediction.
 *
 * Invisible on the live axis, where `recordedAt` is the clock. Visible on the
 * archive axis, where the issue time is, and these were issued exactly when
 * the clean rows were: this is an ordinary refetch, the commonest way a row
 * that must not be seen turns up in a real store.
 */
function fetchedLate(): StoredForecast[] {
  return Array.from({ length: H }, (_, index) =>
    at(index + 1, {
      recordedAt: new Date(T.getTime() + HOUR),
      precipMm: POISON_MM,
    }),
  );
}

/**
 * A shadow of every hour, issued an hour after the prediction.
 *
 * Invisible on the archive axis, where `issuedAt` is the clock. Visible on the
 * live axis, where the fetch time is, and these were fetched at the issue
 * instant itself.
 *
 * **`issuedAt` is forged here, and no writer in this pipeline can produce such
 * a row.** `leadHours` is canonical, `issuedAt` is derived from it, and a lead
 * of 24 on an hour inside a 24 hour window always lands the issue time at or
 * before the prediction. That is exactly why the row is written by hand: the
 * archive bound has to be enforced by reading the column, not inferred from
 * the lead rule happening to hold, or it stops being a guard the moment the
 * lead rule loosens. The structural version of the same claim is pinned at the
 * bottom of this file, so the two are read together.
 */
function issuedLate(): StoredForecast[] {
  return Array.from({ length: H }, (_, index) =>
    at(index + 1, {
      issuedAt: new Date(T.getTime() + HOUR),
      recordedAt: T,
      precipMm: POISON_MM,
    }),
  );
}

describe('the rain feature draws on nothing that was not knowable at the issue instant', () => {
  it('sums the clean window the same on either axis, so the fixture starts honest', () => {
    expect(rainWindow(cleanWindow(), LIVE)).toBe(H);
    expect(rainWindow(cleanWindow(), ARCHIVE)).toBe(H);
  });

  describe('on the live axis, where the clock is recordedAt', () => {
    const rows = () => [...cleanWindow(), ...fetchedLate()];

    it('draws on no row fetched after the issue instant', () => {
      expect(rainWindow(rows(), LIVE)).toBe(H);
    });

    it('would have been dominated by those rows had they been visible', () => {
      // The control. Same fixture, read where the shadows are legitimately
      // visible: every hour resolves to its shadow and the total is the
      // shadows alone. So the assertion above is the bound doing work, not the
      // window or the lead rule having already dropped them.
      expect(rainWindow(rows(), ARCHIVE)).toBe(H * POISON_MM);
    });

    it('refuses the window rather than summing the hours that survive', () => {
      // The last hour exists only as a row fetched too late. Twenty three
      // knowable hours is not a rain window, and reporting their sum would
      // hand the model a storm shortened by an hour and told as a fact.
      const starved = [...cleanWindow().slice(0, H - 1), ...fetchedLate().slice(H - 1)];

      expect(starved).toHaveLength(H);
      expect(rainWindow(starved, LIVE)).toBeNull();
      // The same rows make a complete window on the archive axis, so the
      // refusal is the bound's doing rather than a missing hour.
      expect(rainWindow(starved, ARCHIVE)).toBe(H - 1 + POISON_MM);
    });
  });

  describe('on the archive axis, where the clock is issuedAt', () => {
    const rows = () => [...cleanWindow(), ...issuedLate()];

    it('draws on no row issued after the issue instant', () => {
      expect(rainWindow(rows(), ARCHIVE)).toBe(H);
    });

    it('would have been dominated by those rows had they been visible', () => {
      expect(rainWindow(rows(), LIVE)).toBe(H * POISON_MM);
    });

    it('refuses the window rather than summing the hours that survive', () => {
      const starved = [...cleanWindow().slice(0, H - 1), ...issuedLate().slice(H - 1)];

      expect(starved).toHaveLength(H);
      expect(rainWindow(starved, ARCHIVE)).toBeNull();
      expect(rainWindow(starved, LIVE)).toBe(H - 1 + POISON_MM);
    });
  });

  /**
   * Two claims the fixtures rest on, pinned so neither can quietly stop being
   * true and leave the tests above passing for the wrong reason.
   */
  describe('what the fixtures rest on', () => {
    it('separates a shadow from the row it shadows by the clock alone', () => {
      // Same gauge, same model, same lead, same hour. If a shadow were
      // excluded it could only be by the axis bound, because there is nothing
      // else left for the filter to have caught it on.
      const clean = cleanWindow();

      for (const shadows of [fetchedLate(), issuedLate()]) {
        shadows.forEach((shadow, index) => {
          expect(shadow.gaugeId).toBe(clean[index].gaugeId);
          expect(shadow.model).toBe(clean[index].model);
          expect(shadow.leadHours).toBe(clean[index].leadHours);
          expect(shadow.validTime).toEqual(clean[index].validTime);
          // And newer than the row it shadows, so a visible shadow wins the
          // reduction rather than merely joining its hour.
          expect(shadow.recordedAt.getTime()).toBeGreaterThan(
            clean[index].recordedAt.getTime(),
          );
        });
      }
    });

    it('cannot reach the archive bound with a well formed row, which is why one is forged', () => {
      // With the lead matched to the horizon, a row valid inside the window
      // was always issued inside the half open range `(T - H, T]`. On well
      // formed data the archive bound therefore never binds: the lead rule has
      // already done its work. A guard that is only ever implied by another
      // rule is not a guard, and AC-R9 asks for this one to be proved, so
      // `issuedLate` writes the row the store cannot.
      for (const row of cleanWindow()) {
        expect(row.leadHours).toBe(H);
        expect(row.issuedAt.getTime()).toBeGreaterThan(T.getTime() - H * HOUR);
        expect(row.issuedAt.getTime()).toBeLessThanOrEqual(T.getTime());
      }

      for (const row of issuedLate()) {
        expect(row.issuedAt.getTime()).toBeGreaterThan(T.getTime());
        // The forgery, stated outright: this row's own lead disagrees with the
        // gap between its two timestamps, which the writer never allows.
        expect(row.validTime.getTime() - row.issuedAt.getTime()).not.toBe(
          row.leadHours * HOUR,
        );
      }
    });
  });
});
