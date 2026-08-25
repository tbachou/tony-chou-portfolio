import { bucketRatios } from './bucket';
import type { BucketCandidate, BucketCriteria } from './bucket';

const GAUGE = 'gauge-darby';
const MODEL = 'model-persistence';

const CRITERIA: BucketCriteria = {
  gaugeId: GAUGE,
  modelVersionId: MODEL,
  horizonHours: 24,
  issuedAt: new Date('2026-06-01T00:00:00Z'),
};

let nextScoreId = 0;

function candidate(over: Partial<BucketCandidate> = {}): BucketCandidate {
  nextScoreId += 1;
  return {
    scoreId: `score-${String(nextScoreId).padStart(3, '0')}`,
    predictionId: `prediction-${String(nextScoreId).padStart(3, '0')}`,
    actualCfs: 120,
    actualRecordedAt: new Date('2026-05-01T00:00:00Z'),
    gaugeId: GAUGE,
    modelVersionId: MODEL,
    horizonHours: 24,
    targetTime: new Date('2026-04-30T00:00:00Z'),
    issueRegime: 'BASEFLOW',
    centralCfs: 100,
    ...over,
  };
}

describe('bucketRatios', () => {
  it('returns actual over predicted for each eligible score', () => {
    const rows = [
      candidate({ actualCfs: 120, centralCfs: 100 }),
      candidate({ actualCfs: 45, centralCfs: 90 }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toEqual([1.2, 0.5]);
  });

  it('counts a prediction scored twice exactly once, taking the newer truth', () => {
    const rows = [
      candidate({
        predictionId: 'prediction-twice',
        actualCfs: 110,
        actualRecordedAt: new Date('2026-05-01T00:00:00Z'),
      }),
      candidate({
        predictionId: 'prediction-twice',
        actualCfs: 130,
        actualRecordedAt: new Date('2026-05-09T00:00:00Z'),
      }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toEqual([1.3]);
  });

  it('breaks a tie on the greater score id, so the answer is never arbitrary', () => {
    const sameInstant = new Date('2026-05-01T00:00:00Z');
    const rows = [
      candidate({
        scoreId: 'score-b',
        predictionId: 'prediction-tied',
        actualCfs: 200,
        actualRecordedAt: sameInstant,
      }),
      candidate({
        scoreId: 'score-a',
        predictionId: 'prediction-tied',
        actualCfs: 100,
        actualRecordedAt: sameInstant,
      }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toEqual([2]);
    expect(bucketRatios([...rows].reverse(), CRITERIA)).toEqual([2]);
  });

  it('excludes a forecast whose target had not happened by the issue instant', () => {
    const rows = [
      candidate({ targetTime: new Date('2026-05-31T23:59:59Z') }),
      candidate({ targetTime: new Date('2026-06-01T00:00:01Z') }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toHaveLength(1);
  });

  it('never holds an error whose target is after the issue instant, on either axis', () => {
    // AC-H5, stated as the property rather than as a count. The bound is what
    // stops a hindcast prediction learning from a forecast that had not
    // resolved yet at the moment it simulates.
    const rows = [
      candidate({ targetTime: new Date('2026-04-01T00:00:00Z'), actualCfs: 110 }),
      candidate({ targetTime: new Date('2026-07-01T00:00:00Z'), actualCfs: 900 }),
    ];

    for (const axis of ['recordedAt', 'validTime'] as const) {
      const kept = rows.filter((row) =>
        bucketRatios(rows, { ...CRITERIA, axis }).includes(
          row.actualCfs / row.centralCfs,
        ),
      );

      expect(kept.every((row) => row.targetTime <= CRITERIA.issuedAt)).toBe(true);
      expect(bucketRatios(rows, { ...CRITERIA, axis })).toEqual([1.1]);
    }
  });

  it('gives the same answer on both axes, since the bound no longer depends on one', () => {
    // AC-H4. The bound moved off `actualRecordedAt`, which is an axis
    // dependent fact, onto `targetTime`, which is not. The axis is carried so
    // the call site says which reconstruction it is part of, and the bucket
    // reads identically either way.
    const rows = [
      candidate({ actualCfs: 110 }),
      candidate({ actualCfs: 200, targetTime: new Date('2026-09-01T00:00:00Z') }),
      candidate({ actualCfs: 45, centralCfs: 90 }),
    ];

    expect(bucketRatios(rows, { ...CRITERIA, axis: 'validTime' })).toEqual(
      bucketRatios(rows, { ...CRITERIA, axis: 'recordedAt' }),
    );
    expect(bucketRatios(rows, { ...CRITERIA, axis: 'validTime' })).toEqual(
      bucketRatios(rows, CRITERIA),
    );
  });

  it('takes the newest revision of the truth even when it landed after the issue instant', () => {
    // The honest consequence of moving the bound. A revision arriving later
    // used to be filtered out and the older score used in its place; now the
    // prediction is in scope on its target instant and the reduction takes the
    // newest revision. On the live path that revision does not exist yet when
    // the query runs, so this only bites a walk of an archive, which is where
    // every score shares one import instant anyway.
    const rows = [
      candidate({
        predictionId: 'prediction-revised',
        actualCfs: 110,
        actualRecordedAt: new Date('2026-05-01T00:00:00Z'),
      }),
      candidate({
        predictionId: 'prediction-revised',
        actualCfs: 130,
        actualRecordedAt: new Date('2026-06-02T00:00:00Z'),
      }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toEqual([1.3]);
  });

  it('excludes a score whose prediction had a central estimate of zero', () => {
    const rows = [
      candidate({ centralCfs: 0 }),
      candidate({ centralCfs: -5 }),
      candidate({ centralCfs: 100, actualCfs: 150 }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toEqual([1.5]);
  });

  it('conditions on the issue regime when one is asked for', () => {
    const rows = [
      candidate({ issueRegime: 'BASEFLOW', actualCfs: 110 }),
      candidate({ issueRegime: 'RISING', actualCfs: 200 }),
      candidate({ issueRegime: null, actualCfs: 300 }),
    ];

    expect(bucketRatios(rows, { ...CRITERIA, issueRegime: 'RISING' })).toEqual([
      2,
    ]);
  });

  it('pools every regime, unclassifiable ones included, when none is asked for', () => {
    const rows = [
      candidate({ issueRegime: 'BASEFLOW', actualCfs: 110 }),
      candidate({ issueRegime: 'RISING', actualCfs: 200 }),
      candidate({ issueRegime: null, actualCfs: 300 }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toHaveLength(3);
  });

  it('is scoped by gauge, model and horizon together', () => {
    const rows = [
      candidate({ gaugeId: 'gauge-other' }),
      candidate({ modelVersionId: 'model-climatology' }),
      candidate({ horizonHours: 48 }),
      candidate({ actualCfs: 170 }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toEqual([1.7]);
  });

  it('returns nothing rather than throwing when no score qualifies', () => {
    expect(bucketRatios([], CRITERIA)).toEqual([]);
  });
});
