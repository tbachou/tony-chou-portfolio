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

  it('calls it falling once the 12 hour drop reaches a tenth of the median', () => {
    // Median 200, so the threshold is -20 over twelve hours, the mirror of
    // the rising test above. The boundary is inclusive on both sides.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 220);

    expect(classifyRegime(history, AT, 200)).toBe('FALLING');
    expect(classifyRegime(history, AT, 201)).toBe('BASEFLOW');
  });

  it('still calls a high falling river a peak', () => {
    // Coming down hard but a long way above normal. Falling is tested after
    // peak precisely so this stays PEAK: testing it first would move most of
    // the peak bucket's sample into falling and starve the regime the whole
    // conditioning exists to serve.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 5000);

    expect(classifyRegime(history, AT, 2000)).toBe('PEAK');
  });

  it('leaves a gently falling river in baseflow', () => {
    // Down, but by less than a tenth of the median over twelve hours. This is
    // the boundary the falling test draws, and where it is drawn is the open
    // question the follow-up asks the second recession to settle.
    const history = withValueTwelveHoursBack(sevenCalmDays(200), 215);

    expect(classifyRegime(history, AT, 200)).toBe('BASEFLOW');
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

/**
 * Big Darby Creek at Darbyville, every thirty minutes from 2026-08-15T00:00Z,
 * in cubic feet per second, straight from the USGS instantaneous values
 * service. It covers the flood that crested at 7,470 on 2026-08-20 and the
 * recession that followed, which is the event the falling regime was added
 * for.
 *
 * Thirty minutes rather than the gauge's own fifteen, to halve the size of
 * the fixture. Seven days at this spacing is 336 readings, comfortably over
 * the 224 the classifier requires, and every label below is the one the full
 * resolution record produces: the medians agree to within one percent.
 */
const DARBY_RECESSION_START = new Date('2026-08-15T00:00:00Z');
const DARBY_RECESSION_STEP_MS = 30 * 60 * 1000;
const DARBY_RECESSION_CFS = [
  1390, 1410, 1410, 1410, 1410, 1440, 1450, 1490, 1530, 1600, 1620, 1670,
  1720, 1790, 1850, 1890, 1990, 2030, 2090, 2100, 2140, 2160, 2180, 2230,
  2250, 2270, 2310, 2340, 2350, 2370, 2390, 2430, 2450, 2490, 2490, 2500,
  2530, 2560, 2600, 2610, 2610, 2640, 2650, 2690, 2690, 2700, 2750, 2750,
  2750, 2790, 2800, 2800, 2810, 2830, 2830, 2840, 2850, 2870, 2870, 2870,
  2870, 2900, 2920, 2960, 3020, 3060, 3120, 3180, 3220, 3260, 3330, 3380,
  3430, 3470, 3490, 3530, 3590, 3610, 3670, 3720, 3770, 3830, 3920, 3940,
  3980, 3990, 3960, 3960, 3880, 3760, 3700, 3590, 3470, 3350, 3250, 3190,
  3150, 3050, 3020, 3010, 3030, 3030, 3060, 3060, 3100, 3160, 3250, 3310,
  3430, 3520, 3610, 3670, 3800, 3910, 3940, 4080, 4120, 4210, 4270, 4320,
  4350, 4400, 4370, 4400, 4330, 4310, 4240, 4140, 4130, 4020, 4010, 3940,
  3920, 3850, 3810, 3720, 3680, 3620, 3560, 3530, 3510, 3510, 3470, 3440,
  3460, 3430, 3470, 3470, 3560, 3620, 3660, 3690, 3730, 3770, 3810, 3830,
  3830, 3870, 3870, 3870, 3860, 3850, 3850, 3820, 3800, 3770, 3770, 3750,
  3720, 3680, 3630, 3620, 3560, 3530, 3480, 3400, 3330, 3260, 3210, 3140,
  3100, 3050, 2970, 2920, 2870, 2820, 2790, 2740, 2700, 2660, 2610, 2600,
  2570, 2530, 2530, 2480, 2440, 2420, 2410, 2380, 2360, 2350, 2310, 2270,
  2250, 2220, 2180, 2160, 2150, 2090, 2080, 2040, 2020, 2000, 1960, 1940,
  1910, 1880, 1870, 1840, 1820, 1800, 1760, 1750, 1730, 1700, 1670, 1660,
  1640, 1610, 1600, 1590, 1550, 1520, 1510, 1500, 1470, 1460, 1450, 1430,
  1410, 1390, 1360, 1360, 1340, 1330, 1330, 1290, 1300, 1290, 1280, 1270,
  1270, 1270, 1260, 1300, 1350, 1460, 1790, 2520, 3290, 4040, 4540, 4910,
  5230, 5500, 5730, 5960, 6130, 6300, 6480, 6600, 6790, 6890, 7070, 7070,
  7270, 7270, 7390, 7440, 7420, 7470, 7370, 7320, 7180, 7030, 6840, 6660,
  6480, 6260, 6130, 5880, 5780, 5660, 5570, 5530, 5460, 5440, 5390, 5400,
  5400, 5400, 5390, 5360, 5360, 5370, 5330, 5360, 5360, 5370, 5360, 5310,
  5330, 5270, 5260, 5220, 5170, 5170, 5150, 5100, 5040, 5010, 4950, 4950,
  4880, 4810, 4790, 4730, 4690, 4600, 4560, 4520, 4480, 4410, 4330, 4300,
  4260, 4190, 4130, 4080, 4010, 3940, 3870, 3760, 3670, 3560, 3430, 3240,
  3160, 2990, 2870, 2730, 2610, 2470, 2400, 2300, 2210, 2170, 2090, 2040,
  2000, 1950, 1910, 1870, 1870, 1840, 1770, 1750, 1740, 1720, 1710, 1670,
  1640, 1630, 1600, 1590, 1560, 1550, 1540, 1500, 1500, 1500, 1500, 1500,
  1470, 1470, 1480, 1460, 1430, 1400, 1390, 1390, 1380, 1360, 1340, 1330,
  1320, 1310, 1300, 1290, 1270, 1270, 1250, 1240, 1220, 1220, 1230, 1210,
  1200, 1190, 1170, 1170, 1160, 1150, 1140, 1120, 1080, 1090, 1070, 1060,
  1050, 1050, 1050, 1050, 1040, 1040, 1020, 1020, 1020, 1010, 995, 988,
  988, 973, 966, 952, 903, 931, 910, 910, 889, 896, 889, 883, 869, 863,
  856, 856, 849, 843, 843, 849, 856, 830, 836, 843, 817, 830, 817, 798,
  785, 785, 785, 785, 785, 792, 792, 785, 779, 754, 767, 767, 748, 730,
  718, 748, 742, 730, 712, 730, 706, 706, 706, 706, 700, 676, 676, 663,
  663, 649, 642, 649, 642, 635, 649, 642, 656, 621, 642, 635, 621, 607,
  607, 621, 614, 588, 607, 607, 601, 581, 581, 581, 588, 575, 581, 575,
  575, 549, 543, 531, 549, 525, 549, 507, 513, 502, 507, 502, 525, 513,
  502, 507, 468, 490, 490, 479, 468, 468, 473, 473, 479, 468, 457, 457,
  446, 441, 457, 446, 446, 436, 446, 451, 462,
];

function darbyRecession(): StoredObservation[] {
  return DARBY_RECESSION_CFS.map((value, index) =>
    row(DARBY_RECESSION_START.getTime() + index * DARBY_RECESSION_STEP_MS, value),
  );
}

/** The newest reading at or before `at`, which is what production classifies on. */
function valueAtIssue(history: StoredObservation[], at: Date): number {
  let newest: StoredObservation | undefined;
  for (const entry of history) {
    if (entry.validTime.getTime() > at.getTime()) continue;
    if (!newest || entry.validTime.getTime() > newest.validTime.getTime()) {
      newest = entry;
    }
  }
  if (!newest) throw new Error('fixture has no reading at or before ' + at.toISOString());
  return newest.valueCfs;
}

describe('classifyRegime over the real August 2026 recession', () => {
  const history = darbyRecession();

  function at(iso: string): ReturnType<typeof classifyRegime> {
    const instant = new Date(iso);
    return classifyRegime(history, instant, valueAtIssue(history, instant));
  }

  it('calls the steep limb of the recession falling, not baseflow', () => {
    // A real issue slot, thirty six hours after the crest: 4,260 down to
    // 2,000 against a seven day median of about 3,470. Under the three state
    // taxonomy this was BASEFLOW by elimination, which is what priced a
    // week of recession forecasts from the errors of flat, calm days.
    expect(at('2026-08-22T12:00:00Z')).toBe('FALLING');
    expect(at('2026-08-22T18:00:00Z')).toBe('FALLING');
    expect(at('2026-08-23T00:00:00Z')).toBe('FALLING');
  });

  it('keeps a slot high on the falling limb in peak', () => {
    // Already receding, 6,480 down to 5,330, but still above 1.5 times the
    // median. Peak is tested first, so this keeps its label and its sample.
    expect(at('2026-08-21T12:00:00Z')).toBe('PEAK');
  });

  it('still calls the rising limb rising', () => {
    expect(at('2026-08-20T12:00:00Z')).toBe('RISING');
    expect(at('2026-08-20T18:00:00Z')).toBe('RISING');
  });

  /**
   * Measured, not desired. This is the gap between what the falling regime
   * fixes and what the finding of 2026-08-27 actually observed, and it is
   * asserted so the limit is visible in the suite rather than only in a
   * document.
   *
   * These four slots issued the eight live forecasts that all missed their
   * eighty percent interval. They are five days into the recession, where the
   * river is still falling 12 to 20 percent of its own value every twelve
   * hours but the seven day median is still inflated by the flood, so the
   * drop never reaches a tenth of that median. They stay BASEFLOW under the
   * chosen threshold. See findings/2026-08-27-falling-threshold-misses-tail.md.
   */
  it('does not reach the gentle tail, where the observed misses happened', () => {
    expect(at('2026-08-25T12:00:00Z')).toBe('BASEFLOW');
    expect(at('2026-08-25T18:00:00Z')).toBe('BASEFLOW');
    expect(at('2026-08-26T00:00:00Z')).toBe('BASEFLOW');
    expect(at('2026-08-26T06:00:00Z')).toBe('BASEFLOW');
  });
});
