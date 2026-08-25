import { asOfWalk, reconstructAsOf } from './as-of';
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

/**
 * The archive as the store actually holds it: every reading imported in one
 * pass, so `recordedAt` carries no information at all and only `validTime`
 * separates one reading from another. This is the shape spec 0010's hindcast
 * seeding child was written for.
 */
const BULK_IMPORTED: StoredObservation[] = [
  row('2024-01-01T00:00:00Z', '2026-08-23T04:00:00Z', 300),
  row('2024-06-01T00:00:00Z', '2026-08-23T04:00:00Z', 400),
  row('2025-01-01T00:00:00Z', '2026-08-23T04:00:00Z', 500),
];

describe('reconstructAsOf on the validTime axis', () => {
  it('excludes a reading that was not yet true at the slot', () => {
    const snapshot = reconstructAsOf(
      BULK_IMPORTED,
      new Date('2024-06-01T00:00:00Z'),
      'validTime',
    );

    expect(snapshot.map((observed) => observed.valueCfs)).toEqual([300, 400]);
  });

  it('sees the whole archive that the recordedAt axis cannot see at all', () => {
    // The failure this axis exists to fix. Every row was learned in August
    // 2026, so asking what was knowable in January 2025 on the strict axis
    // correctly returns nothing, and a hindcast walking that axis has no
    // history to forecast from at any slot but the last.
    const slot = new Date('2025-01-01T00:00:00Z');

    expect(reconstructAsOf(BULK_IMPORTED, slot)).toEqual([]);
    expect(reconstructAsOf(BULK_IMPORTED, slot, 'validTime')).toHaveLength(3);
  });

  it('still takes the greatest recordedAt when a validTime was revised', () => {
    // The axis moves the bound, never the reduction: among the rows in scope
    // for a validTime, the newest revision is still the one that counts.
    const revised = [
      row('2024-01-01T00:00:00Z', '2026-08-23T04:00:00Z', 300),
      row('2024-01-01T00:00:00Z', '2026-08-24T09:00:00Z', 330, 'APPROVED'),
    ];

    const [observed] = reconstructAsOf(
      revised,
      new Date('2024-06-01T00:00:00Z'),
      'validTime',
    );

    expect(observed.valueCfs).toBe(330);
  });

  it('leaves the strict axis in place when nothing is passed', () => {
    expect(reconstructAsOf(WITH_REVISION, new Date('2026-08-24T00:00:00Z'))).toEqual(
      reconstructAsOf(
        WITH_REVISION,
        new Date('2026-08-24T00:00:00Z'),
        'recordedAt',
      ),
    );
  });
});

describe('asOfWalk', () => {
  const SLOTS = [
    '2024-01-01T00:00:00Z',
    '2024-06-01T00:00:00Z',
    '2025-01-01T00:00:00Z',
    '2026-08-24T00:00:00Z',
  ].map((instant) => new Date(instant));

  function sortedValues(rows: StoredObservation[]): number[] {
    return rows.map((observed) => observed.valueCfs).sort((a, b) => a - b);
  }

  it.each(['recordedAt', 'validTime'] as const)(
    'agrees with reconstructAsOf at every slot on the %s axis',
    (axis) => {
      // Two statements of one rule, which is the thing this workspace treats
      // as most likely to drift. The walk is only allowed to exist because
      // this holds.
      const advance = asOfWalk(WITH_REVISION.concat(BULK_IMPORTED), axis);

      for (const slot of SLOTS) {
        expect(sortedValues(advance(slot))).toEqual(
          sortedValues(reconstructAsOf(WITH_REVISION.concat(BULK_IMPORTED), slot, axis)),
        );
      }
    },
  );

  it('walks a bulk imported archive that the strict axis leaves empty', () => {
    const strict = asOfWalk(BULK_IMPORTED);
    const loose = asOfWalk(BULK_IMPORTED, 'validTime');

    const strictCounts = SLOTS.map((slot) => strict(slot).length);
    const looseCounts = SLOTS.map((slot) => loose(slot).length);

    expect(strictCounts).toEqual([0, 0, 0, 3]);
    expect(looseCounts).toEqual([1, 2, 3, 3]);
  });

  it('does not depend on the order the rows arrive in', () => {
    const forwards = asOfWalk(BULK_IMPORTED, 'validTime');
    const backwards = asOfWalk([...BULK_IMPORTED].reverse(), 'validTime');

    for (const slot of SLOTS) {
      expect(sortedValues(backwards(slot))).toEqual(sortedValues(forwards(slot)));
    }
  });

  it('keeps one row per gauge and validTime rather than one per gauge', () => {
    const twoGauges = [
      row('2024-01-01T00:00:00Z', '2026-08-23T04:00:00Z', 300, 'PROVISIONAL'),
      row('2024-01-01T00:00:00Z', '2026-08-23T04:00:00Z', 12, 'PROVISIONAL', 'gauge_other'),
    ];

    expect(
      asOfWalk(twoGauges, 'validTime')(new Date('2024-06-01T00:00:00Z')),
    ).toHaveLength(2);
  });
});
