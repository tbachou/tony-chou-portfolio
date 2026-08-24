import {
  judgeRescanCompleteness,
  mergeSpans,
  spansForRescan,
} from './rescan-window';

const NOW = new Date('2026-08-23T18:00:00Z');
const HOUR = 60 * 60 * 1000;

function span(start: string, end: string) {
  return { start: new Date(start), end: new Date(end) };
}

function shape(spans: { start: Date; end: Date }[]) {
  return spans.map((s) => [s.start.toISOString(), s.end.toISOString()]);
}

describe('mergeSpans', () => {
  it('returns nothing for nothing', () => {
    expect(mergeSpans([], HOUR)).toEqual([]);
  });

  it('leaves distant spans alone', () => {
    const merged = mergeSpans(
      [
        span('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
        span('2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z'),
      ],
      HOUR,
    );

    expect(merged).toHaveLength(2);
  });

  it('merges overlapping spans', () => {
    const merged = mergeSpans(
      [
        span('2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z'),
        span('2026-01-05T00:00:00Z', '2026-01-15T00:00:00Z'),
      ],
      0,
    );

    expect(shape(merged)).toEqual([
      ['2026-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z'],
    ]);
  });

  it('merges spans closer together than the gap', () => {
    const merged = mergeSpans(
      [
        span('2026-01-01T00:00:00Z', '2026-01-01T06:00:00Z'),
        span('2026-01-01T12:00:00Z', '2026-01-01T18:00:00Z'),
      ],
      12 * HOUR,
    );

    expect(shape(merged)).toEqual([
      ['2026-01-01T00:00:00.000Z', '2026-01-01T18:00:00.000Z'],
    ]);
  });

  it('does not let a contained span shorten the one holding it', () => {
    const merged = mergeSpans(
      [
        span('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z'),
        span('2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z'),
      ],
      0,
    );

    expect(shape(merged)).toEqual([
      ['2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z'],
    ]);
  });

  it('does not depend on the input order', () => {
    const input = [
      span('2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z'),
      span('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
    ];

    expect(shape(mergeSpans(input, HOUR))).toEqual(
      shape(mergeSpans([...input].reverse(), HOUR)),
    );
  });

  it('does not mutate the spans it was given', () => {
    const original = span('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    const before = original.end.toISOString();

    mergeSpans([original, span('2026-01-02T01:00:00Z', '2026-01-03T00:00:00Z')], 2 * HOUR);

    expect(original.end.toISOString()).toBe(before);
  });
});

describe('spansForRescan', () => {
  it('always asks for the rolling window even with nothing provisional', () => {
    const spans = spansForRescan([], NOW, 90, 24);

    expect(shape(spans)).toEqual([
      ['2026-05-25T18:00:00.000Z', '2026-08-23T18:00:00.000Z'],
    ]);
  });

  it('extends the rolling window back over a contiguous provisional run', () => {
    // The real shape of the store: provisional from late November onward,
    // which reaches further back than ninety days.
    const provisional = [
      new Date('2025-11-26T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-08-23T00:00:00Z'),
    ];

    const spans = spansForRescan(provisional, NOW, 90, 24 * 400);

    expect(shape(spans)).toEqual([
      ['2025-11-25T23:45:00.000Z', '2026-08-23T18:00:00.000Z'],
    ]);
    // The span reaches at or before the oldest provisional reading, which is
    // the property that matters; the quarter hour of padding is how the span
    // is made wide enough to be requested at all.
    expect(spans[0].start.getTime()).toBeLessThanOrEqual(
      provisional[0].getTime(),
    );
  });

  it('gives a stranded old reading its own small span', () => {
    // The case that would otherwise be pathological: one reading stuck
    // provisional two years back must not drag every rescan across the whole
    // history, nor be skipped.
    const provisional = [
      new Date('2024-02-01T00:00:00Z'),
      new Date('2026-08-01T00:00:00Z'),
    ];

    const spans = spansForRescan(provisional, NOW, 90, 24);

    expect(spans).toHaveLength(2);
    // Wide enough to actually be requested. A zero width span makes no HTTP
    // request at all, which would skip the reading silently.
    expect(spans[0].end.getTime()).toBeGreaterThan(spans[0].start.getTime());
    expect(shape(spans)[0]).toEqual([
      '2024-01-31T23:45:00.000Z',
      '2024-02-01T00:15:00.000Z',
    ]);
    expect(shape(spans)[1]).toEqual([
      '2026-05-25T18:00:00.000Z',
      '2026-08-23T18:00:00.000Z',
    ]);
  });

  it('never produces a span too narrow to be requested', () => {
    // The invariant behind AC-19: every provisional reading must actually be
    // asked for, however isolated. Zero width spans are the way that fails.
    const awkward = [
      [new Date('2024-02-01T00:00:00Z')],
      [new Date('2024-02-01T00:00:00Z'), new Date('2025-06-01T00:00:00Z')],
      [
        new Date('2024-02-01T00:00:00Z'),
        new Date('2024-02-01T00:15:00Z'),
        new Date('2025-06-01T00:00:00Z'),
      ],
    ];

    for (const provisional of awkward) {
      for (const s of spansForRescan(provisional, NOW, 90, 24)) {
        expect(s.end.getTime()).toBeGreaterThan(s.start.getTime());
      }
    }
  });

  it('folds recent provisional readings into the rolling window', () => {
    const provisional = [new Date('2026-08-20T00:00:00Z')];

    const spans = spansForRescan(provisional, NOW, 90, 24);

    expect(spans).toHaveLength(1);
  });

  it('joins provisional readings a day apart into one request', () => {
    const provisional = [
      new Date('2024-02-01T00:00:00Z'),
      new Date('2024-02-01T18:00:00Z'),
    ];

    const spans = spansForRescan(provisional, NOW, 90, 24);

    expect(spans).toHaveLength(2);
    expect(shape(spans)[0]).toEqual([
      '2024-01-31T23:45:00.000Z',
      '2024-02-01T18:15:00.000Z',
    ]);
  });
});

describe('judgeRescanCompleteness', () => {
  it('is OK when the source still has what the store holds', () => {
    expect(judgeRescanCompleteness(5694, 5694)).toBe('OK');
  });

  it('is OK when the source has more than the store holds', () => {
    expect(judgeRescanCompleteness(5700, 5694)).toBe('OK');
  });

  it('is PARTIAL when readings went missing upstream', () => {
    expect(judgeRescanCompleteness(5000, 5694)).toBe('PARTIAL');
  });

  it('does not call a historical gap partial, unlike the forward rule', () => {
    // The span is 93 percent covered and permanently so. The forward rule
    // would report PARTIAL forever; this one correctly sees nothing wrong.
    expect(judgeRescanCompleteness(930, 930)).toBe('OK');
  });
});
