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

  it('refuses rather than dividing by something meaningless', async () => {
    for (const percentile of [null, 0, -3]) {
      const { prisma, update } = store(percentile);

      await expect(
        flowFloorCfs(prisma, { id: 'gauge-darby', flowFloorCfs: null }),
      ).rejects.toThrow('no positive flow history');
      // Nothing is frozen on the way out, so a later run can still derive it.
      expect(update).not.toHaveBeenCalled();
    }
  });
});
