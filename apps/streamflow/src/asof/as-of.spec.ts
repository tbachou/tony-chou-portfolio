import { latestKnownAt, reconstructAsOf } from './as-of';
import type { StoredObservation } from '../types';

const GAUGE = 'gauge_darby';

function row(
  validTime: string,
  recordedAt: string,
  valueCfs: number,
  qualifier: StoredObservation['qualifier'] = 'PROVISIONAL',
  gaugeId = GAUGE,
): StoredObservation {
  return {
    gaugeId,
    validTime: new Date(validTime),
    recordedAt: new Date(recordedAt),
    valueCfs,
    qualifier,
  };
}

/**
 * The fixture the spec's correctness scenario calls for: one reading at
 * 12:00 that USGS first published as provisional 1060, then revised on the
 * 25th to an approved 1120. Nothing about the river changed; only what we
 * knew about it did.
 */
const WITH_REVISION: StoredObservation[] = [
  row('2026-08-23T12:00:00Z', '2026-08-23T12:05:00Z', 1060, 'PROVISIONAL'),
  row('2026-08-23T12:00:00Z', '2026-08-25T09:00:00Z', 1120, 'APPROVED'),
  row('2026-08-23T12:15:00Z', '2026-08-23T12:20:00Z', 1050, 'PROVISIONAL'),
];

describe('reconstructAsOf', () => {
  it('returns the original value before the revision landed', () => {
    const snapshot = reconstructAsOf(
      WITH_REVISION,
      new Date('2026-08-24T00:00:00Z'),
    );

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].valueCfs).toBe(1060);
    expect(snapshot[0].qualifier).toBe('PROVISIONAL');
  });

  it('returns the revised value after the revision landed', () => {
    const snapshot = reconstructAsOf(
      WITH_REVISION,
      new Date('2026-08-26T00:00:00Z'),
    );

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].valueCfs).toBe(1120);
    expect(snapshot[0].qualifier).toBe('APPROVED');
  });

  it('never reveals a row recorded after the asOf instant', () => {
    const snapshot = reconstructAsOf(
      WITH_REVISION,
      new Date('2026-08-24T00:00:00Z'),
    );

    for (const observed of snapshot) {
      expect(observed.recordedAt.getTime()).toBeLessThanOrEqual(
        new Date('2026-08-24T00:00:00Z').getTime(),
      );
    }
  });

  it('includes a row recorded at exactly the asOf instant', () => {
    const snapshot = reconstructAsOf(
      WITH_REVISION,
      new Date('2026-08-23T12:05:00Z'),
    );

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].valueCfs).toBe(1060);
  });

  it('knows nothing before the first row was recorded', () => {
    expect(
      reconstructAsOf(WITH_REVISION, new Date('2026-08-23T00:00:00Z')),
    ).toEqual([]);
  });

  it('partitions by gauge, so one river cannot mask another', () => {
    const twoGauges = [
      row('2026-08-23T12:00:00Z', '2026-08-23T12:05:00Z', 1060),
      row('2026-08-23T12:00:00Z', '2026-08-23T12:06:00Z', 55, 'PROVISIONAL', 'gauge_other'),
    ];

    const snapshot = reconstructAsOf(twoGauges, new Date('2026-08-24T00:00:00Z'));

    expect(snapshot).toHaveLength(2);
    expect(
      snapshot.map((observed) => observed.valueCfs).sort((a, b) => a - b),
    ).toEqual([55, 1060]);
  });

  it('sorts by validTime ascending', () => {
    const shuffled = [
      row('2026-08-23T12:30:00Z', '2026-08-23T12:35:00Z', 1040),
      row('2026-08-23T12:00:00Z', '2026-08-23T12:05:00Z', 1060),
      row('2026-08-23T12:15:00Z', '2026-08-23T12:20:00Z', 1050),
    ];

    const times = reconstructAsOf(shuffled, new Date('2026-08-24T00:00:00Z')).map(
      (observed) => observed.validTime.toISOString(),
    );

    expect(times).toEqual([
      '2026-08-23T12:00:00.000Z',
      '2026-08-23T12:15:00.000Z',
      '2026-08-23T12:30:00.000Z',
    ]);
  });

  it('takes the newest revision when several precede the asOf instant', () => {
    const thrice = [
      row('2026-08-23T12:00:00Z', '2026-08-23T12:05:00Z', 1060),
      row('2026-08-23T12:00:00Z', '2026-08-24T09:00:00Z', 1100),
      row('2026-08-23T12:00:00Z', '2026-08-25T09:00:00Z', 1120, 'APPROVED'),
    ];

    const [observed] = reconstructAsOf(thrice, new Date('2026-08-26T00:00:00Z'));

    expect(observed.valueCfs).toBe(1120);
  });

  it('is unaffected by the order rows arrive in', () => {
    const forwards = reconstructAsOf(WITH_REVISION, new Date('2026-08-26T00:00:00Z'));
    const backwards = reconstructAsOf(
      [...WITH_REVISION].reverse(),
      new Date('2026-08-26T00:00:00Z'),
    );

    expect(backwards).toEqual(forwards);
  });
});

describe('latestKnownAt', () => {
  it('finds the row current for one validTime', () => {
    const observed = latestKnownAt(
      WITH_REVISION,
      GAUGE,
      new Date('2026-08-23T12:00:00Z'),
      new Date('2026-08-24T00:00:00Z'),
    );

    expect(observed?.valueCfs).toBe(1060);
  });

  it('returns undefined when that validTime is not yet known', () => {
    const observed = latestKnownAt(
      WITH_REVISION,
      GAUGE,
      new Date('2026-08-23T12:45:00Z'),
      new Date('2026-08-24T00:00:00Z'),
    );

    expect(observed).toBeUndefined();
  });

  it('does not answer with another gauge row', () => {
    const observed = latestKnownAt(
      WITH_REVISION,
      'gauge_other',
      new Date('2026-08-23T12:00:00Z'),
      new Date('2026-08-24T00:00:00Z'),
    );

    expect(observed).toBeUndefined();
  });
});
