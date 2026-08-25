import { bucketRatiosFromStore } from './bucket.repository';
import type { BucketReader } from './bucket.repository';
import type { BucketCriteria } from './bucket';

/**
 * The statement the bucket query sends, not rows it returns.
 *
 * Two things need pinning here and neither is visible in a mocked result set.
 * The time bound has moved from the score's `actualRecordedAt` to the
 * contributing prediction's `targetTime`, and the knowability axis, which
 * moves the other two reads, must leave this one alone.
 * `scripts/verify-bucket.ts` is what proves the statement agrees with
 * `bucketRatios` against real rows.
 */
const ISSUED_AT = new Date('2026-06-01T00:00:00Z');

const CRITERIA: BucketCriteria = {
  gaugeId: 'gauge-darby',
  modelVersionId: 'model-persistence',
  horizonHours: 24,
  issuedAt: ISSUED_AT,
};

interface Statement {
  text: string;
  values: unknown[];
}

function bucketReader() {
  const sent: Statement[] = [];
  const $queryRaw = jest.fn((sql: Statement) => {
    sent.push(sql);
    return Promise.resolve([]);
  });

  return {
    prisma: { $queryRaw } as unknown as BucketReader,
    statement: () => {
      const sql = sent[sent.length - 1];
      return { text: sql.text.replace(/\s+/g, ' ').trim(), values: sql.values };
    },
  };
}

describe('bucketRatiosFromStore', () => {
  it('bounds on the contributing prediction target instant', async () => {
    const { prisma, statement } = bucketReader();

    await bucketRatiosFromStore(prisma, CRITERIA);

    const sent = statement();
    expect(sent.text).toContain('AND p."targetTime" <= $4');
    expect(sent.text).not.toContain('s."actualRecordedAt" <=');
    expect(sent.values).toEqual([
      'gauge-darby',
      'model-persistence',
      24,
      ISSUED_AT,
    ]);
  });

  it('still reduces to the newest revision per prediction', async () => {
    // The bound moved; the reduction did not. A prediction scored twice must
    // still weigh once, taking the truth that is current.
    const { prisma, statement } = bucketReader();

    await bucketRatiosFromStore(prisma, CRITERIA);

    expect(statement().text).toContain(
      'ORDER BY s."predictionId", s."actualRecordedAt" DESC, s."id" DESC',
    );
  });

  it('sends the same statement whichever axis the caller is on', async () => {
    const strict = bucketReader();
    const loose = bucketReader();
    const silent = bucketReader();

    await bucketRatiosFromStore(strict.prisma, {
      ...CRITERIA,
      axis: 'recordedAt',
    });
    await bucketRatiosFromStore(loose.prisma, { ...CRITERIA, axis: 'validTime' });
    await bucketRatiosFromStore(silent.prisma, CRITERIA);

    expect(loose.statement()).toEqual(strict.statement());
    expect(silent.statement()).toEqual(strict.statement());
  });

  it('drops the regime condition entirely for the pooled bucket', async () => {
    const pooled = bucketReader();
    const conditioned = bucketReader();

    await bucketRatiosFromStore(pooled.prisma, CRITERIA);
    await bucketRatiosFromStore(conditioned.prisma, {
      ...CRITERIA,
      issueRegime: 'RISING',
    });

    expect(pooled.statement().text).not.toContain('issueRegime');
    expect(conditioned.statement().text).toContain(
      'AND p."issueRegime" = $5::"Regime"',
    );
    expect(conditioned.statement().values).toEqual([
      'gauge-darby',
      'model-persistence',
      24,
      ISSUED_AT,
      'RISING',
    ]);
  });
});
