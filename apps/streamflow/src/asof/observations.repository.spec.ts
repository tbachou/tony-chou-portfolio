import { observationsAsOf } from './observations.repository';
import type { ObservationReader } from './observations.repository';

/**
 * These tests read the statement the query sends, not rows it returns.
 *
 * The whole risk this change carries is that the default axis stops meaning
 * what it has always meant, and no mocked result set can show that: a reader
 * handing back rows would agree with any `WHERE` clause at all. Comparing the
 * generated SQL is the only proof available without a database, and
 * `scripts/verify-as-of.ts` is what checks the statement against real rows.
 */
const TODAY = 'SELECT DISTINCT ON ("gaugeId", "validTime") "gaugeId", "validTime", "recordedAt", "valueCfs", "qualifier" FROM "observations" WHERE "gaugeId" = $1 AND "recordedAt" <= $2 AND "validTime" >= $3 AND "validTime" <= $4 ORDER BY "gaugeId", "validTime", "recordedAt" DESC';

const FROM = new Date('2024-01-01T00:00:00Z');
const TO = new Date('2026-08-24T00:00:00Z');
const AS_OF = new Date('2025-06-01T00:00:00Z');

interface Statement {
  text: string;
  values: unknown[];
}

function reader() {
  const sent: Statement[] = [];
  const $queryRaw = jest.fn((sql: Statement) => {
    sent.push(sql);
    return Promise.resolve([]);
  });

  return {
    prisma: { $queryRaw } as unknown as ObservationReader,
    /** The last statement sent, with runs of whitespace squashed. */
    statement: () => {
      const sql = sent[sent.length - 1];
      return { text: sql.text.replace(/\s+/g, ' ').trim(), values: sql.values };
    },
  };
}

describe('observationsAsOf', () => {
  it('sends exactly the statement it has always sent when no axis is passed', async () => {
    const { prisma, statement } = reader();

    await observationsAsOf(prisma, 'gauge-darby', FROM, TO, AS_OF);

    expect(statement()).toEqual({
      text: TODAY,
      values: ['gauge-darby', AS_OF, FROM, TO],
    });
  });

  it('sends the same statement for an explicit recordedAt axis', async () => {
    const strict = reader();
    const explicit = reader();

    await observationsAsOf(strict.prisma, 'gauge-darby', FROM, TO, AS_OF);
    await observationsAsOf(
      explicit.prisma,
      'gauge-darby',
      FROM,
      TO,
      AS_OF,
      'recordedAt',
    );

    expect(explicit.statement()).toEqual(strict.statement());
  });

  it('bounds on validTime instead when the loose axis is asked for', async () => {
    const { prisma, statement } = reader();

    await observationsAsOf(prisma, 'gauge-darby', FROM, TO, AS_OF, 'validTime');

    const sent = statement();
    expect(sent.text).toBe(TODAY.replace('"recordedAt" <= $2', '"validTime" <= $2'));
    // The parameters keep their order, so the bound moved and nothing else did.
    expect(sent.values).toEqual(['gauge-darby', AS_OF, FROM, TO]);
  });
});
