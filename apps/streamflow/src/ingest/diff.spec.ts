import { selectChangedReadings } from './diff';
import type { Reading, StoredObservation } from '../types';

const GAUGE = 'gauge_darby';

function reading(
  validTime: string,
  valueCfs: number,
  qualifier: Reading['qualifier'] = 'PROVISIONAL',
): Reading {
  return { validTime: new Date(validTime), valueCfs, qualifier };
}

function stored(
  validTime: string,
  valueCfs: number,
  qualifier: Reading['qualifier'] = 'PROVISIONAL',
): StoredObservation {
  return {
    gaugeId: GAUGE,
    validTime: new Date(validTime),
    recordedAt: new Date('2026-08-23T12:05:00Z'),
    valueCfs,
    qualifier,
  };
}

describe('selectChangedReadings', () => {
  it('writes everything when the store is empty', () => {
    const readings = [
      reading('2026-08-23T12:00:00Z', 1060),
      reading('2026-08-23T12:15:00Z', 1050),
    ];

    expect(selectChangedReadings(readings, [])).toHaveLength(2);
  });

  it('writes nothing when the window is unchanged', () => {
    const readings = [
      reading('2026-08-23T12:00:00Z', 1060),
      reading('2026-08-23T12:15:00Z', 1050),
    ];
    const known = [
      stored('2026-08-23T12:00:00Z', 1060),
      stored('2026-08-23T12:15:00Z', 1050),
    ];

    expect(selectChangedReadings(readings, known)).toEqual([]);
  });

  it('writes a revised value', () => {
    const changed = selectChangedReadings(
      [reading('2026-08-23T12:00:00Z', 1120)],
      [stored('2026-08-23T12:00:00Z', 1060)],
    );

    expect(changed).toHaveLength(1);
    expect(changed[0].valueCfs).toBe(1120);
  });

  it('writes a qualifier change even when the value is identical', () => {
    const changed = selectChangedReadings(
      [reading('2026-08-23T12:00:00Z', 1060, 'APPROVED')],
      [stored('2026-08-23T12:00:00Z', 1060, 'PROVISIONAL')],
    );

    expect(changed).toHaveLength(1);
    expect(changed[0].qualifier).toBe('APPROVED');
  });

  it('writes only the readings that moved, out of a mostly unchanged window', () => {
    const readings = [
      reading('2026-08-23T12:00:00Z', 1060),
      reading('2026-08-23T12:15:00Z', 1055),
      reading('2026-08-23T12:30:00Z', 1040),
    ];
    const known = [
      stored('2026-08-23T12:00:00Z', 1060),
      stored('2026-08-23T12:15:00Z', 1050),
    ];

    const changed = selectChangedReadings(readings, known);

    expect(changed.map((entry) => entry.validTime.toISOString())).toEqual([
      '2026-08-23T12:15:00.000Z',
      '2026-08-23T12:30:00.000Z',
    ]);
  });

  it('keeps one row per validTime when a response repeats one', () => {
    // Every row a run writes shares that run's recordedAt, so two rows for one
    // validTime would collide on the unique key.
    const changed = selectChangedReadings(
      [
        reading('2026-08-23T12:00:00Z', 1060),
        reading('2026-08-23T12:00:00Z', 1065),
      ],
      [],
    );

    expect(changed).toHaveLength(1);
    expect(changed[0].valueCfs).toBe(1065);
  });

  it('drops a repeat that returns to the stored value', () => {
    const changed = selectChangedReadings(
      [
        reading('2026-08-23T12:00:00Z', 1065),
        reading('2026-08-23T12:00:00Z', 1060),
      ],
      [stored('2026-08-23T12:00:00Z', 1060)],
    );

    expect(changed).toHaveLength(1);
    expect(changed[0].valueCfs).toBe(1060);
  });

  it('treats a validTime the store has never seen as new', () => {
    const changed = selectChangedReadings(
      [reading('2026-08-23T12:45:00Z', 1030)],
      [stored('2026-08-23T12:00:00Z', 1060)],
    );

    expect(changed).toHaveLength(1);
  });
});
