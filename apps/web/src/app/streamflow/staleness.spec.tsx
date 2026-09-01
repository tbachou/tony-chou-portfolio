import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the dashboard says when its numbers have gone old.
 *
 * These render the real page, because the whole subject is what reaches a
 * reader and none of it is visible from a unit test of the predicate. The
 * arithmetic itself is tested in `apps/streamflow/src/forecast/staleness.spec.ts`.
 *
 * The fixture is mutable (`state` below) so each test can vary one thing:
 * a fixed set of mocks cannot express "stale reading with a failing pipeline"
 * and "fresh reading" in the same file.
 *
 * Every instant is relative to now. Fixed dates would make these tests
 * time dependent the moment the page began filtering elapsed forecasts.
 *
 * Spec 0010 child `0010-staleness-disclosure.md`, AC-S3, AC-S4, AC-S7 to AC-S11.
 */

const HOUR = 3_600_000;

const state = vi.hoisted(() => ({
  observations: [] as unknown[],
  predictions: [] as unknown[],
  newestReading: null as unknown,
  lastRun: null as unknown,
  observationsReject: false,
}));

vi.mock('@/lib/streamflow-db', () => ({
  streamflowDb: () => ({
    gauge: {
      findFirst: async () => ({
        id: 'gauge-1',
        usgsSiteId: '03230500',
        name: 'Big Darby Creek at Darbyville OH',
        lat: 39.7006,
        lon: -83.1102,
        timezone: 'America/New_York',
        active: true,
      }),
    },
    observation: {
      count: async () => 18_849,
      findFirst: async () => state.newestReading,
    },
    pipelineRun: { findFirst: async () => state.lastRun },
  }),
}));

vi.mock('@portfolio/streamflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@portfolio/streamflow')>()),
  observationsAsOf: async () => {
    if (state.observationsReject) throw new Error('read failed');
    return state.observations;
  },
  publicPredictions: async () => state.predictions,
  publicScoredErrors: async () => [],
  gradedIntervals: async () => [],
}));

vi.mock('./HydrographPanel', () => ({ HydrographPanel: () => null }));
vi.mock('./SkillChart', () => ({ SkillChart: () => null }));
vi.mock('./CalibrationPanel', () => ({ CalibrationPanel: () => null }));

function readingAt(agoHours: number) {
  return {
    validTime: new Date(Date.now() - agoHours * HOUR),
    recordedAt: new Date(Date.now() - agoHours * HOUR),
    valueCfs: 142.5,
    qualifier: 'PROVISIONAL' as const,
  };
}

function observationAt(agoHours: number, recordedAgoHours = agoHours) {
  return {
    gaugeId: 'gauge-1',
    validTime: new Date(Date.now() - agoHours * HOUR),
    recordedAt: new Date(Date.now() - recordedAgoHours * HOUR),
    valueCfs: 142.5,
    qualifier: 'PROVISIONAL' as const,
  };
}

function forecast(over: Record<string, unknown> = {}) {
  return {
    id: `pred-${Math.round(Math.random() * 1e9)}`,
    horizonHours: 24,
    issuedAt: new Date(Date.now() - 2 * HOUR),
    targetTime: new Date(Date.now() + 22 * HOUR),
    centralCfs: 150,
    lowerCfs: 110,
    upperCfs: 230,
    intervalSeeded: true,
    bucketSize: 240,
    modelVersion: { name: 'persistence', kind: 'BASELINE' },
    ...over,
  };
}

async function renderPage() {
  const { default: StreamflowPage } = await import('./page');
  render(await StreamflowPage());
}

beforeEach(() => {
  state.observations = [observationAt(3)];
  state.predictions = [];
  state.newestReading = readingAt(1);
  state.lastRun = {
    job: 'USGS_INGEST' as const,
    status: 'OK' as const,
    startedAt: new Date(Date.now() - HOUR),
    rowsWritten: 96,
  };
  state.observationsReject = false;
});
afterEach(cleanup);

