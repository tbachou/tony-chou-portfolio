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

  it('excludes a score learned after the issue instant', () => {
    const rows = [
      candidate({ actualRecordedAt: new Date('2026-05-31T23:59:59Z') }),
      candidate({ actualRecordedAt: new Date('2026-06-01T00:00:01Z') }),
    ];

    expect(bucketRatios(rows, CRITERIA)).toHaveLength(1);
  });

  it('keeps the older score when the newer one landed after the issue instant', () => {
    // The filter runs before the reduction. Picking the newest score first and
    // then dropping it for being too late would lose the prediction entirely,
    // which is the quiet way a hindcast bucket ends up smaller than it should.
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

    expect(bucketRatios(rows, CRITERIA)).toEqual([1.1]);
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
