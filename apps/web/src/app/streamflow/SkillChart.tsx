'use client';

import { useMemo, useState } from 'react';

/**
 * How wrong each forecaster has been, over time, one line per baseline.
 *
 * The comparison is the whole point. An error of twelve percent means nothing
 * on its own; it acquires meaning beside the error of the dumbest defensible
 * alternative. So this never draws one line, and it never hides the stretches
 * where a forecaster does badly.
 *
 * Inline SVG and no chart library, like the hydrograph beside it, so the
 * lines inherit the terminal palette rather than fighting a library's own
 * theming. The two baselines are told apart by stroke weight and dash rather
 * than by colour, because this site has one accent and the single exception
 * to that lives in the interview transcript.
 *
 * The vertical axis is linear here, unlike the hydrograph's. Percentage error
 * spans roughly one order of magnitude between a calm week and a storm week,
 * not the three that discharge spans, and a log axis would flatten exactly the
 * difference the chart exists to show.
 */

export interface SkillSeriesJson {
  modelName: string;
  horizonHours: number;
  points: { at: string; meanPctError: number; sampleSize: number }[];
}

interface SkillChartProps {
  series: SkillSeriesJson[];
  horizons: number[];
  windowDays: number;
  timeZone: string;
}

const WIDTH = 960;
const HEIGHT = 300;
const PADDING = { top: 16, right: 16, bottom: 34, left: 56 };

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

/**
 * Stroke styles in the order series are assigned them. Three, so the learned
 * model arriving later gets one without a redesign.
 */
const STROKES = [
  { className: 'stroke-term-accent', width: 1.75, dash: undefined },
  { className: 'stroke-term-muted', width: 1.25, dash: '4 3' },
  { className: 'stroke-term-body', width: 1.25, dash: '1 3' },
];

const CANDIDATE_TICKS = [
  0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5,
];

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDay(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(at));
}

export function SkillChart({
  series,
  horizons,
  windowDays,
  timeZone,
}: SkillChartProps) {
  const [horizon, setHorizon] = useState(horizons[0]);

  const shown = useMemo(
    () =>
      series
        .filter((one) => one.horizonHours === horizon && one.points.length > 0)
        .sort((a, b) => a.modelName.localeCompare(b.modelName)),
    [series, horizon],
  );

  const chart = useMemo(() => {
    const points = shown.flatMap((one) => one.points);
    if (points.length === 0) return null;

    const times = points.map((point) => Date.parse(point.at));
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const maxError = Math.max(...points.map((point) => point.meanPctError));
    // Headroom so the worst point is not drawn on the frame itself.
    const top = maxError * 1.15;

    const x = (at: number) =>
      PADDING.left +
      (maxTime === minTime
        ? PLOT_WIDTH / 2
        : ((at - minTime) / (maxTime - minTime)) * PLOT_WIDTH);

    const y = (value: number) =>
      PADDING.top + PLOT_HEIGHT - (value / top) * PLOT_HEIGHT;

    const lines = shown.map((one, index) => ({
      modelName: one.modelName,
      stroke: STROKES[index % STROKES.length],
      d: one.points
        .map(
          (point) =>
            `${x(Date.parse(point.at)).toFixed(1)},${y(point.meanPctError).toFixed(1)}`,
        )
        .join(' '),
      last: one.points[one.points.length - 1],
    }));

    // Candidates crowd together at the bottom once the axis reaches far
    // enough to hold a storm week: at a 50 percent ceiling, 0 and 5 percent
    // land closer than the type is tall. Keep only ticks that stay clear of
    // the one below.
    const MIN_TICK_GAP = 22;
    const valueTicks: number[] = [];
    for (const tick of CANDIDATE_TICKS) {
      if (tick > top) break;
      const last = valueTicks[valueTicks.length - 1];
      if (last === undefined || Math.abs(y(tick) - y(last)) >= MIN_TICK_GAP) {
        valueTicks.push(tick);
      }
    }

    const tickCount = 5;
    const timeTicks = Array.from({ length: tickCount }, (_, index) => {
      const at = minTime + ((maxTime - minTime) * index) / (tickCount - 1);
      // The end labels sit on the plot edges, so centring them would push
      // half of each outside the viewBox and clip it.
      const anchor: 'start' | 'middle' | 'end' =
        index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle';
      return { at, x: x(at), anchor };
    });

    return { lines, valueTicks, timeTicks, y, minTime, maxTime };
  }, [shown]);

  const summary = chart
    ? `Rolling ${windowDays} day mean percentage error at ${horizon} hours, ${formatDay(chart.minTime, timeZone)} to ${formatDay(chart.maxTime, timeZone)}. ${chart.lines
        .map(
          (line) =>
            `${line.modelName} ends at ${formatPct(line.last.meanPctError)}`,
        )
        .join('; ')}.`
    : `No scored predictions yet at ${horizon} hours.`;

  return (
    <figure className="m-0">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-term-sm"
        role="group"
        aria-label="Forecast horizon"
      >
        <span className="text-term-xs text-term-muted">horizon</span>
        {horizons.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setHorizon(option)}
            aria-pressed={option === horizon}
            className="terminal-select tabular-nums"
          >
            [ {option} h ]
          </button>
        ))}
      </div>

      {chart ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="mt-5 h-auto w-full"
          role="img"
          aria-label={summary}
          preserveAspectRatio="xMidYMid meet"
        >
          {chart.valueTicks.map((tick) => (
            <g key={`v-${tick}`}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={chart.y(tick)}
                y2={chart.y(tick)}
                className="stroke-term-border"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text
                x={PADDING.left - 8}
                y={chart.y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-term-muted text-[11px]"
              >
                {formatPct(tick)}
              </text>
            </g>
          ))}

          {chart.timeTicks.map((tick) => (
            <text
              key={`t-${tick.at}`}
              x={tick.x}
              y={HEIGHT - PADDING.bottom + 20}
              textAnchor={tick.anchor}
              className="fill-term-muted text-[11px]"
            >
              {formatDay(tick.at, timeZone)}
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

          {chart.lines.map((line) => (
            <polyline
              key={line.modelName}
              points={line.d}
              fill="none"
              strokeWidth={line.stroke.width}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={line.stroke.dash}
              className={line.stroke.className}
            />
          ))}
        </svg>
      ) : (
        <p className="mt-5 border border-term-border px-4 py-10 text-center text-term-sm text-term-muted">
          Nothing scored at {horizon} hours yet. This chart shows only
          predictions the pipeline issued live and then judged against what
          actually happened, so it fills in as the record accumulates rather
          than arriving complete.
        </p>
      )}

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-term-xs text-term-muted">
        {chart?.lines.map((line) => (
          <span key={line.modelName} className="flex items-center gap-2">
            <svg width="26" height="8" aria-hidden="true">
              <line
                x1="0"
                x2="26"
                y1="4"
                y2="4"
                className={line.stroke.className}
                strokeWidth={line.stroke.width}
                strokeDasharray={line.stroke.dash}
              />
            </svg>
            {line.modelName}
            <span className="tabular-nums">
              {formatPct(line.last.meanPctError)}
            </span>
          </span>
        ))}
        <span>
          rolling {windowDays} day mean, lower is better
        </span>
      </figcaption>
    </figure>
  );
}
