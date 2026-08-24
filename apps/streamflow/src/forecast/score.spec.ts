import type { StoredObservation } from '../types';
import { draftScore, draftScores } from './score';
import type { ScorableRow } from './score.repository';

const TARGET_TIME = new Date('2026-06-02T00:00:00.000Z');
const SCORED_AT = new Date('2026-06-02T01:00:00.000Z');
const RECORDED_AT = new Date('2026-06-02T00:05:00.000Z');
const QUARTER_HOUR_MS = 15 * 60 * 1000;

function row(over: Partial<ScorableRow> = {}): ScorableRow {
  return {
    predictionId: 'prediction-1',
    targetTime: TARGET_TIME,
    centralCfs: 100,
    lowerCfs: 60,
    upperCfs: 180,
    actualCfs: 120,
    actualRecordedAt: RECORDED_AT,
    ...over,
  };
}

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
      gaugeId: 'gauge-darby',
      validTime,
      recordedAt: validTime,
      valueCfs,
      qualifier: 'APPROVED',
    });
  }
  return rows;
}

describe('draftScore', () => {
  it('records the miss and the revision it was judged against', () => {
    const draft = draftScore(row(), 'BASEFLOW', 12, SCORED_AT);

    expect(draft.absError).toBe(20);
    expect(draft.actualCfs).toBe(120);
    // Which revision of the truth this score used, so it can be explained.
    expect(draft.actualRecordedAt).toEqual(RECORDED_AT);
    expect(draft.scoredAt).toEqual(SCORED_AT);
  });

  it('divides the percentage error by the actual when the river is not tiny', () => {
    const draft = draftScore(row(), 'BASEFLOW', 12, SCORED_AT);

    expect(draft.pctError).toBeCloseTo(20 / 120, 10);
  });

  it('divides by the floor when the actual reading is smaller than it', () => {
    // Two off a reading of four is not a fifty percent forecasting failure,
    // it is a dry September. The floor keeps it from drowning real results.
    const draft = draftScore(
      row({ centralCfs: 6, actualCfs: 4 }),
      'BASEFLOW',
      12,
      SCORED_AT,
    );

    expect(draft.absError).toBe(2);
    expect(draft.pctError).toBeCloseTo(2 / 12, 10);
  });

  it('counts an actual inside the bounds as covered', () => {
    expect(draftScore(row(), 'BASEFLOW', 12, SCORED_AT).withinInterval).toBe(
      true,
    );
  });

  it('counts the bounds themselves as covered', () => {
    expect(
      draftScore(row({ actualCfs: 60 }), 'BASEFLOW', 12, SCORED_AT)
        .withinInterval,
    ).toBe(true);
    expect(
      draftScore(row({ actualCfs: 180 }), 'BASEFLOW', 12, SCORED_AT)
        .withinInterval,
    ).toBe(true);
  });

  it('counts an actual outside the bounds as missed', () => {
    expect(
      draftScore(row({ actualCfs: 181 }), 'BASEFLOW', 12, SCORED_AT)
        .withinInterval,
    ).toBe(false);
    expect(
      draftScore(row({ actualCfs: 59 }), 'BASEFLOW', 12, SCORED_AT)
        .withinInterval,
    ).toBe(false);
  });

  it('carries a null regime rather than guessing calm', () => {
    expect(draftScore(row(), null, 12, SCORED_AT).regime).toBeNull();
  });
});

describe('draftScores', () => {
  it('reads the regime at the target instant, not at the issue instant', () => {
    // Flat until twelve hours before the target, then climbing hard into it.
    // A forecast issued a day earlier saw a calm river; what it landed in was
    // a rising one, and the score is what has to say so.
    const history = [
      ...readings('2026-05-19T00:00:00Z', '2026-06-01T12:00:00Z', 100),
      ...readings('2026-06-01T12:15:00Z', '2026-06-02T00:00:00Z', 250),
    ];

    const drafts = draftScores([row({ actualCfs: 250 })], history, 12, SCORED_AT);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].regime).toBe('RISING');
  });

  it('files a calm target as baseflow', () => {
    const history = readings('2026-05-19T00:00:00Z', '2026-06-02T00:00:00Z', 100);

    const drafts = draftScores([row({ actualCfs: 100 })], history, 12, SCORED_AT);

    expect(drafts[0].regime).toBe('BASEFLOW');
  });

  it('refuses to classify when the record is too thin to judge', () => {
    const history = readings('2026-06-01T22:00:00Z', '2026-06-02T00:00:00Z', 100);

    const drafts = draftScores([row()], history, 12, SCORED_AT);

    expect(drafts[0].regime).toBeNull();
  });

  it('scores every row it is handed', () => {
    const history = readings('2026-05-19T00:00:00Z', '2026-06-02T00:00:00Z', 100);

    const drafts = draftScores(
      [
        row({ predictionId: 'a' }),
        row({ predictionId: 'b', actualCfs: 90 }),
        row({ predictionId: 'c', actualCfs: 500 }),
      ],
      history,
      12,
      SCORED_AT,
    );

    expect(drafts.map((draft) => draft.predictionId)).toEqual(['a', 'b', 'c']);
    expect(drafts.map((draft) => draft.withinInterval)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
