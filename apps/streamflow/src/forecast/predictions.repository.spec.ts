import { publicPredictions } from './predictions.repository';
import type { PredictionReader } from './predictions.repository';

function readerSpy() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { prediction: { findMany } } as unknown as PredictionReader;
  return { prisma, findMany };
}

describe('publicPredictions', () => {
  it('filters out hindcast rows on every call', async () => {
    const { prisma, findMany } = readerSpy();

    await publicPredictions(prisma, { gaugeId: 'gauge-darby' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hindcast: false }),
      }),
    );
  });

  it('keeps filtering them out whatever else it is asked for', async () => {
    const { prisma, findMany } = readerSpy();

    await publicPredictions(prisma, {
      gaugeId: 'gauge-darby',
      horizonHours: 24,
      modelVersionId: 'model-persistence',
      issuedFrom: new Date('2026-05-01T00:00:00Z'),
      targetTo: new Date('2026-06-01T00:00:00Z'),
      limit: 10,
    });

    const { where, take } = findMany.mock.calls[0][0];
    expect(where.hindcast).toBe(false);
    expect(where.gaugeId).toBe('gauge-darby');
    expect(where.horizonHours).toBe(24);
    expect(where.modelVersionId).toBe('model-persistence');
    expect(where.issuedAt).toEqual({
      gte: new Date('2026-05-01T00:00:00Z'),
      lte: undefined,
    });
    expect(where.targetTime).toEqual({
      gte: undefined,
      lte: new Date('2026-06-01T00:00:00Z'),
    });
    expect(take).toBe(10);
  });

  it('leaves a bound off entirely rather than sending an empty range', async () => {
    const { prisma, findMany } = readerSpy();

    await publicPredictions(prisma, { gaugeId: 'gauge-darby' });

    const { where, take } = findMany.mock.calls[0][0];
    expect(where.issuedAt).toBeUndefined();
    expect(where.targetTime).toBeUndefined();
    expect(take).toBeUndefined();
  });

  it('returns the newest claim first', async () => {
    const { prisma, findMany } = readerSpy();

    await publicPredictions(prisma, { gaugeId: 'gauge-darby' });

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { issuedAt: 'desc' },
      { horizonHours: 'asc' },
    ]);
  });
});
