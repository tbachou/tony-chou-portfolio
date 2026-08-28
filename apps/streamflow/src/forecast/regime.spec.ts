import { classifyRegime } from './regime';
import type { StoredObservation } from '../types';

const GAUGE = 'gauge_darby';
const AT = new Date('2026-08-20T18:00:00Z');

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
    expect(classifyRegime(sevenCalmDays(200), AT, 200)).toBe('BASEFLOW');
  });

  it('calls it rising once the 12 hour change reaches a tenth of the median', () => {
    // Median 200, so the threshold is +20 over twelve hours.
    const history = sevenCalmDays(200);

    expect(classifyRegime(history, AT, 220)).toBe('RISING');
    expect(classifyRegime(history, AT, 219)).toBe('BASEFLOW');
  });

  it('calls a high but steady river a peak', () => {
    // 1.5x the median, with no twelve hour change to speak of.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 300);

    expect(classifyRegime(history, AT, 300)).toBe('PEAK');
  });

  it('prefers rising over peak when both would apply', () => {
    // High AND climbing. Filing this as PEAK would put the hardest moment to
    // forecast in the same bucket as the easy plateau that follows it.
    const history = sevenCalmDays(200);

    expect(classifyRegime(history, AT, 3000)).toBe('RISING');
  });

  it('calls a river draining back towards normal falling', () => {
    // Median 200, so the bar is a tenth of max(210, 200), which is 21 down.
    // A drop of 590 clears it many times over. This used to be BASEFLOW, and
    // pooling a drain with a flat week is what the fourth class exists to end.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 800);

    expect(classifyRegime(history, AT, 210)).toBe('FALLING');
  });

  it('calls a high river dropping hard falling rather than a peak', () => {
    // Coming down hard and a long way above normal. It used to be PEAK, which
    // put a one sided sample in the same bucket as the unbiased plateau.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 5000);

    expect(classifyRegime(history, AT, 2000)).toBe('FALLING');
  });

  it('counts a fall of exactly a tenth of the current value, and not a hair less', () => {
    // Above the median, so max(v, m) is v: at 1000 the bar is 100 down.
    const atTheBar = withValueTwelveHoursBack(sevenCalmDays(200), 1100);
    const oneShort = withValueTwelveHoursBack(sevenCalmDays(200), 1099);

    expect(classifyRegime(atTheBar, AT, 1000)).toBe('FALLING');
    // One cubic foot per second short, and still five times the median, so it
    // falls through to the class the ordering leaves for a high river.
    expect(classifyRegime(oneShort, AT, 1000)).toBe('PEAK');
  });

  it('holds the bar at the median when the river is below it', () => {
    // At a fifth of normal flow a tenth of the current value is five cubic
    // feet per second, which is ordinary summer drying down. The floor keeps
    // it out of the class built for post storm drops.
    const gentle = withValueTwelveHoursBack(sevenCalmDays(200), 55);

    expect(classifyRegime(gentle, AT, 50)).toBe('BASEFLOW');

    // The same low river dropping by a tenth of the median does count, which
    // is the floor doing its job rather than switching the class off.
    const steep = withValueTwelveHoursBack(sevenCalmDays(200), 70);

    expect(classifyRegime(steep, AT, 50)).toBe('FALLING');
  });

  it('prefers rising over falling and peak when the river is climbing', () => {
    // AC-F2: nothing that was RISING moves. The falling test is only ever
    // reached by a river that is not climbing.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 100);

    expect(classifyRegime(history, AT, 3000)).toBe('RISING');
  });

  it('never reads a value from at or after the moment it judges', () => {
    const history = [
      ...sevenCalmDays(200),
      row(AT.getTime(), 9000),
      row(AT.getTime() + 3600000, 9000),
    ];

    // The future readings would drag the median if they were counted.
    expect(classifyRegime(history, AT, 200)).toBe('BASEFLOW');
  });

  it('refuses to judge from too little history', () => {
    const thin = sevenCalmDays(200).slice(-100);

    expect(classifyRegime(thin, AT, 200)).toBeNull();
  });

  it('refuses to judge when nothing sits near twelve hours back', () => {
    // Plenty of readings, but a hole exactly where the change is measured.
    const wanted = AT.getTime() - 12 * 60 * 60 * 1000;
    const holed = sevenCalmDays(200).filter(
      (entry) => Math.abs(entry.validTime.getTime() - wanted) > 3 * 3600000,
    );

    expect(classifyRegime(holed, AT, 200)).toBeNull();
  });

  it('returns null rather than defaulting to calm', () => {
    // Guessing BASEFLOW would file storm errors under the easy regime and
    // flatter every summary built on top of them.
    expect(classifyRegime([], AT, 200)).toBeNull();
  });
});
