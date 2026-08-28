import { classifyRegime } from './regime';
import type { StoredObservation } from '../types';

const GAUGE = 'gauge_darby';
const AT = new Date('2026-08-20T18:00:00Z');

/**
 * The real gauge's frozen floor. Well below every value these fixtures use, so
 * it never binds unless a test deliberately drops beneath it.
 */
const FLOOR = 18.9;

function row(validTime: number, valueCfs: number): StoredObservation {
  return {
    gaugeId: GAUGE,
    validTime: new Date(validTime),
    recordedAt: new Date(validTime),
    valueCfs,
    qualifier: 'PROVISIONAL',
  };
}

/**
 * Seven days of quarter hour readings ending just before `AT`, all at `flat`,
 * which makes the median exactly `flat` and the 12 hour change exactly zero
 * until a test bends it.
 */
function sevenCalmDays(flat: number): StoredObservation[] {
  const out: StoredObservation[] = [];
  for (let minute = 7 * 24 * 60; minute >= 15; minute -= 15) {
    out.push(row(AT.getTime() - minute * 60000, flat));
  }
  return out;
}

/** Replaces the reading nearest 12 hours back, which is what the rule reads. */
function withValueTwelveHoursBack(
  history: StoredObservation[],
  value: number,
): StoredObservation[] {
  const wanted = AT.getTime() - 12 * 60 * 60 * 1000;
  return history.map((entry) =>
    entry.validTime.getTime() === wanted ? row(wanted, value) : entry,
  );
}

