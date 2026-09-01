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
  everIssued: null as unknown,
  everIssuedReject: false,
  lastRunReject: false,
  lastIngest: null as unknown,
  lastIngestReject: false,
  newestReadingReject: false,
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
      findFirst: async () => {
        if (state.newestReadingReject) throw new Error('reading read failed');
        return state.newestReading;
      },
    },
    pipelineRun: {
      // Two different reads now. `job: 'USGS_INGEST'` is the health one;
      // the combined set is what the panel displays. They must be
      // distinguishable, because the whole point of the fix is that a
      // rescan row can be newer and healthier than the ingest row.
      findFirst: async (args: { where?: { job?: unknown } }) => {
        const ingestOnly = args?.where?.job === 'USGS_INGEST';
        if (ingestOnly) {
          if (state.lastIngestReject) throw new Error('ingest read failed');
          return state.lastIngest;
        }
        if (state.lastRunReject) throw new Error('run read failed');
        return state.lastRun;
      },
    },
    // AC-S9's unbounded probe: has this gauge EVER had a forecast?
    prediction: {
      findFirst: async () => {
        if (state.everIssuedReject) throw new Error('probe failed');
        return state.everIssued;
      },
    },
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
  state.everIssued = { id: 'pred-ever' };
  state.everIssuedReject = false;
  state.lastRunReject = false;
  state.lastIngest = { status: 'OK' as const, startedAt: new Date(Date.now() - HOUR) };
  state.lastIngestReject = false;
  state.newestReadingReject = false;
});
afterEach(cleanup);

