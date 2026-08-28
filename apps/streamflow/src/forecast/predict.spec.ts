import { MIN_BUCKET_ERRORS } from '../config';
import type { StoredObservation } from '../types';
import { draftPredictions } from './predict';
import type { DraftContext } from './predict';

jest.mock('./bucket.repository', () => ({
  bucketRatiosFromStore: jest.fn(),
}));

import { bucketRatiosFromStore } from './bucket.repository';
import type { BucketReader } from './bucket.repository';

const askBucket = bucketRatiosFromStore as jest.MockedFunction<
  typeof bucketRatiosFromStore
>;

const GAUGE_ID = 'gauge-darby';
const TIME_ZONE = 'America/New_York';
const ISSUED_AT = new Date('2026-06-01T00:00:00.000Z');
const QUARTER_HOUR_MS = 15 * 60 * 1000;

const MODELS = [
  { id: 'model-persistence', name: 'persistence' },
  { id: 'model-climatology', name: 'climatology' },
];

/** Readings every quarter hour across a range, which is how the gauge reports. */
function readings(from: string, to: string, valueCfs: number) {
  const rows: StoredObservation[] = [];
  const end = new Date(to).getTime();
  for (
    let instant = new Date(from).getTime();
    instant <= end;
    instant += QUARTER_HOUR_MS
  ) {
    const validTime = new Date(instant);
    rows.push({
      gaugeId: GAUGE_ID,
      validTime,
      recordedAt: validTime,
      valueCfs,
      qualifier: 'APPROVED',
    });
  }
  return rows;
}

/**
 * A record rich enough for all three of persistence, climatology and the
 * regime classifier to answer: two weeks up to the issue instant, and the
 * same fortnight a year earlier for climatology to average.
 */
function fullHistory(recentCfs = 100): StoredObservation[] {
  return [
    ...readings('2025-05-26T00:00:00Z', '2025-06-11T00:00:00Z', 90),
    ...readings('2026-05-18T00:00:00Z', '2026-06-01T00:00:00Z', recentCfs),
  ];
}

function context(over: Partial<DraftContext> = {}): DraftContext {
  return {
    gaugeId: GAUGE_ID,
    timeZone: TIME_ZONE,
    models: MODELS,
    history: fullHistory(),
    issuedAt: ISSUED_AT,
    hindcast: false,
    // The real gauge's frozen floor. Far below anything these fixtures use, so
    // it bounds the falling threshold without ever deciding a case here.
    flowFloorCfs: 18.9,
    ...over,
  };
}

const reader = {} as BucketReader;

beforeEach(() => {
  askBucket.mockReset();
  askBucket.mockResolvedValue([]);
});

