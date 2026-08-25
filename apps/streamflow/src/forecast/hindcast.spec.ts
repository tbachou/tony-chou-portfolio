import { BACKFILL_START } from '../config';
import type { PrismaClient } from '../generated/prisma/client';
import type { StoredObservation } from '../types';

jest.mock('./bucket.repository', () => ({
  bucketRatiosFromStore: jest.fn(),
}));

jest.mock('./score.repository', () => ({
  flowFloorCfs: jest.fn(),
  scorablePredictions: jest.fn(),
}));

import { bucketRatiosFromStore } from './bucket.repository';
import { flowFloorCfs, scorablePredictions } from './score.repository';
import type { ScorableRow } from './score.repository';
import type { PredictionDraft } from './predict';
import { runHindcast } from './hindcast';

const askBucket = bucketRatiosFromStore as jest.MockedFunction<
  typeof bucketRatiosFromStore
>;
const askFloor = flowFloorCfs as jest.MockedFunction<typeof flowFloorCfs>;
const askScorable = scorablePredictions as jest.MockedFunction<
  typeof scorablePredictions
>;

const GAUGE = {
  id: 'gauge-darby',
  timezone: 'America/New_York',
  active: true,
  flowFloorCfs: 12,
};

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/**
 * The archive exactly as the store holds it: every reading learned in one
 * import pass, so `recordedAt` separates nothing and only `validTime` says
 * when anything was true. A strict walk of this finds no history at any slot,
 * which is the failure this whole decision exists to fix.
 */
const IMPORTED_AT = new Date('2026-08-23T04:00:00Z');

function bulkImportedRecord(from: string, to: string): StoredObservation[] {
  const rows: StoredObservation[] = [];
  const end = new Date(to).getTime();

  for (
    let instant = new Date(from).getTime();
    instant <= end;
    instant += QUARTER_HOUR_MS
  ) {
    rows.push({
      gaugeId: GAUGE.id,
      validTime: new Date(instant),
      recordedAt: IMPORTED_AT,
      valueCfs: 100,
      qualifier: 'APPROVED',
    });
  }

  return rows;
}

