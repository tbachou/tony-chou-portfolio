import { describe, expect, it } from 'vitest';
import { byWorstGap, gapLabel, pct } from './CalibrationPanel';
import type { CoverageGroup } from '@portfolio/streamflow';

/**
 * These three carry the panel's honesty, and each encodes a convention that
 * would ship silently if it were flipped: a dash rather than a zero for a
 * group with nothing in it, a signed gap where negative means the ranges were
 * too narrow, and an order that puts the worst offender first rather than
 * burying it alphabetically.
 */

function group(overrides: Partial<CoverageGroup> = {}): CoverageGroup {
  return {
    label: 'persistence baseflow',
    inside: 8,
    total: 10,
    observed: 0.8,
    nominal: 0.8,
    gap: 0,
    ...overrides
  };
}

describe('pct', () => {
  it('renders a share to one decimal', () => {
    expect(pct(0.786)).toBe('78.6%');
    expect(pct(0.08)).toBe('8.0%');
  });

  it('renders an empty group as a dash, never as zero', () => {
    // Zero percent coverage and no forecasts at all are opposite findings.
    expect(pct(null)).toBe('—');
    expect(pct(0)).toBe('0.0%');
  });
});

describe('gapLabel', () => {
  it('signs overconfidence negative', () => {
    // Ranges narrower than claimed: the truth escaped more often than the
    // 80 percent promised. This is the direction worth catching.
    expect(gapLabel(-0.269)).toBe('-26.9 pts');
  });

  it('signs an over-wide range positive', () => {
    expect(gapLabel(0.151)).toBe('+15.1 pts');
  });

  it('says so when a group is on its claim', () => {
    expect(gapLabel(0)).toBe('on target');
    expect(gapLabel(0.0002)).toBe('on target');
  });

  it('says nothing for a group with no data', () => {
    expect(gapLabel(null)).toBe('');
  });
});

describe('byWorstGap', () => {
  it('puts the largest miss first, in either direction', () => {
    const rows = [
      group({ label: 'near', gap: -0.02 }),
      group({ label: 'over wide', gap: 0.151 }),
      group({ label: 'worst', gap: -0.269 })
    ];

    expect([...rows].sort(byWorstGap).map((r) => r.label)).toEqual([
      'worst',
      'over wide',
      'near'
    ]);
  });

  it('treats a group with no data as no gap rather than as the worst', () => {
    // A null gap sorting first would put an empty group at the top of a table
    // whose whole purpose is showing the group that is wrong.
    const rows = [group({ label: 'empty', gap: null }), group({ label: 'bad', gap: -0.3 })];

    expect([...rows].sort(byWorstGap).map((r) => r.label)).toEqual(['bad', 'empty']);
  });
});
