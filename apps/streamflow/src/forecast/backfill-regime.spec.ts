import {
  backfillRegimes,
  formatReport,
  greatestAtOrBefore,
} from './backfill-regime';
import type {
  BackfillReader,
  BackfillWriter,
  PredictionRow,
  RegimeSnapshot,
  ScoreRow,
  SnapshotStore,
} from './backfill-regime';
import type { Regime } from './regime';
import type { StoredObservation } from '../types';

const GAUGE = 'gauge_fixture';
const QUARTER_MS = 15 * 60 * 1000;

function iso(value: string): number {
  return new Date(value).getTime();
}

/**
 * Quarter hour readings over a window, with the value and the moment the
 * pipeline learned it both under the test's control. The second is the point:
 * an archive imported in one pass shares one `recordedAt`, which is what makes
 * the knowability axis decide whether a hindcast row can be classified at all.
 */
function series(options: {
  from: string;
  to: string;
  recordedAt: (validTime: number) => number;
  value?: (validTime: number) => number;
}): StoredObservation[] {
  const value = options.value ?? (() => 200);
  const rows: StoredObservation[] = [];

  for (let t = iso(options.from); t <= iso(options.to); t += QUARTER_MS) {
    rows.push({
      gaugeId: GAUGE,
      validTime: new Date(t),
      recordedAt: new Date(options.recordedAt(t)),
      valueCfs: value(t),
      qualifier: 'PROVISIONAL',
    });
  }

  return rows;
}

function bend(at: string, to: number): (validTime: number) => number {
  const wanted = iso(at);
  return (validTime) => (validTime === wanted ? to : 200);
}

function bendMany(points: [string, number][]): (validTime: number) => number {
  const map = new Map(points.map(([at, value]) => [iso(at), value]));
  return (validTime) => map.get(validTime) ?? 200;
}

interface Fixture {
  predictions: PredictionRow[];
  scores: ScoreRow[];
  runStarts: Date[];
  observations: StoredObservation[];
}

function reader(fixture: Fixture): BackfillReader {
  return {
    predictions: async () => fixture.predictions,
    scores: async () => fixture.scores,
    scoreRunStarts: async () => fixture.runStarts,
    observations: async () => fixture.observations,
  };
}

interface RecordedWrite {
  column: 'prediction' | 'score';
  ids: string[];
  regime: Regime;
}

/**
 * A writer that applies its writes to the fixture rows, so a second run sees
 * the store as the first one left it. `failAfter` stops it partway, which is
 * the interruption AC-F9 is about.
 */
function writer(
  fixture: Fixture,
  options: { failAfter?: number } = {},
): { writer: BackfillWriter; calls: RecordedWrite[] } {
  const calls: RecordedWrite[] = [];

  function guard(): void {
    if (options.failAfter !== undefined && calls.length > options.failAfter) {
      throw new Error('interrupted');
    }
  }

  return {
    calls,
    writer: {
      setPredictionRegime: async (ids, regime) => {
        calls.push({ column: 'prediction', ids: [...ids], regime });
        for (const id of ids) {
          const row = fixture.predictions.find((entry) => entry.id === id);
          if (row) row.issueRegime = regime;
        }
        // After the rows land, so the fixture holds the half migrated store a
        // real interruption would leave behind.
        guard();
      },
      setScoreRegime: async (ids, regime) => {
        calls.push({ column: 'score', ids: [...ids], regime });
        for (const id of ids) {
          const row = fixture.scores.find((entry) => entry.id === id);
          if (row) row.regime = regime;
        }
        guard();
      },
    },
  };
}

function snapshots(initial: RegimeSnapshot | null = null): {
  store: SnapshotStore;
  held: () => RegimeSnapshot | null;
} {
  let held = initial;
  return {
    store: {
      load: async () => held,
      save: async (snapshot) => {
        held = snapshot;
      },
    },
    held: () => held,
  };
}

const NOW = () => new Date('2026-08-27T12:00:00Z');

function prediction(
  overrides: Partial<PredictionRow> & Pick<PredictionRow, 'id' | 'issuedAt'>,
): PredictionRow {
  return {
    gaugeId: GAUGE,
    hindcast: false,
    issueRegime: null,
    modelName: 'persistence',
    horizonHours: 24,
    ...overrides,
  };
}

