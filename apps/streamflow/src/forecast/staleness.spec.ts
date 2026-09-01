import { ISSUE_INTERVAL_HOURS, STALE_AFTER_HOURS } from '../config';
import type { StoredObservation } from '../types';
import {
  inputReadingFor,
  isStale,
  isStaleForecast,
  isStaleInput,
} from './staleness';

/**
 * The rule that decides what a visitor is told about a real river.
 *
 * Two things here are worth more than the rest. The threshold test binds the
 * RELATIONSHIP to the ingest cadence rather than the number nine, because a
 * literal would go quietly wrong the day the cadence changed and nothing
 * would fail. And the gap recovery case pins the `recordedAt` bound, which a
 * cross check caught missing from the first draft of this design: without it
 * the marker silently fails in exactly the outage it exists to disclose.
 */

const HOUR = 3_600_000;

function reading(
  validTime: string,
  recordedAt: string = validTime,
): StoredObservation {
  return {
    gaugeId: 'g1',
    validTime: new Date(validTime),
    recordedAt: new Date(recordedAt),
    valueCfs: 142,
    qualifier: 'PROVISIONAL',
  };
}

describe('STALE_AFTER_HOURS', () => {
  it('is derived from the ingest cadence, not written as a number', () => {
    // Deliberately asserts the relationship. Mutation checked 2026-08-31:
    // writing `= 9` instead passes TODAY, because nine is what the derivation
    // currently evaluates to, and a value cannot reveal how it was computed.
    // It fails the moment the cadence moves and the literal does not follow,
    // which is exactly when a literal becomes wrong. That is the protection.
    expect(STALE_AFTER_HOURS).toBe(ISSUE_INTERVAL_HOURS * 1.5);
  });

  it('clears the age a healthy pipeline reaches, so it cannot fire on one', () => {
    // The peak in normal operation is one full cycle, just before the next
    // run. A threshold at or below that would fire constantly and train a
    // reader to ignore it, which is worse than not warning at all.
    expect(STALE_AFTER_HOURS).toBeGreaterThan(ISSUE_INTERVAL_HOURS);
  });
});

describe('isStale', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('is false below the threshold', () => {
    const eightHoursAgo = new Date(now.getTime() - 8 * HOUR);
    expect(isStale(eightHoursAgo, now, 9)).toBe(false);
  });

  it('is false exactly on the threshold, and true a minute past it', () => {
    // The boundary is arbitrary either way and pinned so it cannot drift.
    const exactly = new Date(now.getTime() - 9 * HOUR);
    const past = new Date(now.getTime() - 9 * HOUR - 60_000);
    expect(isStale(exactly, now, 9)).toBe(false);
    expect(isStale(past, now, 9)).toBe(true);
  });

  it('takes the threshold from the caller rather than the config', () => {
    const sevenHoursAgo = new Date(now.getTime() - 7 * HOUR);
    expect(isStale(sevenHoursAgo, now, 9)).toBe(false);
    expect(isStale(sevenHoursAgo, now, 6)).toBe(true);
  });
});

describe('inputReadingFor', () => {
  const issuedAt = new Date('2026-08-31T12:00:00.000Z');

  it('takes the newest reading at or before the issue instant', () => {
    const rows = [
      reading('2026-08-31T06:00:00.000Z'),
      reading('2026-08-31T11:00:00.000Z'),
      reading('2026-08-31T13:00:00.000Z'), // after issue, invisible
    ];
    expect(inputReadingFor(rows, issuedAt)?.validTime.toISOString()).toBe(
      '2026-08-31T11:00:00.000Z',
    );
  });

  it('ignores a row recorded after the issue instant, however valid its time', () => {
    // THE case a validTime only lookup gets wrong. This is the gap recovery
    // shape: ingest died, the forecast went out on an old reading, and the
    // missed window was backfilled hours later carrying a late recordedAt.
    const rows = [
      reading('2026-08-31T02:00:00.000Z'), // genuinely available at issue
      reading('2026-08-31T11:45:00.000Z', '2026-08-31T18:00:00.000Z'), // backfilled after
    ];

    const input = inputReadingFor(rows, issuedAt);

    expect(input?.validTime.toISOString()).toBe('2026-08-31T02:00:00.000Z');
  });

  it('returns null when nothing qualifies on either bound', () => {
    const rows = [reading('2026-08-31T20:00:00.000Z')];
    expect(inputReadingFor(rows, issuedAt)).toBeNull();
  });

  it('returns null on an empty store rather than throwing', () => {
    expect(inputReadingFor([], issuedAt)).toBeNull();
  });
});

describe('isStaleInput', () => {
  const issuedAt = new Date('2026-08-31T12:00:00.000Z');

  it('is false when the forecast saw a recent reading', () => {
    const rows = [reading('2026-08-31T11:00:00.000Z')];
    expect(isStaleInput(rows, issuedAt, 9)).toBe(false);
  });

  it('is true when the newest available reading was already old', () => {
    const rows = [reading('2026-08-31T01:00:00.000Z')];
    expect(isStaleInput(rows, issuedAt, 9)).toBe(true);
  });

  it('is true when the only fresh looking row was backfilled after the fact', () => {
    // The same gap recovery shape, asserted through the public predicate:
    // a validTime only lookup would call this fresh and say nothing.
    const rows = [
      reading('2026-08-31T01:00:00.000Z'),
      reading('2026-08-31T11:45:00.000Z', '2026-08-31T18:00:00.000Z'),
    ];
    expect(isStaleInput(rows, issuedAt, 9)).toBe(true);
  });

  it('is true when no input reading can be established at all', () => {
    // Fails toward disclosure. Returning false here would launder the worst
    // case, a forecast whose input cannot even be identified, into the clean one.
    expect(isStaleInput([], issuedAt, 9)).toBe(true);
  });
});

describe('isStaleForecast', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('is false when the forecast is recent and saw a recent reading', () => {
    const issuedAt = new Date(now.getTime() - 2 * HOUR);
    const rows = [reading('2026-08-31T09:30:00.000Z')];
    expect(isStaleForecast(rows, issuedAt, now, 9)).toBe(false);
  });

  it('is true when the forecast itself is old, however fresh its input was', () => {
    // THE case both audit passes found. The predictor died while ingest kept
    // running: input fresh at issue time, forecast forty hours old, and the
    // first version of this rule said nothing at all.
    const issuedAt = new Date(now.getTime() - 40 * HOUR);
    const rows = [
      // one hour before it was issued, so the input was genuinely fresh then
      {
        gaugeId: 'g1',
        validTime: new Date(issuedAt.getTime() - HOUR),
        recordedAt: new Date(issuedAt.getTime() - HOUR),
        valueCfs: 142,
        qualifier: 'PROVISIONAL' as const,
      },
    ];

    expect(isStaleInput(rows, issuedAt, 9)).toBe(false); // input was fine
    expect(isStaleForecast(rows, issuedAt, now, 9)).toBe(true); // the forecast is not
  });

  it('is true when the input was old even though the forecast is recent', () => {
    const issuedAt = new Date(now.getTime() - HOUR);
    const rows = [reading('2026-08-30T12:00:00.000Z')];
    expect(isStaleForecast(rows, issuedAt, now, 9)).toBe(true);
  });

  it('is true when both clocks failed', () => {
    const issuedAt = new Date(now.getTime() - 40 * HOUR);
    expect(isStaleForecast([], issuedAt, now, 9)).toBe(true);
  });
});
