import { parseInstantaneousValues } from './parse';

/** Shaped from a real response for site 03230500, trimmed to three readings. */
function response(values: unknown[], parameterCode = '00060') {
  return {
    value: {
      timeSeries: [
        {
          sourceInfo: { siteName: 'Big Darby Creek at Darbyville OH' },
          variable: {
            variableCode: [{ value: parameterCode }],
            noDataValue: -999999,
          },
          values: [{ value: values }],
        },
      ],
    },
  };
}

const READING = {
  value: '1060',
  qualifiers: ['P'],
  dateTime: '2026-08-23T13:30:00.000-04:00',
};

describe('parseInstantaneousValues', () => {
  it('parses a discharge reading, converting the offset time to UTC', () => {
    const [reading] = parseInstantaneousValues(response([READING]));

    expect(reading.valueCfs).toBe(1060);
    expect(reading.qualifier).toBe('PROVISIONAL');
    expect(reading.validTime.toISOString()).toBe('2026-08-23T17:30:00.000Z');
  });

  it('reads the approved code as APPROVED', () => {
    const [reading] = parseInstantaneousValues(
      response([{ ...READING, qualifiers: ['A'] }]),
    );

    expect(reading.qualifier).toBe('APPROVED');
  });

  it('keeps a reading approved when an estimation flag rides along', () => {
    const [reading] = parseInstantaneousValues(
      response([{ ...READING, qualifiers: ['A', 'e'] }]),
    );

    expect(reading.qualifier).toBe('APPROVED');
  });

  it('treats an unknown code as provisional rather than guessing', () => {
    const [reading] = parseInstantaneousValues(
      response([{ ...READING, qualifiers: ['Ice'] }]),
    );

    expect(reading.qualifier).toBe('PROVISIONAL');
  });

  it('drops the no data sentinel instead of storing a negative flow', () => {
    const readings = parseInstantaneousValues(
      response([READING, { ...READING, value: '-999999' }]),
    );

    expect(readings).toHaveLength(1);
    expect(readings[0].valueCfs).toBe(1060);
  });

  it('parses a sub one value without losing precision', () => {
    const [reading] = parseInstantaneousValues(
      response([{ ...READING, value: '0.05' }]),
    );

    expect(reading.valueCfs).toBe(0.05);
  });

  it('returns nothing for a window with no data', () => {
    expect(parseInstantaneousValues({ value: { timeSeries: [] } })).toEqual([]);
  });

  it('ignores a series for a different parameter', () => {
    expect(parseInstantaneousValues(response([READING], '00065'))).toEqual([]);
  });

  it('refuses two discharge series rather than averaging two places in the river', () => {
    const doubled = response([READING]);
    doubled.value.timeSeries.push({ ...doubled.value.timeSeries[0] });

    expect(() => parseInstantaneousValues(doubled)).toThrow(/expected exactly one/);
  });

  it('throws when the response shape is not recognised', () => {
    expect(() => parseInstantaneousValues({ nope: true })).toThrow();
    expect(() => parseInstantaneousValues(null)).toThrow();
    expect(() => parseInstantaneousValues({ value: {} })).toThrow();
  });

  it('throws on an unparseable timestamp', () => {
    expect(() =>
      parseInstantaneousValues(response([{ ...READING, dateTime: 'yesterday' }])),
    ).toThrow(/dateTime/);
  });

  it('throws on an unparseable value', () => {
    expect(() =>
      parseInstantaneousValues(response([{ ...READING, value: 'a lot' }])),
    ).toThrow(/value/);
  });
});
