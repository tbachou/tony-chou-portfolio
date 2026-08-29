'use client';

import type { ObservationPoint } from '@portfolio/shared';
import { useMemo } from 'react';

/**
 * The hydrograph itself: discharge against time, drawn as inline SVG.
 *
 * No chart library. The whole picture is one polyline per stretch of readings
 * plus a handful of ticks, and drawing it directly means it inherits the
 * terminal palette from `currentColor` and the term tokens instead of fighting
 * a library's own theming.
 *
 * The vertical axis is logarithmic, which is not a stylistic choice: this
 * creek runs from about 11 to 13,200 cubic feet per second, so on a linear
 * axis every ordinary day is a flat line along the bottom and only storms are
 * visible. A log axis is what makes both the recessions and the peaks
 * readable at once, and it is the convention for streamflow for that reason.
 */

interface HydrographProps {
  points: ObservationPoint[];
  timeZone: string;
}

const WIDTH = 960;
const HEIGHT = 340;
// The top padding holds the axis unit line above the plot, not empty space.
const PADDING = { top: 40, right: 16, bottom: 34, left: 64 };

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

/**
 * Type inside the drawing is sized in viewBox units, so what a reader
 * actually gets depends on how wide the SVG is drawn. The chart is never
 * narrower than `CHART_MIN_WIDTH` below (800px against a 960 unit box), so
 * 16 here is the smallest value that still lands at the 13px floor the
 * design system sets for anything carrying information.
 */
const LABEL_SIZE = 'text-[16px]';

/**
 * A floor, not a width: the chart scrolls inside its wrapper rather than
 * squeezing, the same answer the tables on this page give. 800px keeps the
 * full-width desktop rendering exactly as it was (the column is 832px) and
 * gives every narrower viewport a scrollable chart at a legible size
 * instead of a 300px one nobody can read.
 */
const CHART_MIN_WIDTH = 'min-w-[50rem]';

/** Nice round cfs values to label a log axis with. */
const CANDIDATE_TICKS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
];

function formatCfs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

function formatDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(at);
}