function score(
  overrides: Partial<ScoreRow> &
    Pick<ScoreRow, 'id' | 'scoredAt' | 'targetTime' | 'actualCfs'>,
): ScoreRow {
  return {
    gaugeId: GAUGE,
    hindcast: false,
    regime: null,
    modelName: 'persistence',
    horizonHours: 24,
    ...overrides,
  };
}

describe('greatestAtOrBefore', () => {
  const runs = [
    new Date('2026-08-01T00:00:00Z'),
    new Date('2026-08-01T01:00:00Z'),
    new Date('2026-08-01T02:00:00Z'),
  ];

  it('takes the run at the instant itself', () => {
    expect(greatestAtOrBefore(runs, new Date('2026-08-01T01:00:00Z'))).toEqual(
      runs[1],
    );
  });

  it('takes the newest run before the instant', () => {
    expect(greatestAtOrBefore(runs, new Date('2026-08-01T01:59:00Z'))).toEqual(
      runs[1],
    );
  });

  it('finds nothing before the first run', () => {
    expect(
      greatestAtOrBefore(runs, new Date('2026-07-31T23:59:00Z')),
    ).toBeNull();
  });

  it('finds nothing in an empty record', () => {
    expect(greatestAtOrBefore([], new Date('2026-08-01T00:00:00Z'))).toBeNull();
  });
});

describe('backfillRegimes: predictions', () => {
  // An archive imported in one pass, learned months after it was true, plus a
  // live stretch learned as it happened. A hindcast row can only be classified
  // from the first on the loose axis; the strict axis returns nothing there.
  const ARCHIVE_LEARNED = iso('2026-06-01T00:00:00Z');
  const ISSUE_HINDCAST = new Date('2026-01-20T00:00:00Z');
  const ISSUE_LIVE = new Date('2026-07-20T00:00:00Z');

  function fixture(): Fixture {
    return {
      predictions: [
        prediction({
          id: 'hind-24',
          issuedAt: ISSUE_HINDCAST,
          hindcast: true,
          issueRegime: 'PEAK',
        }),
        prediction({
          id: 'hind-48',
          issuedAt: ISSUE_HINDCAST,
          hindcast: true,
          horizonHours: 48,
          issueRegime: 'PEAK',
        }),
        prediction({
          id: 'live-24',
          issuedAt: ISSUE_LIVE,
          issueRegime: 'BASEFLOW',
        }),
      ],
      scores: [],
      runStarts: [],
      observations: [
        ...series({
          from: '2026-01-01T00:00:00Z',
          to: '2026-01-21T00:00:00Z',
          recordedAt: () => ARCHIVE_LEARNED,
          value: bendMany([
            ['2026-01-19T12:00:00Z', 3000],
            ['2026-01-20T00:00:00Z', 400],
          ]),
        }),
        ...series({
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-21T00:00:00Z',
          recordedAt: (validTime) => validTime,
        }),
      ],
    };
  }

  it('reads a hindcast row on validTime and a live row on recordedAt', async () => {
    const rows = fixture();
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    // On the strict axis the archive is invisible at January 2026, so a wrong
    // axis here would show up as null rather than as a different class.
    expect(rows.predictions.find((row) => row.id === 'hind-24')?.issueRegime).toBe(
      'FALLING',
    );
    expect(
      rows.predictions.find((row) => row.id === 'live-24')?.issueRegime,
    ).toBe('BASEFLOW');
    expect(report.blockers).toEqual([]);
  });

  it('shares one judgement across every row an issue slot wrote', async () => {
    const rows = fixture();
    const write = writer(rows);

    await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    const slot = rows.predictions.filter((row) => row.hindcast);
    expect(new Set(slot.map((row) => row.issueRegime))).toEqual(
      new Set(['FALLING']),
    );
    expect(slot).toHaveLength(2);
  });

  it('writes nothing at all in report only mode', async () => {
    const rows = fixture();
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      now: NOW,
    });

    expect(write.calls).toEqual([]);
    expect(report.wrote).toBe(false);
    expect(report.written).toEqual({ predictions: 0, scores: 0 });
    // The labels it would write are still reported, which is the whole point
    // of running it before letting it write.
    expect(report.predictions.total.counts.FALLING).toBe(2);
    expect(rows.predictions.every((row) => row.issueRegime !== 'FALLING')).toBe(
      true,
    );
  });

  it('reports the four counts and the transition matrix per model and horizon', async () => {
    const rows = fixture();

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: writer(rows).writer,
      snapshots: snapshots().store,
      now: NOW,
    });

    expect(report.predictions.groups.map((group) => group.group)).toEqual([
      'persistence h24',
      'persistence h48',
    ]);

    const h48 = report.predictions.groups.find(
      (group) => group.group === 'persistence h48',
    );
    expect(h48?.counts).toEqual({
      BASEFLOW: 0,
      RISING: 0,
      PEAK: 0,
      FALLING: 1,
      null: 0,
    });
    expect(h48?.transitions).toEqual([{ from: 'PEAK', to: 'FALLING', count: 1 }]);

    expect(formatReport(report)).toContain('PEAK -> FALLING');
  });

  it('leaves an unclassifiable row null', async () => {
    const rows = fixture();
    rows.predictions.push(
      // Issued before the record starts, so there is no history to judge from.
      prediction({ id: 'too-early', issuedAt: new Date('2026-01-02T00:00:00Z') }),
    );
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    expect(
      rows.predictions.find((row) => row.id === 'too-early')?.issueRegime,
    ).toBeNull();
    expect(report.nullSetMoved.predictions).toEqual([]);
    expect(report.blockers).toEqual([]);
  });

  it('refuses to write when a RISING row would move', async () => {
    const rows = fixture();
    // The store claims this slot was rising. It was not, and AC-F2 says a
    // rising row can never change class, so this is a defect rather than a
    // surprise: something is reading history the original job did not read.
    rows.predictions[0].issueRegime = 'RISING';
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    expect(report.forbidden).toContainEqual({
      from: 'RISING',
      to: 'FALLING',
      count: 1,
    });
    expect(report.wrote).toBe(false);
    expect(write.calls).toEqual([]);
    expect(formatReport(report)).toContain('checks FAILED');
  });

  it('writes the same labels when run a second time', async () => {
    const rows = fixture();
    const held = snapshots();

    const first = await backfillRegimes({
      reader: reader(rows),
      writer: writer(rows).writer,
      snapshots: held.store,
      write: true,
      now: NOW,
    });

    const secondWrite = writer(rows);
    const second = await backfillRegimes({
      reader: reader(rows),
      writer: secondWrite.writer,
      snapshots: held.store,
      write: true,
      now: NOW,
    });

    expect(second.blockers).toEqual([]);
    expect(second.predictions.total.transitions).toEqual(
      first.predictions.total.transitions,
    );
    // Nothing left to move, because the labels already say what the rule says.
    expect(secondWrite.calls).toEqual([]);
    expect(rows.predictions.map((row) => row.issueRegime)).toEqual([
      'FALLING',
      'FALLING',
      'BASEFLOW',
    ]);
  });
});

