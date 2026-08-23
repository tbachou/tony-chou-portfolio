import {
  computeIngestWindow,
  expectedReadingCount,
  judgeCompleteness,
} from './window';
import { BACKFILL_START } from '../config';

const NOW = new Date('2026-08-23T18:00:00Z');

describe('computeIngestWindow', () => {
  it('starts at the backfill date when nothing is stored', () => {
    const window = computeIngestWindow(null, NOW);

    expect(window.start.toISOString()).toBe(BACKFILL_START.toISOString());
    expect(window.end).toEqual(NOW);
  });

  it('pulls the start back by the overlap so a settled reading is rechecked', () => {
    const window = computeIngestWindow(new Date('2026-08-23T17:45:00Z'), NOW);

    expect(window.start.toISOString()).toBe('2026-08-23T15:45:00.000Z');
  });

  it('asks for the whole gap after a missed run, not just the last window', () => {
    // Last reading stored thirty hours ago: the scheduled six hour window
    // would leave twenty four hours permanently missing.
    const window = computeIngestWindow(new Date('2026-08-22T12:00:00Z'), NOW);

    const spanHours =
      (window.end.getTime() - window.start.getTime()) / (60 * 60 * 1000);
    expect(spanHours).toBe(32);
  });

  it('collapses an inverted window when the stored time is ahead of the clock', () => {
    const window = computeIngestWindow(new Date('2026-08-24T00:00:00Z'), NOW);

    expect(window.start).toEqual(NOW);
    expect(window.end).toEqual(NOW);
  });

  it('does not mutate the backfill constant', () => {
    const before = BACKFILL_START.toISOString();
    const window = computeIngestWindow(null, NOW);
    window.start.setFullYear(1999);

    expect(BACKFILL_START.toISOString()).toBe(before);
  });
});

describe('expectedReadingCount', () => {
  it('counts both endpoints of the window', () => {
    const window = {
      start: new Date('2026-08-23T17:00:00Z'),
      end: new Date('2026-08-23T18:00:00Z'),
    };

    expect(expectedReadingCount(window, 15)).toBe(5);
  });

  it('is zero for an empty window', () => {
    expect(expectedReadingCount({ start: NOW, end: NOW }, 15)).toBe(0);
  });

  it('counts only the boundaries a window that starts mid interval can hold', () => {
    // A real ingest window: anchored to a stored reading minus the overlap,
    // ending at the current instant, so neither end lands on a quarter hour.
    const window = {
      start: new Date('2026-08-23T12:37:38.234Z'),
      end: new Date('2026-08-23T20:37:38.234Z'),
    };

    // 12:45 through 20:30 inclusive, not the 33 that dividing the span gives.
    expect(expectedReadingCount(window, 15)).toBe(32);
  });

  it('is zero when no boundary falls inside a short window', () => {
    const window = {
      start: new Date('2026-08-23T12:01:00Z'),
      end: new Date('2026-08-23T12:14:00Z'),
    };

    expect(expectedReadingCount(window, 15)).toBe(0);
  });
});

describe('judgeCompleteness', () => {
  // 15:45 to 18:00 is nine intervals, so ten readings if none were missed.
  const window = {
    start: new Date('2026-08-23T15:45:00Z'),
    end: new Date('2026-08-23T18:00:00Z'),
  };

  it('accepts a full response', () => {
    expect(judgeCompleteness(10, window, 15)).toBe('OK');
  });

  it('tolerates the newest readings not being published yet', () => {
    expect(judgeCompleteness(8, window, 15)).toBe('OK');
  });

  it('reports PARTIAL once more than the publication lag is missing', () => {
    expect(judgeCompleteness(7, window, 15)).toBe('PARTIAL');
  });

  it('reports PARTIAL when a gauge that died days ago returns only its old readings', () => {
    const afterOutage = {
      start: new Date('2026-08-20T16:00:00Z'),
      end: new Date('2026-08-23T18:00:00Z'),
    };

    expect(judgeCompleteness(9, afterOutage, 15)).toBe('PARTIAL');
  });

  it('calls a flawless response OK when the window starts mid interval', () => {
    // The case the live gauge produced: 30 readings from 12:45 to 20:00 is
    // everything that could exist, and an earlier rule read it as PARTIAL.
    const realWindow = {
      start: new Date('2026-08-23T12:37:38.234Z'),
      end: new Date('2026-08-23T20:37:38.234Z'),
    };

    expect(judgeCompleteness(30, realWindow, 15)).toBe('OK');
  });

  it('does not call an empty window partial', () => {
    const at = new Date('2026-08-23T18:00:00Z');

    expect(judgeCompleteness(0, { start: at, end: at }, 15)).toBe('OK');
  });
});