function store(observations: StoredObservation[]) {
  const written: PredictionDraft[] = [];
  const scored: unknown[] = [];

  const prisma = {
    gauge: { findFirst: jest.fn().mockResolvedValue(GAUGE) },
    modelVersion: {
      upsert: jest.fn(({ create }: { create: { name: string } }) =>
        Promise.resolve({
          id: `model-${create.name}`,
          name: create.name,
          active: true,
        }),
      ),
    },
    observation: { findMany: jest.fn().mockResolvedValue(observations) },
    prediction: {
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn(({ data }: { data: PredictionDraft[] }) => {
        written.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    score: {
      createMany: jest.fn(({ data }: { data: unknown[] }) => {
        scored.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, written, scored };
}

/**
 * Stands in for the scorable query on the loose axis: a forecast is scorable
 * once its target has passed, and the truth is the reading at that target.
 * The real statement is pinned in `score.repository.spec.ts`; what this test
 * needs from it is only that the walk keeps finding work at every slot.
 */
function scorableFrom(
  written: PredictionDraft[],
  observations: StoredObservation[],
  alreadyScored: Set<string>,
) {
  return (slot: Date): ScorableRow[] => {
    const rows: ScorableRow[] = [];

    written.forEach((draft, index) => {
      const id = `prediction-${index}`;
      if (alreadyScored.has(id)) return;
      if (draft.targetTime.getTime() > slot.getTime()) return;

      const truth = observations.find(
        (row) => row.validTime.getTime() === draft.targetTime.getTime(),
      );
      if (!truth) return;

      alreadyScored.add(id);
      rows.push({
        predictionId: id,
        targetTime: draft.targetTime,
        centralCfs: draft.centralCfs,
        lowerCfs: draft.lowerCfs,
        upperCfs: draft.upperCfs,
        actualCfs: truth.valueCfs,
        actualRecordedAt: truth.recordedAt,
      });
    });

    return rows;
  };
}

describe('runHindcast', () => {
  const FROM = new Date('2024-01-10T00:00:00Z');
  const TO = new Date('2024-01-20T00:00:00Z');
  const RECORD = bulkImportedRecord(
    '2023-12-20T00:00:00Z',
    '2024-01-21T00:00:00Z',
  );

  beforeEach(() => {
    jest.resetAllMocks();
    askBucket.mockResolvedValue([]);
    askFloor.mockResolvedValue(12);
  });

  it('produces predictions at every slot over a record imported in one pass', async () => {
    // The failure this decision exists to fix. Every reading here was learned
    // in August 2026, so a walk bounded by what had been recorded finds an
    // empty history at every slot but the last and forecasts almost nothing.
    const { prisma, written } = store(RECORD);
    askScorable.mockResolvedValue([]);

    const result = await runHindcast({ prisma, from: FROM, to: TO });

    expect(result.slots).toBe(41);
    // Persistence answers at all three horizons on every slot. Climatology
    // cannot, having no earlier year in this fixture, and is skipped rather
    // than filled in.
    expect(result.predictionsWritten).toBe(result.slots * 3);
    expect(written.every((draft) => draft.hindcast)).toBe(true);
  });

  it('scores at every slot once targets start passing', async () => {
    const { prisma, written, scored } = store(RECORD);
    askScorable.mockImplementation((_prisma, _gaugeId, slot) =>
      Promise.resolve(scorableFrom(written, RECORD, new Set())(slot)),
    );

    const result = await runHindcast({ prisma, from: FROM, to: TO });

    expect(result.scoresWritten).toBeGreaterThan(0);
    expect(scored.length).toBe(result.scoresWritten);
  });

  it('reads every one of the three reads on the validTime axis', async () => {
    // AC-H2. The history walk, the scorable query and the bucket query are
    // one reconstruction, and a slot that mixed axes would be answering two
    // different questions at once.
    const { prisma } = store(RECORD);
    askScorable.mockResolvedValue([]);

    await runHindcast({ prisma, from: FROM, to: TO });

    expect(askScorable).toHaveBeenCalled();
    for (const call of askScorable.mock.calls) {
      expect(call[4]).toBe('validTime');
    }

    expect(askBucket).toHaveBeenCalled();
    for (const call of askBucket.mock.calls) {
      expect(call[1].axis).toBe('validTime');
    }
  });

  it('asks the store for the record once rather than once per slot', async () => {
    // Thousands of sequential round trips is what the in memory walk exists
    // to avoid; a read that crept back inside the loop would not fail, only
    // take days.
    const { prisma } = store(RECORD);
    askScorable.mockResolvedValue([]);

    await runHindcast({ prisma, from: FROM, to: TO });

    expect(prisma.observation.findMany).toHaveBeenCalledTimes(1);
  });

  it('resumes from the newest slot it already wrote, redoing that one', async () => {
    // Redoing the newest slot rather than starting past it: a walk killed
    // between its prediction write and its score write leaves that slot half
    // done, and skipping it would leave the scores missing for good.
    const { prisma } = store(RECORD);
    askScorable.mockResolvedValue([]);
    (prisma.prediction.findFirst as jest.Mock).mockResolvedValue({
      issuedAt: new Date('2024-01-18T00:00:00Z'),
    });

    const result = await runHindcast({ prisma, to: TO });

    expect(result.from).toEqual(new Date('2024-01-18T00:00:00Z'));
    // 18th 00:00 to 20th 00:00 inclusive, six hourly.
    expect(result.slots).toBe(9);
  });

  it('starts at the beginning when it has written nothing yet', async () => {
    const { prisma } = store(RECORD);
    askScorable.mockResolvedValue([]);

    const result = await runHindcast({ prisma, to: new Date('2024-01-02T00:00:00Z') });

    expect(prisma.prediction.findFirst).toHaveBeenCalledWith({
      where: { gaugeId: GAUGE.id, hindcast: true },
      orderBy: { issuedAt: 'desc' },
      select: { issuedAt: true },
    });
    expect(result.from).toEqual(BACKFILL_START);
  });

  it('lets an explicit from override the resume point', async () => {
    const { prisma } = store(RECORD);
    askScorable.mockResolvedValue([]);
    (prisma.prediction.findFirst as jest.Mock).mockResolvedValue({
      issuedAt: new Date('2024-01-18T00:00:00Z'),
    });

    const result = await runHindcast({ prisma, from: FROM, to: TO });

    expect(result.from).toEqual(FROM);
    expect(prisma.prediction.findFirst).not.toHaveBeenCalled();
  });

  it('counts the rows the store already held rather than losing them', async () => {
    // The unique key on a prediction does not include `hindcast`, so a live
    // run reaching the same issue slot silently wins and this walk's row
    // disappears. Counting the gap is what makes that visible.
    const { prisma } = store(RECORD);
    askScorable.mockResolvedValue([]);
    (prisma.prediction.createMany as jest.Mock).mockImplementation(
      ({ data }: { data: PredictionDraft[] }) =>
        Promise.resolve({ count: data.length - 1 }),
    );

    const result = await runHindcast({ prisma, from: FROM, to: TO });

    expect(result.predictionsWritten).toBe(result.slots * 2);
    expect(result.predictionsSkipped).toBe(result.slots);
  });

  it('counts skipped scores the same way', async () => {
    const { prisma, written } = store(RECORD);
    askScorable.mockImplementation((_prisma, _gaugeId, slot) =>
      Promise.resolve(scorableFrom(written, RECORD, new Set())(slot)),
    );
    (prisma.score.createMany as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await runHindcast({ prisma, from: FROM, to: TO });

    expect(result.scoresWritten).toBe(0);
    expect(result.scoresSkipped).toBeGreaterThan(0);
  });

  it('refuses to run when no gauge is active', async () => {
    const { prisma } = store(RECORD);
    (prisma.gauge.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(runHindcast({ prisma })).rejects.toThrow(
      'no active gauge to hindcast for',
    );
  });
});