describe('backfillRegimes: the snapshot', () => {
  const ISSUE = new Date('2026-07-20T00:00:00Z');

  function fixture(): Fixture {
    return {
      predictions: [
        prediction({ id: 'p-fall', issuedAt: ISSUE, issueRegime: 'PEAK' }),
      ],
      scores: [],
      runStarts: [],
      observations: series({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-21T00:00:00Z',
        recordedAt: (validTime) => validTime,
        value: bendMany([
          ['2026-07-19T12:00:00Z', 3000],
          ['2026-07-20T00:00:00Z', 400],
        ]),
      }),
    };
  }

  it('compares an interrupted and resumed run against the labels from before it', async () => {
    const rows = fixture();
    const held = snapshots();

    // The first run is stopped by its writer after the row has already been
    // set. The store now holds FALLING where the record said PEAK.
    const interrupted = writer(rows, { failAfter: 0 });
    await expect(
      backfillRegimes({
        reader: reader(rows),
        writer: interrupted.writer,
        snapshots: held.store,
        write: true,
        now: NOW,
      }),
    ).rejects.toThrow('interrupted');
    expect(rows.predictions[0].issueRegime).toBe('FALLING');
    expect(held.held()?.predictions['p-fall']).toBe('PEAK');

    // Now the row's true pre migration label turns out to have been RISING,
    // which may never move. A rerun that re-read the store would see FALLING
    // sitting where it put it, call that no movement, and pass.
    held.store.save({
      takenAt: '2026-08-27T11:00:00Z',
      predictions: { 'p-fall': 'RISING' },
      scores: {},
    });

    const resumed = writer(rows);
    const report = await backfillRegimes({
      reader: reader(rows),
      writer: resumed.writer,
      snapshots: held.store,
      write: true,
      now: NOW,
    });

    expect(report.snapshotReused).toBe(true);
    expect(report.forbidden).toContainEqual({
      from: 'RISING',
      to: 'FALLING',
      count: 1,
    });
    expect(report.wrote).toBe(false);
    expect(resumed.calls).toEqual([]);
  });

  it('saves the snapshot before it writes a single row', async () => {
    const rows = fixture();
    const held = snapshots();
    const saveOrder: string[] = [];

    const store: SnapshotStore = {
      load: async () => held.held(),
      save: async (snapshot) => {
        saveOrder.push('snapshot');
        await held.store.save(snapshot);
      },
    };

    const write = writer(rows);
    const watched: BackfillWriter = {
      setPredictionRegime: async (ids, regime) => {
        saveOrder.push('write');
        await write.writer.setPredictionRegime(ids, regime);
      },
      setScoreRegime: write.writer.setScoreRegime,
    };

    await backfillRegimes({
      reader: reader(rows),
      writer: watched,
      snapshots: store,
      write: true,
      now: NOW,
    });

    expect(saveOrder).toEqual(['snapshot', 'write']);
    expect(held.held()?.predictions['p-fall']).toBe('PEAK');
  });

  it('refuses a write over a store that is already migrated with no snapshot', async () => {
    const rows = fixture();
    rows.predictions[0].issueRegime = 'FALLING';
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    expect(report.alreadyMigrated).toBe(true);
    expect(report.wrote).toBe(false);
    expect(write.calls).toEqual([]);
  });

  it('refuses a write when a row appeared after the snapshot was taken', async () => {
    const rows = fixture();
    const held = snapshots({
      takenAt: '2026-08-27T11:00:00Z',
      predictions: {},
      scores: {},
    });
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: held.store,
      write: true,
      now: NOW,
    });

    // Forecasting is meant to be off for the whole window (AC-F11), so a row
    // the snapshot never saw means something was still writing regimes.
    expect(report.unsnapshotted.predictions).toEqual(['p-fall']);
    expect(report.wrote).toBe(false);
    expect(write.calls).toEqual([]);
  });
});

