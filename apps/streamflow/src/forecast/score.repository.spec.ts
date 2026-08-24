import { flowFloorCfs } from './score.repository';
import type { FloorStore } from './score.repository';

function store(percentile: number | null) {
  const $queryRaw = jest.fn().mockResolvedValue([{ floor: percentile }]);
  const update = jest.fn().mockResolvedValue({});
  return {
    prisma: { $queryRaw, gauge: { update } } as unknown as FloorStore,
    $queryRaw,
    update,
  };
}

describe('flowFloorCfs', () => {
  it('derives the floor from the store the first time and freezes it', async () => {
    const { prisma, $queryRaw, update } = store(14.5);

    const floor = await flowFloorCfs(prisma, {
      id: 'gauge-darby',
      flowFloorCfs: null,
    });

    expect(floor).toBe(14.5);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'gauge-darby' },
      data: { flowFloorCfs: 14.5 },
    });
  });

  it('reuses the frozen value without touching the store again', async () => {
    // The whole point. Recomputing would let the denominator drift, so a
    // score written today and its replacement after a revision would be
    // percentages on different scales with nothing saying so.
    const { prisma, $queryRaw, update } = store(99);

    const floor = await flowFloorCfs(prisma, {
      id: 'gauge-darby',
      flowFloorCfs: 12.25,
    });

    expect(floor).toBe(12.25);
    expect($queryRaw).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('reuses a frozen floor even when the store has since grown', async () => {
    const { prisma } = store(40);

    await expect(
      flowFloorCfs(prisma, { id: 'gauge-darby', flowFloorCfs: 11 }),
    ).resolves.toBe(11);
  });

  it('refuses to derive a floor that is not positive', async () => {
    for (const percentile of [null, 0, -3]) {
      const { prisma, update } = store(percentile);

      await expect(
        flowFloorCfs(prisma, { id: 'gauge-darby', flowFloorCfs: null }),
      ).rejects.toThrow('derived from the store');
      // Nothing is frozen on the way out, so a later run can still derive it.
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('refuses a frozen floor that is not positive, rather than trusting it', async () => {
    // The column is meant to be hand correctable, and a hand can type a zero.
    // A zero floor makes the percentage error divide by the reading itself,
    // and this gauge can genuinely read zero, so the result would be NaN in a
    // column that accepts it and a blanked chart wherever it is averaged.
    for (const frozen of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { prisma, $queryRaw } = store(20);

      await expect(
        flowFloorCfs(prisma, { id: 'gauge-darby', flowFloorCfs: frozen }),
      ).rejects.toThrow('frozen on the gauge');
      // It fails rather than quietly re-deriving, so the bad value is seen
      // and corrected instead of being papered over on every run.
      expect($queryRaw).not.toHaveBeenCalled();
    }
  });

  it('names the value and the source, so an operator knows which path failed', async () => {
    const { prisma } = store(20);

    await expect(
      flowFloorCfs(prisma, { id: 'gauge-darby', flowFloorCfs: 0 }),
    ).rejects.toThrow('unusable flow floor (0) frozen on the gauge');
  });
});
