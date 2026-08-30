import type { ForecastValue, StoredForecast } from '../types';
import { selectChangedForecasts } from './forecast-diff';

const HOUR = new Date('2024-02-01T00:00:00.000Z');

function stored(overrides: Partial<StoredForecast> = {}): StoredForecast {
  return {
    gaugeId: 'g1',
    validTime: HOUR,
    leadHours: 24,
    issuedAt: new Date('2024-01-31T00:00:00.000Z'),
    recordedAt: new Date('2024-02-02T00:00:00.000Z'),
    precipMm: 1.5,
    tempC: 3,
    model: 'gfs_seamless',
    ...overrides,
  };
}

function value(overrides: Partial<ForecastValue> = {}): ForecastValue {
  return { validTime: HOUR, leadHours: 24, precipMm: 1.5, tempC: 3, ...overrides };
}

describe('selectChangedForecasts', () => {
  it('writes nothing when precip and temp both match', () => {
    expect(selectChangedForecasts([value()], [stored()])).toEqual([]);
  });

  it('writes a row when nothing is known for that hour and lead', () => {
    expect(selectChangedForecasts([value()], [])).toEqual([value()]);
  });

  it('writes a row when precip differs', () => {
    const changed = selectChangedForecasts([value({ precipMm: 2.5 })], [stored()]);

    expect(changed).toHaveLength(1);
    expect(changed[0].precipMm).toBe(2.5);
  });

  it('writes a row when temp differs', () => {
    expect(selectChangedForecasts([value({ tempC: 4 })], [stored()])).toHaveLength(1);
  });

  // AC-R3: the failure this guards is a run that writes every hour, every time,
  // purely because an optional field is absent from the response.
  it('treats an absent tempC and a stored null as equal', () => {
    const parsed = value();
    delete parsed.tempC;

    expect(selectChangedForecasts([parsed], [stored({ tempC: null })])).toEqual([]);
  });

  it('still writes when tempC is absent but the store holds a number', () => {
    const parsed = value();
    delete parsed.tempC;

    expect(selectChangedForecasts([parsed], [stored({ tempC: 3 })])).toHaveLength(1);
  });

  it('still writes when tempC arrives and the store holds null', () => {
    expect(selectChangedForecasts([value({ tempC: 3 })], [stored({ tempC: null })]))
      .toHaveLength(1);
  });

  // Keying on validTime alone, as selectChangedReadings does, would let one
  // lead's value suppress the other's. Two leads for one hour are two facts.
  it('does not let one lead suppress another for the same hour', () => {
    const changed = selectChangedForecasts(
      [value({ leadHours: 24 }), value({ leadHours: 48, precipMm: 9 })],
      [stored({ leadHours: 24 })],
    );

    expect(changed).toHaveLength(1);
    expect(changed[0].leadHours).toBe(48);
  });

  it('keeps only the last value for a repeated hour and lead, so the write cannot collide', () => {
    const changed = selectChangedForecasts(
      [value({ precipMm: 2 }), value({ precipMm: 7 })],
      [],
    );

    expect(changed).toHaveLength(1);
    expect(changed[0].precipMm).toBe(7);
  });

  it('re-running an unchanged month writes zero rows', () => {
    const month = Array.from({ length: 720 }, (_, hour) =>
      value({ validTime: new Date(HOUR.getTime() + hour * 3_600_000), precipMm: hour % 3 }),
    );
    const known = month.map((v) =>
      stored({ validTime: v.validTime, precipMm: v.precipMm, tempC: 3 }),
    );

    expect(selectChangedForecasts(month, known)).toEqual([]);
  });
});
