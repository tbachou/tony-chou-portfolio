'use client';

import type { ObservationsResponse } from '@portfolio/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Hydrograph } from './Hydrograph';

/**
 * The hydrograph plus the control that rewinds what the store knew.
 *
 * The chart's horizontal axis moves along the river's history. This control
 * moves along ours: drag it back and the page redraws from the rows that had
 * been recorded by that moment, with anything learned later excluded. A
 * reading revised after the chosen instant reverts to the value first
 * published, and a reading not yet ingested disappears entirely.
 */

interface HydrographPanelProps {
  initial: ObservationsResponse;
  /** When the pipeline first learned anything, the earliest useful asOf. */
  earliestRecordedAt: string;
}

type Status = 'idle' | 'loading' | 'error';

function formatInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** The slider works in whole minutes to keep its step count sane. */
const MINUTE = 60 * 1000;

export function HydrographPanel({
  initial,
  earliestRecordedAt,
}: HydrographPanelProps) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState<Status>('idle');
  const [asOf, setAsOf] = useState(initial.asOf);

  const timeZone = initial.gauge.timezone;
  const latest = Date.parse(initial.asOf);
  const earliest = Math.min(Date.parse(earliestRecordedAt), latest);

  const minMinutes = Math.floor(earliest / MINUTE);
  const maxMinutes = Math.floor(latest / MINUTE);
  const currentMinutes = Math.floor(Date.parse(asOf) / MINUTE);

  // Only the newest request may write to state. Dragging the slider fires
  // several in a row and they can land out of order.
  const requestId = useRef(0);

  const load = useCallback(
    async (nextAsOf: string) => {
      const id = ++requestId.current;
      setStatus('loading');

      try {
        const query = new URLSearchParams({
          from: initial.from,
          to: initial.to,
          asOf: nextAsOf,
        });
        const response = await fetch(`/api/observations?${query}`);

        if (!response.ok) {
          throw new Error(`the store answered ${response.status}`);
        }

        const body = (await response.json()) as ObservationsResponse;
        if (id !== requestId.current) return;

        setData(body);
        setStatus('idle');
      } catch {
        if (id !== requestId.current) return;
        setStatus('error');
      }
    },
    [initial.from, initial.to],
  );

  // Debounced, so dragging the slider does not fire a request per pixel.
  //
  // It watches the chosen instant and nothing else. Watching the data as well
  // would mean every settled response scheduled the next one, since each
  // response is a fresh object: one drag would become a request every fifth
  // of a second, for as long as the page stayed open, against a query that
  // reads a month of the store each time. There is nothing to fetch at the
  // instant the page was given, because the server already sent that payload
  // and the reset button hands it straight back.
  useEffect(() => {
    if (asOf === initial.asOf) return;

    const timer = setTimeout(() => {
      void load(asOf);
    }, 180);
    return () => clearTimeout(timer);
  }, [asOf, initial.asOf, load]);

  const isRewound = Math.abs(latest - Date.parse(asOf)) > MINUTE;

  return (
    <div>
      <div
        className={
          status === 'loading' ? 'opacity-60 transition-opacity' : undefined
        }
      >
        <Hydrograph points={data.points} timeZone={timeZone} />
      </div>

      <div className="mt-6 border-t border-term-border pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <label
            htmlFor="as-of"
            className="text-term-sm text-term-ink terminal-glow"
          >
            $ known as of
          </label>
          <output
            htmlFor="as-of"
            className="text-term-sm text-term-body"
            aria-live="polite"
          >
            {formatInstant(asOf, timeZone)}
            {!isRewound && (
              <span className="ml-2 text-term-muted">(now)</span>
            )}
          </output>
        </div>

        <input
          id="as-of"
          type="range"
          min={minMinutes}
          max={maxMinutes}
          step={1}
          value={currentMinutes}
          onChange={(event) =>
            setAsOf(new Date(Number(event.target.value) * MINUTE).toISOString())
          }
          className="mt-3 w-full accent-term-accent"
          aria-describedby="as-of-help"
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p id="as-of-help" className="text-term-xs text-term-muted">
            Rewind what the pipeline had learned. Readings recorded after this
            moment are excluded, so a later correction reverts to the value
            first published.
          </p>

          {isRewound && (
            <button
              type="button"
              onClick={() => {
                // A state reset rather than a round trip: `initial` is
                // already the store as it stood at that instant.
                setData(initial);
                setStatus('idle');
                setAsOf(initial.asOf);
              }}
              className="terminal-select shrink-0 text-term-xs text-term-body"
            >
              [ back to now ]
            </button>
          )}
        </div>

        <p
          className="mt-3 text-term-xs text-term-muted"
          role="status"
          aria-live="polite"
        >
          {status === 'loading' && 'reading the store...'}
          {status === 'error' &&
            'could not read the store at that moment. The slider still works; try again.'}
          {status === 'idle' &&
            `${data.points.length.toLocaleString()} readings were known at this moment`}
        </p>
      </div>
    </div>
  );
}