describe('classifyRegime', () => {
  it('calls a flat river baseflow', () => {
    expect(classifyRegime(sevenCalmDays(200), AT, 200, FLOOR)).toBe('BASEFLOW');
  });

  it('calls it rising once the 12 hour change reaches a tenth of the median', () => {
    // Median 200, so the threshold is +20 over twelve hours.
    const history = sevenCalmDays(200);

    expect(classifyRegime(history, AT, 220, FLOOR)).toBe('RISING');
    expect(classifyRegime(history, AT, 219, FLOOR)).toBe('BASEFLOW');
  });

  it('calls a high but steady river a peak', () => {
    // 1.5x the median, with no twelve hour change to speak of.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 300);

    expect(classifyRegime(history, AT, 300, FLOOR)).toBe('PEAK');
  });

  it('prefers rising over peak when both would apply', () => {
    // High AND climbing. Filing this as PEAK would put the hardest moment to
    // forecast in the same bucket as the easy plateau that follows it.
    const history = sevenCalmDays(200);

    expect(classifyRegime(history, AT, 3000, FLOOR)).toBe('RISING');
  });

  it('calls a river draining back towards normal falling', () => {
    // Median 200, so the bar is a tenth of max(210, 200), which is 21 down.
    // A drop of 590 clears it many times over. This used to be BASEFLOW, and
    // pooling a drain with a flat week is what the fourth class exists to end.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 800);

    expect(classifyRegime(history, AT, 210, FLOOR)).toBe('FALLING');
  });

  it('calls a high river dropping hard falling rather than a peak', () => {
    // Coming down hard and a long way above normal. It used to be PEAK, which
    // put a one sided sample in the same bucket as the unbiased plateau.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 5000);

    expect(classifyRegime(history, AT, 2000, FLOOR)).toBe('FALLING');
  });

  it('counts a fall of exactly a tenth of the current value, and not a hair less', () => {
    // Above the median, so max(v, m) is v: at 1000 the bar is 100 down.
    const atTheBar = withValueTwelveHoursBack(sevenCalmDays(200), 1100);
    const oneShort = withValueTwelveHoursBack(sevenCalmDays(200), 1099);

    expect(classifyRegime(atTheBar, AT, 1000, FLOOR)).toBe('FALLING');
    // One cubic foot per second short, and still five times the median, so it
    // falls through to the class the ordering leaves for a high river.
    expect(classifyRegime(oneShort, AT, 1000, FLOOR)).toBe('PEAK');
  });

  it('measures the fall against the current value, not the median', () => {
    // The median is still carrying a storm the river has long left behind, so
    // 50 is well under it. A fall of a tenth of 50 counts anyway. Under the
    // superseded rule the median held the bar at 20 and this was BASEFLOW,
    // which is the failure the denominator child exists to fix.
    const draining = withValueTwelveHoursBack(sevenCalmDays(200), 55);

    expect(classifyRegime(draining, AT, 50, FLOOR)).toBe('FALLING');
  });

  it('leaves an ordinary slow drawdown alone', () => {
    // Two percent over twelve hours at a fifth of normal flow. Drying down,
    // not draining, and the threshold of five keeps it out.
    const gentle = withValueTwelveHoursBack(sevenCalmDays(250), 51);

    expect(classifyRegime(gentle, AT, 50, FLOOR)).toBe('BASEFLOW');
  });

  it('takes the threshold from the flow floor once the river is under it', () => {
    // Below the floor a tenth of the value would be 1 cubic foot per second,
    // which is inside the noise. The floor holds the bar at 1.89 instead, and
    // unlike the median nothing can inflate it.
    const noise = withValueTwelveHoursBack(sevenCalmDays(200), 11.5);
    expect(classifyRegime(noise, AT, 10, FLOOR)).toBe('BASEFLOW');

    const realDrop = withValueTwelveHoursBack(sevenCalmDays(200), 12);
    expect(classifyRegime(realDrop, AT, 10, FLOOR)).toBe('FALLING');
  });

  it('refuses a flow floor that cannot bound the threshold', () => {
    // A zero floor puts the threshold at zero, where a river standing still
    // counts as falling. A caller with no floor is a build error, not a row
    // this can classify, so it throws rather than returning null.
    const history = sevenCalmDays(200);

    expect(() => classifyRegime(history, AT, 200, 0)).toThrow(/positive flow floor/);
    expect(() => classifyRegime(history, AT, 200, -1)).toThrow(/positive flow floor/);
    expect(() => classifyRegime(history, AT, 200, NaN)).toThrow(/positive flow floor/);
  });

  it('catches the four recession slots the superseded rule missed', () => {
    // Measured from the real gauge on 2026-08-25 and 26 and recorded in
    // findings/2026-08-27-falling-threshold-misses-tail.md. Every one of them
    // classified BASEFLOW under the median floor while the river shed fifteen
    // to twenty percent of itself every twelve hours.
    const observed: [number, number, number][] = [
      // value, seven day median, twelve hour change
      [614, 1720, -92],
      [575, 1595, -67],
      [525, 1500, -89],
      [479, 1410, -96],
    ];

    for (const [value, median, change] of observed) {
      const history = withValueTwelveHoursBack(
        sevenCalmDays(median),
        value - change,
      );
      expect(classifyRegime(history, AT, value, FLOOR)).toBe('FALLING');
    }
  });

  it('reproduces the first slot issued after the migration', () => {
    // 2026-08-28 12:00 UTC, on the tail of a 5,330 crest. The median was still
    // 730, which put the superseded threshold at 73 and called this calm.
    const history = withValueTwelveHoursBack(sevenCalmDays(730), 345);

    expect(classifyRegime(history, AT, 303, FLOOR)).toBe('FALLING');
  });

  it('never lets the median decide a case above it', () => {
    // AC-D3: where the river is at or above 1.5 times the median, the old
    // max(v, m) already resolved to v, so the boundary sits at a tenth of the
    // value whatever the median is. That is why no stored PEAK row can move.
    for (const [median, value] of [
      [200, 300],
      [200, 5000],
      [1000, 1500],
      [50, 900],
    ]) {
      const atTheBar = withValueTwelveHoursBack(
        sevenCalmDays(median),
        value + 0.1 * value,
      );
      const justShort = withValueTwelveHoursBack(
        sevenCalmDays(median),
        value + 0.1 * value - 1,
      );

      expect(classifyRegime(atTheBar, AT, value, FLOOR)).toBe('FALLING');
      expect(classifyRegime(justShort, AT, value, FLOOR)).toBe('PEAK');
    }
  });

  it('prefers rising over falling and peak when the river is climbing', () => {
    // AC-F2: nothing that was RISING moves. The falling test is only ever
    // reached by a river that is not climbing.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 100);

    expect(classifyRegime(history, AT, 3000, FLOOR)).toBe('RISING');
  });

  it('never reads a value from at or after the moment it judges', () => {
    const history = [
      ...sevenCalmDays(200),
      row(AT.getTime(), 9000),
      row(AT.getTime() + 3600000, 9000),
    ];

    // The future readings would drag the median if they were counted.
    expect(classifyRegime(history, AT, 200, FLOOR)).toBe('BASEFLOW');
  });

  it('refuses to judge from too little history', () => {
    const thin = sevenCalmDays(200).slice(-100);

    expect(classifyRegime(thin, AT, 200, FLOOR)).toBeNull();
  });

  it('refuses to judge when nothing sits near twelve hours back', () => {
    // Plenty of readings, but a hole exactly where the change is measured.
    const wanted = AT.getTime() - 12 * 60 * 60 * 1000;
    const holed = sevenCalmDays(200).filter(
      (entry) => Math.abs(entry.validTime.getTime() - wanted) > 3 * 3600000,
    );

    expect(classifyRegime(holed, AT, 200, FLOOR)).toBeNull();
  });

  it('returns null rather than defaulting to calm', () => {
    // Guessing BASEFLOW would file storm errors under the easy regime and
    // flatter every summary built on top of them.
    expect(classifyRegime([], AT, 200, FLOOR)).toBeNull();
  });
});