describe('the reading warning', () => {
  it('says nothing while the reading is fresh', async () => {
    state.newestReading = readingAt(1);

    await renderPage();

    expect(screen.queryByText(/New readings normally arrive/i)).toBeNull();
  });

  it('warns once the reading passes the threshold, and keeps the figure', async () => {
    state.newestReading = readingAt(30);

    await renderPage();

    expect(screen.getByText(/New readings normally arrive/i)).toBeTruthy();
    // AC-S3: the number is never hidden. A reader who wants the last known
    // value can still see it.
    expect(screen.getByText('143')).toBeTruthy();
  });

  it('names a broken pipeline only when the last run actually failed', async () => {
    state.newestReading = readingAt(30);
    state.lastRun = { ...(state.lastRun as object), status: 'OK' } as unknown;

    await renderPage();
    expect(screen.queryByText(/last ingest run did not complete/i)).toBeNull();
    cleanup();

    state.lastRun = { ...(state.lastRun as object), status: 'FAILED' } as unknown;
    await renderPage();
    expect(screen.getByText(/last ingest run did not complete/i)).toBeTruthy();
  });

  it('stays silent when the reading could not be read at all', async () => {
    // AC-S11: a failed read is a different finding and keeps its own message.
    state.newestReading = null;

    await renderPage();

    expect(screen.queryByText(/New readings normally arrive/i)).toBeNull();
  });
});

describe('the forecast table', () => {
  it('drops a forecast whose target time has already passed', async () => {
    // AC-S8. Two rows, one elapsed: only the live one survives.
    state.predictions = [
      forecast({ horizonHours: 24, targetTime: new Date(Date.now() + 4 * HOUR) }),
      forecast({ horizonHours: 48, targetTime: new Date(Date.now() - 4 * HOUR) }),
    ];

    await renderPage();

    expect(screen.getByText('24 h')).toBeTruthy();
    expect(screen.queryByText('48 h')).toBeNull();
  });

  it('tells a stopped pipeline from a new one when every row has elapsed', async () => {
    // AC-S9. The old copy said "no forecast has been issued yet", which is
    // false here and reads as a fresh install rather than an outage.
    state.predictions = [
      forecast({ targetTime: new Date(Date.now() - 4 * HOUR) }),
    ];

    await renderPage();

    expect(screen.getByText(/pipeline has stopped, not that it has not started/i)).toBeTruthy();
    expect(screen.queryByText(/No forecast has been issued yet/i)).toBeNull();
  });

  it('still says never issued when nothing was ever issued', async () => {
    state.predictions = [];

    await renderPage();

    expect(screen.getByText(/No forecast has been issued yet/i)).toBeTruthy();
  });
});

describe('the stale input marker', () => {
  it('marks nothing when the forecasts saw a recent reading', async () => {
    state.observations = [observationAt(3)];
    state.predictions = [forecast()];

    await renderPage();

    expect(screen.queryByText(/had no newer measurement/i)).toBeNull();
  });

  it('collapses to one note when every surviving row is stale input', async () => {
    // AC-S7. Six identical symbols for one fact is noise, and all affected is
    // the common case during an outage.
    state.observations = [observationAt(40)];
    state.predictions = [
      forecast({ horizonHours: 24 }),
      forecast({ horizonHours: 48 }),
    ];

    await renderPage();

    const notes = screen.getAllByText(/had no newer measurement/i);
    expect(notes).toHaveLength(1);
    // and no per row markers alongside it
    expect(screen.queryByText('‡')).toBeNull();
  });

  it('marks per row when only some rows are stale input', async () => {
    // One forecast issued long ago against an old reading, one issued
    // recently against a fresh one.
    state.observations = [observationAt(40), observationAt(1)];
    state.predictions = [
      forecast({ horizonHours: 24, issuedAt: new Date(Date.now() - 30 * HOUR) }),
      forecast({ horizonHours: 48, issuedAt: new Date(Date.now() - 0.5 * HOUR) }),
    ];

    await renderPage();

    expect(screen.getAllByText('‡').length).toBeGreaterThan(0);
  });

  it('counts stale rows AFTER dropping elapsed ones, not before', async () => {
    // AC-S8a, the ordering that decides between one note and per row markers.
    // Two stale live rows plus one elapsed fresh row. Counted after the
    // filter the survivors are two of two and earn one note; counted before,
    // two of three would wrongly print markers.
    state.observations = [observationAt(40), observationAt(1)];
    state.predictions = [
      forecast({ horizonHours: 24, issuedAt: new Date(Date.now() - 30 * HOUR) }),
      forecast({ horizonHours: 48, issuedAt: new Date(Date.now() - 30 * HOUR) }),
      forecast({
        horizonHours: 72,
        issuedAt: new Date(Date.now() - 0.5 * HOUR),
        targetTime: new Date(Date.now() - 2 * HOUR),
      }),
    ];

    await renderPage();

    expect(screen.getAllByText(/had no newer measurement/i)).toHaveLength(1);
    expect(screen.queryByText('‡')).toBeNull();
  });
});
