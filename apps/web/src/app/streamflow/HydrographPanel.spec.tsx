import type { ObservationsResponse } from '@portfolio/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HydrographPanel } from './HydrographPanel';

/**
 * The panel's request handling, not its looks.
 *
 * Everything here is logic a visitor never sees until it is wrong: which
 * response is allowed to write to the screen when several are in flight, and
 * whether settling one request quietly starts another. Neither is visible to
 * the typecheck, and neither shows up in a screenshot, because a stale
 * hydrograph and a fresh one look exactly alike.
 */
const MINUTE = 60 * 1000;
const NOW = '2026-08-24T12:00:00.000Z';

function response(over: Partial<ObservationsResponse> = {}): ObservationsResponse {
  return {
    gauge: {
      usgsSiteId: '03230500',
      name: 'Big Darby Creek at Darbyville OH',
      lat: 39.7,
      lon: -83.1,
      timezone: 'America/New_York',
    },
    asOf: NOW,
    from: '2026-07-25T12:00:00.000Z',
    to: NOW,
    points: [],
    ...over,
  };
}

/** A payload the status line can count, so one response is told from another. */
function withReadings(count: number, asOf: string): ObservationsResponse {
  return response({
    asOf,
    points: Array.from({ length: count }, (_, index) => ({
      validTime: new Date(Date.parse(NOW) - index * MINUTE).toISOString(),
      recordedAt: NOW,
      valueCfs: 100 + index,
      qualifier: 'APPROVED' as const,
    })),
  });
}

const INITIAL = withReadings(9, NOW);
const EARLIEST = '2026-08-23T00:00:00.000Z';

/** Slider positions are whole minutes, which is the panel's own step. */
function minutesFor(iso: string): number {
  return Math.floor(Date.parse(iso) / MINUTE);
}

function slider() {
  return screen.getByLabelText('$ known as of');
}

/**
 * The status line under the slider.
 *
 * Scoped to the paragraph: `<output>` carries the same implicit role, and it
 * shows the chosen instant rather than what the panel is doing.
 */
function status() {
  const line = screen
    .getAllByRole('status')
    .find((element) => element.tagName === 'P');
  if (!line) throw new Error('the status line is not rendered');
  return line.textContent ?? '';
}

/** Resolves fetch calls by hand, so responses can be landed out of order. */
function deferredFetch() {
  const pending: ((value: unknown) => void)[] = [];

  const fetchMock = vi.fn(
    () => new Promise((resolve) => { pending.push(resolve); }),
  );
  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    settle(index: number, body: ObservationsResponse) {
      pending[index]({ ok: true, status: 200, json: async () => body });
    },
    fail(index: number, httpStatus: number) {
      pending[index]({ ok: false, status: httpStatus, json: async () => ({}) });
    },
  };
}

function drag(toIso: string) {
  fireEvent.change(slider(), { target: { value: String(minutesFor(toIso)) } });
}

describe('HydrographPanel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the store only once the visitor moves off the instant it was given', async () => {
    const { fetchMock } = deferredFetch();

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    expect(status()).toContain('9 readings');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a stale response that lands after a newer one', async () => {
    // Dragging fires a request per pause, and the network is free to answer
    // them in any order. Without the guard the slowest answer wins and the
    // chart shows a moment the visitor has already scrubbed past, with
    // nothing on screen saying so.
    const { fetchMock, settle } = deferredFetch();

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    drag('2026-08-23T06:00:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    drag('2026-08-23T18:00:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    settle(1, withReadings(2, '2026-08-23T18:00:00.000Z'));
    await waitFor(() => expect(status()).toContain('2 readings'));

    settle(0, withReadings(7, '2026-08-23T06:00:00.000Z'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(status()).toContain('2 readings');
  });

  it('does not start another read once one has settled', async () => {
    // The panel re-reads whenever its inputs change, and the answer is one of
    // its inputs. A dependency on the data it just received turns one drag
    // into a request every fifth of a second, for as long as the page is
    // open, against a query that reads a month of the store each time.
    const { fetchMock, settle } = deferredFetch();

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    drag('2026-08-23T06:00:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    settle(0, withReadings(4, '2026-08-23T06:00:00.000Z'));
    await waitFor(() => expect(status()).toContain('4 readings'));

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says so, and keeps the slider usable, when the store will not answer', async () => {
    const { fetchMock, fail } = deferredFetch();

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    drag('2026-08-23T06:00:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fail(0, 500);

    await waitFor(() => expect(status()).toContain('could not read the store'));
    expect((slider() as HTMLInputElement).disabled).toBe(false);
  });

  it('reports the error state when the request rejects outright', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    drag('2026-08-23T06:00:00.000Z');

    await waitFor(() => expect(status()).toContain('could not read the store'));
  });

  it('does not let a read still in flight overwrite the reset', async () => {
    // The reset makes no request, so nothing else marks the earlier one
    // abandoned. Miss that and the visitor sees the chart snap back to now
    // and then silently revert to the rewound view, with the label still
    // claiming the present.
    const { fetchMock, settle } = deferredFetch();

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    drag('2026-08-23T06:00:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Still reading. The visitor gives up and goes back to now.
    fireEvent.click(screen.getByRole('button', { name: /back to now/i }));
    await waitFor(() => expect(status()).toContain('9 readings'));

    settle(0, withReadings(4, '2026-08-23T06:00:00.000Z'));
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(status()).toContain('9 readings');
    expect(screen.getByText('(now)')).toBeTruthy();
  });

  it('restores the instant it was given without asking the store again', async () => {
    const { fetchMock, settle } = deferredFetch();

    render(<HydrographPanel initial={INITIAL} earliestRecordedAt={EARLIEST} />);

    drag('2026-08-23T06:00:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    settle(0, withReadings(4, '2026-08-23T06:00:00.000Z'));
    await waitFor(() => expect(status()).toContain('4 readings'));

    fireEvent.click(screen.getByRole('button', { name: /back to now/i }));

    // The server already sent this payload with the page, so going back to it
    // is a state reset rather than a round trip.
    await waitFor(() => expect(status()).toContain('9 readings'));
    expect(screen.getByText('(now)')).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
