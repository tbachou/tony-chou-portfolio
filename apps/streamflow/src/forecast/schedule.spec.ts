import { issueSlots, mostRecentIssueSlot } from './schedule';

describe('mostRecentIssueSlot', () => {
  it('snaps a late run back to the slot it was for', () => {
    // GitHub runs scheduled workflows late under load. The prediction still
    // belongs to the 06:00 slot, not to 06:11.
    expect(
      mostRecentIssueSlot(new Date('2026-06-01T06:11:37.482Z')).toISOString(),
    ).toBe('2026-06-01T06:00:00.000Z');
  });

  it('leaves a run that is exactly on a slot alone', () => {
    expect(
      mostRecentIssueSlot(new Date('2026-06-01T12:00:00.000Z')).toISOString(),
    ).toBe('2026-06-01T12:00:00.000Z');
  });

  it('only ever lands on 00, 06, 12 or 18 UTC', () => {
    const hours = new Set<number>();
    for (let minutes = 0; minutes < 24 * 60; minutes += 7) {
      const now = new Date(Date.UTC(2026, 5, 1) + minutes * 60 * 1000);
      const slot = mostRecentIssueSlot(now);
      hours.add(slot.getUTCHours());
      expect(slot.getUTCMinutes()).toBe(0);
      expect(slot.getTime()).toBeLessThanOrEqual(now.getTime());
    }

    expect([...hours].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
  });
});

describe('issueSlots', () => {
  it('walks six hourly from the start to the last complete slot', () => {
    const slots = issueSlots(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-02T00:00:00Z'),
    );

    expect(slots.map((slot) => slot.toISOString())).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T06:00:00.000Z',
      '2026-06-01T12:00:00.000Z',
      '2026-06-01T18:00:00.000Z',
      '2026-06-02T00:00:00.000Z',
    ]);
  });

  it('rounds a start that is not on a slot up to the next one', () => {
    // Otherwise a backfill start off the cadence would issue every hindcast
    // prediction at an instant the live record never uses.
    const slots = issueSlots(
      new Date('2026-06-01T01:30:00Z'),
      new Date('2026-06-01T13:00:00Z'),
    );

    expect(slots.map((slot) => slot.toISOString())).toEqual([
      '2026-06-01T06:00:00.000Z',
      '2026-06-01T12:00:00.000Z',
    ]);
  });

  it('returns nothing when no whole slot fits in the range', () => {
    expect(
      issueSlots(
        new Date('2026-06-01T01:00:00Z'),
        new Date('2026-06-01T05:00:00Z'),
      ),
    ).toEqual([]);
  });
});
