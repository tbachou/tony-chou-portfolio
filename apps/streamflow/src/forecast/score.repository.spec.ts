import { flowFloorCfs, scorablePredictions } from './score.repository';
import type { FloorStore, ScoreReader } from './score.repository';

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

/**
 * The statement the scorable query sends, not rows it returns.
 *
 * A mocked reader agrees with any `WHERE` clause at all, so the only proof
 * available without a database is the SQL itself. The risk this change carries
 * is that the default axis stops meaning what it has always meant, which is
 * what the first two of these pin down.
 */
const TODAY =
  'SELECT p."id" AS "predictionId", p."targetTime", p."centralCfs", p."lowerCfs", p."upperCfs", truth."valueCfs" AS "actualCfs", truth."recordedAt" AS "actualRecordedAt" FROM "predictions" p JOIN LATERAL ( SELECT o."valueCfs", o."recordedAt" FROM "observations" o WHERE o."gaugeId" = p."gaugeId" AND o."validTime" = p."targetTime" AND o."recordedAt" <= $1 ORDER BY o."recordedAt" DESC LIMIT 1 ) truth ON true WHERE p."gaugeId" = $2 AND p."targetTime" <= $3 AND p."hindcast" = $4 AND NOT EXISTS ( SELECT 1 FROM "scores" s WHERE s."predictionId" = p."id" AND s."actualRecordedAt" = truth."recordedAt" ) ORDER BY p."targetTime"';

const AS_OF = new Date('2025-06-01T00:00:00Z');

interface Statement {
  text: string;
  values: unknown[];
}

function scoreReader() {
  const sent: Statement[] = [];
  const $queryRaw = jest.fn((sql: Statement) => {
    sent.push(sql);
    return Promise.resolve([]);
  });

  return {
    prisma: { $queryRaw } as unknown as ScoreReader,
    statement: () => {
      const sql = sent[sent.length - 1];
      return { text: sql.text.replace(/\s+/g, ' ').trim(), values: sql.values };
    },
  };
}

describe('scorablePredictions', () => {
  it('sends exactly the statement it has always sent when no axis is passed', async () => {
    const { prisma, statement } = scoreReader();

    await scorablePredictions(prisma, 'gauge-darby', AS_OF, false);

    expect(statement()).toEqual({
      text: TODAY,
      values: [AS_OF, 'gauge-darby', AS_OF, false],
    });
  });

  it('sends the same statement for an explicit recordedAt axis', async () => {
    const implied = scoreReader();
    const explicit = scoreReader();

    await scorablePredictions(implied.prisma, 'gauge-darby', AS_OF, true);
    await scorablePredictions(
      explicit.prisma,
      'gauge-darby',
      AS_OF,
      true,
      'recordedAt',
    );

    expect(explicit.statement()).toEqual(implied.statement());
  });

  it('drops the recordedAt bound entirely on the validTime axis', async () => {
    // Dropped, not moved. Bounding the truth by its own validTime would say
    // only that the reading at the target instant was true at the target
    // instant, which is true of every row and filters nothing.
    const { prisma, statement } = scoreReader();

    await scorablePredictions(prisma, 'gauge-darby', AS_OF, true, 'validTime');

    const sent = statement();
    expect(sent.text).not.toContain('o."recordedAt" <=');
    expect(sent.text).toBe(
      TODAY.replace(' AND o."recordedAt" <= $1', '')
        .replace('p."gaugeId" = $2', 'p."gaugeId" = $1')
        .replace('p."targetTime" <= $3', 'p."targetTime" <= $2')
        .replace('p."hindcast" = $4', 'p."hindcast" = $3'),
    );
    expect(sent.values).toEqual(['gauge-darby', AS_OF, true]);
  });

  it('keeps the target instant bound on both axes, so nothing unjudged is scored', async () => {
    // The half of the leakage rule that still means something over an archive
    // imported in one pass: a forecast is only scorable once its target has
    // actually happened.
    for (const axis of ['recordedAt', 'validTime'] as const) {
      const { prisma, statement } = scoreReader();

      await scorablePredictions(prisma, 'gauge-darby', AS_OF, true, axis);

      expect(statement().text).toContain('p."targetTime" <= $');
    }
  });

  it('still takes the greatest recordedAt as the truth on both axes', async () => {
    for (const axis of ['recordedAt', 'validTime'] as const) {
      const { prisma, statement } = scoreReader();

      await scorablePredictions(prisma, 'gauge-darby', AS_OF, true, axis);

      expect(statement().text).toContain(
        'ORDER BY o."recordedAt" DESC LIMIT 1',
      );
    }
  });
});