describe('backfillRegimes: scores', () => {
  const TARGET = new Date('2026-07-20T00:00:00Z');
  const RUN_STARTED = new Date('2026-07-20T00:05:00Z');
  const SCORED_AT = new Date('2026-07-20T00:09:00Z');
  const REVISED_AT = iso('2026-07-20T00:07:00Z');

  /**
   * A revision that lands between the run's `startedAt` and its `scoredAt`.
   *
   * The live job binds its history at `startedAt` and stamps `scoredAt` from a
   * second clock reading several awaits later, so these two instants really do
   * see different stores, and this fixture is built so they give different
   * answers rather than the same one twice.
   */
  function fixture(): Fixture {
    const base = series({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-20T00:00:00Z',
      recordedAt: (validTime) => validTime,
      value: bend('2026-07-19T12:00:00Z', 1000),
    });

    return {
      predictions: [],
      scores: [
        score({
          id: 's-live',
          scoredAt: SCORED_AT,
          targetTime: TARGET,
          actualCfs: 210,
          regime: 'BASEFLOW',
        }),
      ],
      runStarts: [RUN_STARTED],
      observations: [
        ...base,
        // The revision itself: same validTime, learned later, a value that
        // turns a steep fall into an ordinary flat day.
        {
          gaugeId: GAUGE,
          validTime: new Date('2026-07-19T12:00:00Z'),
          recordedAt: new Date(REVISED_AT),
          valueCfs: 205,
          qualifier: 'APPROVED',
        },
      ],
    };
  }

  it('classifies a live score from the history at its run start, not at scoredAt', async () => {
    const rows = fixture();
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    // At startedAt the revision is not yet knowable, so the 12 hour change is
    // 210 - 1000 and the river is draining.
    expect(rows.scores[0].regime).toBe('FALLING');
    expect(report.fallbackScores).toBe(0);
    expect(report.blockers).toEqual([]);
  });

  it('falls back to scoredAt when no SCORE run precedes the score, and counts it', async () => {
    const rows = fixture();
    rows.runStarts = [];
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    // Bound at scoredAt the revision is visible, the 12 hour change is 210-205,
    // and the same row is an ordinary flat day. Which is exactly why a silent
    // fallback would be the one failure neither detector can see.
    expect(rows.scores[0].regime).toBe('BASEFLOW');
    expect(report.fallbackScores).toBe(1);
    expect(formatReport(report)).toContain(
      'live scores bound at scoredAt because no SCORE run preceded them: 1',
    );
  });

  it('binds a hindcast score at its own scoredAt', async () => {
    const rows = fixture();
    rows.scores[0] = score({
      id: 's-hind',
      scoredAt: SCORED_AT,
      targetTime: TARGET,
      actualCfs: 210,
      regime: 'BASEFLOW',
      hindcast: true,
    });
    // A run exists, and must be ignored: for a hindcast row scoredAt already
    // is the simulated slot the history was built at.
    rows.runStarts = [RUN_STARTED];
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    expect(rows.scores[0].regime).toBe('BASEFLOW');
    expect(report.fallbackScores).toBe(0);
  });

  it('keeps a null score regime null', async () => {
    const rows = fixture();
    rows.scores[0] = score({
      id: 's-early',
      scoredAt: new Date('2026-07-02T00:00:00Z'),
      targetTime: new Date('2026-07-02T00:00:00Z'),
      actualCfs: 200,
    });
    rows.runStarts = [new Date('2026-07-02T00:00:00Z')];

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: writer(rows).writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    expect(rows.scores[0].regime).toBeNull();
    expect(report.nullSetMoved.scores).toEqual([]);
    expect(report.scores.total.counts.null).toBe(1);
    expect(report.blockers).toEqual([]);
  });

  it('refuses to write when a score would enter the null set', async () => {
    const rows = fixture();
    // The record says this score was classified, but there is no history at
    // its target, so recomputing it gives null. AC-F8 forbids that movement.
    rows.scores[0] = score({
      id: 's-was-classified',
      scoredAt: new Date('2026-07-02T00:00:00Z'),
      targetTime: new Date('2026-07-02T00:00:00Z'),
      actualCfs: 200,
      regime: 'BASEFLOW',
    });
    rows.runStarts = [new Date('2026-07-02T00:00:00Z')];
    const write = writer(rows);

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    expect(report.nullSetMoved.scores).toEqual(['s-was-classified']);
    expect(report.wrote).toBe(false);
    expect(write.calls).toEqual([]);
  });
});