describe('draftPredictions', () => {
  it('issues one prediction per model per horizon', () => {
    return draftPredictions(reader, context()).then(({ drafts, skipped }) => {
      expect(drafts).toHaveLength(6);
      expect(skipped).toBe(0);
      expect(drafts.map((draft) => draft.horizonHours).sort()).toEqual([
        24, 24, 48, 48, 72, 72,
      ]);
      expect(new Set(drafts.map((draft) => draft.modelVersionId))).toEqual(
        new Set(['model-persistence', 'model-climatology']),
      );
    });
  });

  it('targets each horizon exactly that many hours ahead', async () => {
    const { drafts } = await draftPredictions(reader, context());

    for (const draft of drafts) {
      expect(draft.targetTime.getTime() - draft.issuedAt.getTime()).toBe(
        draft.horizonHours * 60 * 60 * 1000,
      );
    }
  });

  it('gives every row in one slot the same issue regime', async () => {
    const { drafts } = await draftPredictions(reader, context());

    // A flat fortnight, so the river is at baseflow and every forecaster in
    // this slot was issued into the same conditions.
    expect(new Set(drafts.map((draft) => draft.issueRegime))).toEqual(
      new Set(['BASEFLOW']),
    );
  });

  it('reads the regime from the river, not from the forecaster', async () => {
    // A fortnight at 100 with the last twelve hours climbing to 180. The
    // median stays near 100, so the twelve hour change clears ten percent of
    // it and the slot is issued into a rising river.
    const history = [
      ...readings('2025-05-26T00:00:00Z', '2025-06-11T00:00:00Z', 90),
      ...readings('2026-05-18T00:00:00Z', '2026-05-31T12:00:00Z', 100),
      ...readings('2026-05-31T12:15:00Z', '2026-06-01T00:00:00Z', 180),
    ];

    const { drafts } = await draftPredictions(reader, context({ history }));

    expect(new Set(drafts.map((draft) => draft.issueRegime))).toEqual(
      new Set(['RISING']),
    );
  });

  it('skips a forecaster that cannot honestly answer, and counts it', async () => {
    // Two weeks and no earlier year at all: persistence still answers,
    // climatology has nothing to average.
    const history = readings('2026-05-18T00:00:00Z', '2026-06-01T00:00:00Z', 100);

    const { drafts, skipped } = await draftPredictions(
      reader,
      context({ history }),
    );

    expect(drafts).toHaveLength(3);
    expect(skipped).toBe(3);
    expect(new Set(drafts.map((draft) => draft.modelVersionId))).toEqual(
      new Set(['model-persistence']),
    );
  });

  it('still issues when the regime cannot be judged, on pooled quantiles', async () => {
    // A handful of readings: enough for persistence to name a value, far too
    // few for the classifier to say what the river is doing.
    const history = readings('2026-05-31T22:00:00Z', '2026-06-01T00:00:00Z', 100);
    askBucket.mockResolvedValue(Array(MIN_BUCKET_ERRORS).fill(1.2));

    const { drafts } = await draftPredictions(reader, context({ history }));

    expect(drafts).toHaveLength(3);
    for (const draft of drafts) {
      expect(draft.issueRegime).toBeNull();
      // Pooled quantiles are real data, but they are not conditioned.
      expect(draft.intervalSeeded).toBe(false);
      expect(draft.bucketSize).toBe(MIN_BUCKET_ERRORS);
    }

    // Never asks for a conditioned bucket, because there is no regime to
    // condition on.
    for (const call of askBucket.mock.calls) {
      expect(call[1].issueRegime).toBeUndefined();
    }
  });

  it('marks the interval seeded when the conditioned bucket is deep enough', async () => {
    askBucket.mockImplementation(async (_prisma, criteria) =>
      criteria.issueRegime ? Array(MIN_BUCKET_ERRORS).fill(1.5) : [],
    );

    const { drafts } = await draftPredictions(reader, context());

    for (const draft of drafts) {
      expect(draft.intervalSeeded).toBe(true);
      expect(draft.bucketSize).toBe(MIN_BUCKET_ERRORS);
      expect(draft.upperCfs).toBeCloseTo(draft.centralCfs * 1.5, 8);
    }
  });

  it('does not ask for the pooled bucket when the conditioned one suffices', async () => {
    askBucket.mockImplementation(async (_prisma, criteria) =>
      criteria.issueRegime ? Array(MIN_BUCKET_ERRORS).fill(1.5) : [],
    );

    await draftPredictions(reader, context());

    // Six predictions, one query each, none of them pooled.
    expect(askBucket).toHaveBeenCalledTimes(6);
    for (const call of askBucket.mock.calls) {
      expect(call[1].issueRegime).toBe('BASEFLOW');
    }
  });

  it('falls back to the placeholder band when no bucket has history', async () => {
    const { drafts } = await draftPredictions(reader, context());

    for (const draft of drafts) {
      expect(draft.lowerCfs).toBeCloseTo(draft.centralCfs / 3, 8);
      expect(draft.upperCfs).toBeCloseTo(draft.centralCfs * 3, 8);
      expect(draft.q10Used).toBeNull();
      expect(draft.q90Used).toBeNull();
      expect(draft.bucketSize).toBe(0);
      expect(draft.intervalSeeded).toBe(false);
    }
  });

  it('never asks a bucket for anything learned after the issue instant', async () => {
    await draftPredictions(reader, context());

    for (const call of askBucket.mock.calls) {
      expect(call[1].issuedAt).toEqual(ISSUED_AT);
    }
  });

  it('leaves the bucket on the strict axis unless the caller names one', async () => {
    // AC-H2's other half. The live path passes nothing, so the bucket query
    // and the two reads beside it all take the default, and the loose axis
    // cannot be reached by forgetting rather than by choosing.
    askBucket.mockResolvedValue([]);

    await draftPredictions({} as BucketReader, context());

    expect(askBucket).toHaveBeenCalled();
    for (const call of askBucket.mock.calls) {
      expect(call[1].axis).toBeUndefined();
    }
  });

  it('carries the axis it was given into every bucket it asks for', async () => {
    askBucket.mockResolvedValue([]);

    await draftPredictions({} as BucketReader, context({ axis: 'validTime' }));

    expect(askBucket).toHaveBeenCalled();
    for (const call of askBucket.mock.calls) {
      expect(call[1].axis).toBe('validTime');
    }
  });

  it('holds the ordering invariant on every row it drafts', async () => {
    const { drafts } = await draftPredictions(reader, context());

    for (const draft of drafts) {
      expect(draft.lowerCfs).toBeLessThanOrEqual(draft.centralCfs);
      expect(draft.upperCfs).toBeGreaterThanOrEqual(draft.centralCfs);
    }
  });

  it('carries the hindcast flag through to every row', async () => {
    const { drafts } = await draftPredictions(
      reader,
      context({ hindcast: true }),
    );

    expect(drafts.every((draft) => draft.hindcast)).toBe(true);
  });

  it('skips a model row with no forecaster behind it', async () => {
    const { drafts, skipped } = await draftPredictions(
      reader,
      context({ models: [{ id: 'model-ghost', name: 'not-a-baseline' }] }),
    );

    expect(drafts).toHaveLength(0);
    expect(skipped).toBe(3);
  });
});