export function Hydrograph({ points, timeZone }: HydrographProps) {
  const chart = useMemo(() => {
    if (points.length === 0) return null;

    const times = points.map((point) => Date.parse(point.validTime));
    const values = points.map((point) => point.valueCfs);

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    // A floor of 1 keeps log10 defined; the gauge never reads zero, but a
    // sensor fault could and a NaN would silently blank the whole chart.
    const minValue = Math.max(1, Math.min(...values));
    const maxValue = Math.max(minValue * 1.2, Math.max(...values));

    const logMin = Math.log10(minValue);
    const logMax = Math.log10(maxValue);

    const x = (at: number) =>
      PADDING.left +
      (maxTime === minTime
        ? PLOT_WIDTH / 2
        : ((at - minTime) / (maxTime - minTime)) * PLOT_WIDTH);

    const y = (value: number) =>
      PADDING.top +
      PLOT_HEIGHT -
      ((Math.log10(Math.max(1, value)) - logMin) / (logMax - logMin)) *
        PLOT_HEIGHT;

    // Split into contiguous stretches sharing a qualifier, so the still
    // provisional tail reads differently from the reviewed history. That
    // boundary is the thing the asOf control moves.
    const runs: { qualifier: ObservationPoint['qualifier']; d: string }[] = [];
    let current: ObservationPoint['qualifier'] | null = null;
    let coordinates: string[] = [];

    points.forEach((point, index) => {
      const at = x(times[index]);
      const value = y(point.valueCfs);

      if (point.qualifier !== current) {
        if (coordinates.length > 0 && current) {
          runs.push({ qualifier: current, d: coordinates.join(' ') });
        }
        // Start the new stretch at the previous point so the line has no
        // visible break where the qualifier changes.
        coordinates =
          coordinates.length > 0 ? [coordinates[coordinates.length - 1]] : [];
        current = point.qualifier;
      }

      coordinates.push(`${at.toFixed(1)},${value.toFixed(1)}`);
    });
    if (coordinates.length > 0 && current) {
      runs.push({ qualifier: current, d: coordinates.join(' ') });
    }

    const valueTicks = CANDIDATE_TICKS.filter(
      (tick) => tick >= minValue * 0.95 && tick <= maxValue * 1.05,
    );

    const dayTickCount = 5;
    const timeTicks = Array.from({ length: dayTickCount }, (_, index) => {
      const at = minTime + ((maxTime - minTime) * index) / (dayTickCount - 1);
      // The end labels sit on the plot edges, so centring them pushes half
      // of each outside the viewBox, where it is clipped. Same answer as
      // the skill chart beside this one.
      const anchor: 'start' | 'middle' | 'end' =
        index === 0 ? 'start' : index === dayTickCount - 1 ? 'end' : 'middle';
      return { at, x: x(at), anchor };
    });

    return { runs, valueTicks, timeTicks, x, y, minValue, maxValue };
  }, [points]);

  if (!chart) {
    return (
      <p className="py-16 text-center text-term-sm text-term-muted">
        No readings were known at this moment.
      </p>
    );
  }

  const { runs, valueTicks, timeTicks, y } = chart;
  const first = points[0];
  const last = points[points.length - 1];

  const summary = `Discharge at the gauge from ${formatDay(new Date(first.validTime), timeZone)} to ${formatDay(new Date(last.validTime), timeZone)}, ranging ${Math.round(chart.minValue)} to ${Math.round(chart.maxValue)} cubic feet per second on a logarithmic vertical axis, ending at ${Math.round(last.valueCfs)}.`;

  return (
    <figure className="m-0">
      {/* Focusable and named because it genuinely scrolls at most widths
          (WCAG 2.1.1): Safari does not make scroll containers focusable
          on its own, and a bare div maps to `generic`, which cannot carry
          an accessible name. `terminal-scrollable` is the shared shadow
          that says it scrolls, and only while it can. */}
      <div
        role="region"
        tabIndex={0}
        aria-label="Hydrograph, scrolls sideways on narrow screens"
        className="terminal-scrollable overflow-x-auto"
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={`h-auto w-full ${CHART_MIN_WIDTH}`}
          role="img"
          aria-label={summary}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* The axis is logarithmic, which changes what the shape means,
              so it is said on the axis rather than only in the caption
              below — by the caption a reader has already misread the
              picture. */}
          <text
            x={0}
            y={PADDING.top - 16}
            textAnchor="start"
            className={`fill-term-muted ${LABEL_SIZE}`}
          >
            log scale · cubic feet per second
          </text>

          {valueTicks.map((tick) => (
            <g key={`v-${tick}`}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-term-border"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text
                x={PADDING.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className={`fill-term-muted ${LABEL_SIZE}`}
              >
                {formatCfs(tick)}
              </text>
            </g>
          ))}

          {timeTicks.map((tick) => (
            <text
              key={`t-${tick.at}`}
              x={tick.x}
              y={HEIGHT - PADDING.bottom + 20}
              textAnchor={tick.anchor}
              className={`fill-term-muted ${LABEL_SIZE}`}
            >
              {formatDay(new Date(tick.at), timeZone)}
            </text>
          ))}

          <line
            x1={PADDING.left}
            x2={PADDING.left}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            className="stroke-term-border"
            strokeWidth={1}
          />
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            className="stroke-term-border"
            strokeWidth={1}
          />

          {runs.map((run, index) => (
            <polyline
              key={`${run.qualifier}-${index}`}
              points={run.d}
              fill="none"
              strokeWidth={run.qualifier === 'APPROVED' ? 1.75 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={
                run.qualifier === 'APPROVED' ? undefined : '4 3'
              }
              className={
                run.qualifier === 'APPROVED'
                  ? 'stroke-term-accent'
                  : 'stroke-term-muted'
              }
            />
          ))}
        </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-term-xs text-term-muted">
        <span className="flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <line
              x1="0"
              x2="26"
              y1="4"
              y2="4"
              className="stroke-term-accent"
              strokeWidth={1.75}
            />
          </svg>
          approved by USGS
        </span>
        <span className="flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <line
              x1="0"
              x2="26"
              y1="4"
              y2="4"
              className="stroke-term-muted"
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
          </svg>
          provisional, still subject to revision
        </span>
      </figcaption>
    </figure>
  );
}