describe('the reading warning', () => {
  it('says nothing while the reading is fresh', async () => {
    state.newestReading = readingAt(1);

    await renderPage();

    expect(screen.queryByText(/nothing newer has reached this page/i)).toBeNull();
  });

  it('warns once the reading passes the threshold, and keeps the figure', async () => {
    state.newestReading = readingAt(30);

    await renderPage();

    expect(screen.getByText(/nothing newer has reached this page/i)).toBeTruthy();
    // AC-S3: the number is never hidden. A reader who wants the last known
    // value can still see it.
    expect(screen.getByText('143')).toBeTruthy();
  });

  it('names a broken pipeline only when the last run actually failed', async () => {
    state.newestReading = readingAt(30);
    state.lastIngest = { status: 'OK', startedAt: new Date(Date.now() - HOUR) };

    await renderPage();
    expect(screen.queryByText(/not running normally/i)).toBeNull();
    cleanup();

    state.lastIngest = { status: 'FAILED', startedAt: new Date(Date.now() - HOUR) };
    await renderPage();
    expect(screen.getByText(/not running normally/i)).toBeTruthy();
  });

  it('says the pipeline is not completing when the scheduler simply stopped', async () => {
    // AC-S4. The worst failure this page has: GitHub disables a scheduled
    // workflow after sixty days, so NO new run row is ever written and the
    // newest row stays an old success. Reading status alone reports that as
    // perfect health, which is what the first version did.
    state.newestReading = readingAt(70 * 24);
    // The ingest row itself is an old success, because nothing has run to fail.
    state.lastIngest = {
      status: 'OK',
      startedAt: new Date(Date.now() - 70 * 24 * HOUR),
    };

    await renderPage();

    expect(screen.getByText(/not running normally/i)).toBeTruthy();
  });

  it('points the reader somewhere else while the data is stale', async () => {
    // The stale state is when a reader most needs an authority, and it was
    // the state in which the pointer was furthest away.
    state.newestReading = readingAt(30);

    await renderPage();

    // The footer names them too, so scope to the warning block itself: the
    // whole point is that the pointer is HERE, not 3,400px below.
    const warning = screen.getByText(/Last measured/i);
    expect(warning.textContent).toMatch(/National Water Prediction Service/i);
    expect(
      warning.querySelector(`a[href="https://water.noaa.gov/"]`),
    ).toBeTruthy();
  });

  it('reads as a sentence at every age it can render', async () => {
    // The first version produced "This reading is 30 h ago old".
    for (const hours of [9.5, 30, 40 * 24]) {
      state.newestReading = readingAt(hours);
      await renderPage();
      const text = screen.getByText(/Last measured/i).textContent ?? '';
      expect(text).not.toMatch(/ago old/);
      expect(text).toMatch(/^Last measured .+ ago, and nothing newer/);
      cleanup();
    }
  });

  it('stays silent when the reading could not be read at all', async () => {
    // AC-S11: a failed read is a different finding and keeps its own message.
    state.newestReading = null;

    await renderPage();

    expect(screen.queryByText(/nothing newer has reached this page/i)).toBeNull();
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

  it('tells a stopped pipeline from a new one after a long outage', async () => {
    // AC-S9. The first version drew this from the loaded rows, which made it
    // unreachable: every slot writes all three horizons, so a 72 hour row is
    // always still live and "all loaded rows elapsed" cannot happen. The
    // fixture here is the real shape of a long outage: the two day query
    // returns NOTHING, and only the unbounded probe knows the pipeline once ran.
    state.predictions = [];
    state.everIssued = { id: 'pred-from-last-week' };

    await renderPage();

    expect(
      screen.getByText(/pipeline has stopped, not that it has not started/i),
    ).toBeTruthy();
    expect(screen.queryByText(/No forecast has been issued yet/i)).toBeNull();
  });

  it('still says never issued when nothing was ever issued', async () => {
    state.predictions = [];
    state.everIssued = null;

    await renderPage();

    expect(screen.getByText(/No forecast has been issued yet/i)).toBeTruthy();
  });
});

describe('the stale forecast marker', () => {
  it('marks nothing when the forecasts saw a recent reading', async () => {
    state.observations = [observationAt(3)];
    state.predictions = [forecast()];

    await renderPage();

    expect(screen.queryByText(/may be well off/i)).toBeNull();
  });

  it('collapses to one note when every surviving row is stale', async () => {
    // AC-S7. Six identical symbols for one fact is noise, and all affected is
    // the common case during an outage.
    state.observations = [observationAt(40)];
    state.predictions = [
      forecast({ horizonHours: 24 }),
      forecast({ horizonHours: 48 }),
    ];

    await renderPage();

    const notes = screen.getAllByText(/may be well off/i);
    expect(notes).toHaveLength(1);
    // and no per row markers alongside it
    expect(screen.queryByText('‡')).toBeNull();
  });

  it('marks a forecast that is old in itself, however fresh its input was', async () => {
    // AC-S5a, the gap both audit passes found independently. The predictor
    // died while ingest kept running: the reading is fresh so no warning
    // fires, the input was fresh at issue time so no input marker fires, and
    // a forty hour old forecast used to render with nothing to say so.
    state.newestReading = readingAt(1);
    state.observations = [observationAt(41)];
    state.predictions = [
      forecast({
        horizonHours: 72,
        issuedAt: new Date(Date.now() - 40 * HOUR),
        targetTime: new Date(Date.now() + 32 * HOUR),
      }),
    ];

    await renderPage();

    // no reading warning: the reading really is fresh
    expect(screen.queryByText(/nothing newer has reached this page/i)).toBeNull();
    // but the forecast is disclosed anyway
    expect(screen.getByText(/Issued more than .* hours ago/i)).toBeTruthy();
  });

  it('marks per row when only some rows are stale', async () => {
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

    expect(screen.getAllByText(/may be well off/i)).toHaveLength(1);
    expect(screen.queryByText('‡')).toBeNull();
  });
});

describe('a failed read is never reported as a fact', () => {
  it('does not claim the pipeline never started when the probe failed', async () => {
    // The defect this whole class of fix exists for. `settled` returns its
    // fallback on rejection, so a failed probe used to be indistinguishable
    // from a store that never issued, and the page said so outright while
    // holding prediction rows in hand.
    state.predictions = [];
    state.everIssuedReject = true;

    await renderPage();

    expect(screen.queryByText(/No forecast has been issued yet/i)).toBeNull();
    expect(screen.getByText(/could not check whether one has ever been issued/i)).toBeTruthy();
  });

  it('does not claim the pipeline is broken when the run read failed', async () => {
    // It used to say "the pipeline is not completing its runs" in the same
    // render as the panel below saying "the schedule itself is unaffected".
    state.newestReading = readingAt(30);
    state.lastIngestReject = true;

    await renderPage();

    expect(screen.getByText(/nothing newer has reached this page/i)).toBeTruthy();
    expect(screen.queryByText(/not running normally/i)).toBeNull();
  });

  it('still points somewhere useful when it cannot tell', async () => {
    state.predictions = [];
    state.everIssuedReject = true;

    await renderPage();

    // Scoped to the empty state itself: the footer names them too, and the
    // point of this fix is that the pointer is HERE, in the state a reader
    // reaches with no forecast on screen.
    const emptyState = screen.getByText(/could not check whether one has ever been issued/i);
    expect(
      emptyState.querySelector('a[href="https://water.noaa.gov/"]'),
    ).toBeTruthy();
    expect(emptyState.textContent).toMatch(/emergency services/i);
  });
});

describe('the page cannot call a reading stale and its forecasts fine', () => {
  it('marks rows built from a reading the page itself is warning about', async () => {
    // The six hour contradiction window after a single missed ingest, found by
    // the third gate round. The reading crosses the threshold first; forecasts
    // built from that very reading stay under it until their own age catches
    // up. For those six hours the page warned about the number and presented
    // unmarked forecasts derived from it.
    //
    // Reading 9h01m old, so it is flagged. The forecast was issued 3h ago from
    // that same reading, so its INPUT age is 6h01m, under the threshold: the
    // forecast-only predicate says fine, and only the reading's own staleness
    // makes it stale.
    const readingAge = 9 * HOUR + 60_000;
    state.newestReading = readingAt(readingAge / HOUR);
    state.observations = [observationAt(readingAge / HOUR)];
    state.predictions = [
      forecast({
        horizonHours: 72,
        issuedAt: new Date(Date.now() - 3 * HOUR),
        targetTime: new Date(Date.now() + 69 * HOUR),
      }),
    ];

    await renderPage();

    // the page is warning about the reading...
    expect(screen.getByText(/nothing newer has reached this page/i)).toBeTruthy();
    // ...so it must not present a forecast built from it as fine
    expect(screen.getByText(/may be well off/i)).toBeTruthy();
  });
});

describe('a rescan must not stand in for a dead ingest', () => {
  it('warns even when a healthy rescan is the newest pipeline row', async () => {
    // The HIGH the third gate round found. The rescan step runs even when
    // ingest fails, and a rescan with nothing to re-poll records OK, so the
    // newest row of the combined set is a fresh success for as long as ingest
    // is broken. Health is now read from the ingest job alone.
    state.newestReading = readingAt(70);
    state.lastIngest = {
      status: 'FAILED',
      startedAt: new Date(Date.now() - 70 * HOUR),
    };
    // what the display panel shows: a healthy rescan twelve minutes ago
    state.lastRun = {
      job: 'USGS_RESCAN' as const,
      status: 'OK' as const,
      startedAt: new Date(Date.now() - 12 * 60_000),
      rowsWritten: 0,
    };

    await renderPage();

    expect(screen.getByText(/not running normally/i)).toBeTruthy();
  });
});

describe('what the page says when it could not look', () => {
  it('never claims the gauge or the ingest job is fine from a failed read', async () => {
    // The READ must reject. A null reading is the empty store, a different
    // state that correctly renders nothing at all.
    state.newestReadingReject = true;

    await renderPage();

    // Queried off the DOM: these paragraphs hold child anchors, and getByText
    // joins only direct text nodes, so a regex spanning the anchors misses.
    const msg = [...document.querySelectorAll('p')].find((el) =>
      /latest reading could not be read/i.test(el.textContent ?? ''),
    );
    expect(msg?.textContent).toMatch(
      /says nothing about the gauge or the ingest job/i,
    );
    // and that state had no pointer at all before
    expect(msg?.querySelector('a[href="https://water.noaa.gov/"]')).toBeTruthy();
  });

  it('never claims the schedule is unaffected when it could not read the runs', async () => {
    state.lastRunReject = true;

    await renderPage();

    expect(screen.queryByText(/schedule itself is unaffected/i)).toBeNull();
  });
});