describe('backfillRegimes: the interval columns', () => {
  it('has no way to touch anything but the regime', async () => {
    const rows: Fixture = {
      predictions: [
        prediction({
          id: 'p-1',
          issuedAt: new Date('2026-07-20T00:00:00Z'),
          issueRegime: 'PEAK',
        }),
      ],
      scores: [],
      runStarts: [],
      observations: series({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-21T00:00:00Z',
        recordedAt: (validTime) => validTime,
        value: bendMany([
          ['2026-07-19T12:00:00Z', 3000],
          ['2026-07-20T00:00:00Z', 400],
        ]),
      }),
    };
    const write = writer(rows);

    await backfillRegimes({
      reader: reader(rows),
      writer: write.writer,
      snapshots: snapshots().store,
      write: true,
      now: NOW,
    });

    // AC-F10 is structural rather than remembered: every write this can make
    // is a list of ids and a class. `lowerCfs`, `q10Used`, `intervalSeeded`
    // and `bucketSize` are not reachable from here, so an old row keeps a
    // truthful record of the interval it was actually issued with.
    expect(write.calls).toEqual([
      { column: 'prediction', ids: ['p-1'], regime: 'FALLING' },
    ]);
  });
});

describe('formatReport', () => {
  it('says plainly when nothing was written', async () => {
    const rows: Fixture = {
      predictions: [],
      scores: [],
      runStarts: [],
      observations: [],
    };

    const report = await backfillRegimes({
      reader: reader(rows),
      writer: writer(rows).writer,
      snapshots: snapshots().store,
      now: NOW,
    });

    const text = formatReport(report);
    expect(text).toContain('MODE: report only, nothing was written');
    expect(text).toContain('checks: AC-F7 and AC-F8 hold.');
  });
});
