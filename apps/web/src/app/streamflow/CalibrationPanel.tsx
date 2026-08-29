import type { CalibrationReport, CoverageGroup } from '@portfolio/streamflow';

/**
 * Whether the published ranges mean what they say.
 *
 * Every forecast on this page claims an 80 percent range: the truth is meant
 * to land inside it about four times in five. The skill chart above answers a
 * different question, how far off the central guess was, and a forecaster can
 * look respectable there while publishing ranges that are badly wrong.
 *
 * Two populations, never summed. The backtest replayed two and a half years
 * and is the only sample large enough to say anything with confidence; the
 * live rows are what this pipeline has actually published since it went live,
 * and there are very few of them. Showing only the backtest would be the
 * flattering lie the rest of this page is built to avoid — those forecasts
 * were computed retrospectively and never faced anyone. Showing only the live
 * figure would read as a verdict off a sample far too small to give one. So
 * both, live first, with the count carrying the same weight as the
 * percentage, because here the count is most of the meaning.
 */

/** A percentage, or a dash when the group is empty. */
function pct(value: number | null): string {
  return value === null ? '—' : `${(100 * value).toFixed(1)}%`;
}

/** The signed distance from what was claimed, in percentage points. */
function gapLabel(gap: number | null): string {
  if (gap === null) return '';
  const points = 100 * gap;
  if (Math.abs(points) < 0.05) return 'on target';
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} pts`;
}

/**
 * Rows are ranked by how far they sit from what they claimed, worst first.
 *
 * The point of splitting at all is to surface the group that is wrong, so
 * sorting by anything else would bury the finding under alphabetical order.
 */
function byWorstGap(a: CoverageGroup, b: CoverageGroup): number {
  return Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0);
}

function CoverageRows({ groups }: { groups: CoverageGroup[] }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Coverage by group, scrolls sideways"
      className="terminal-scrollable mt-3 overflow-x-auto"
    >
      <table className="w-full min-w-[26rem] border-collapse text-term-sm">
        <thead>
          <tr className="border-b border-term-border">
            <th className="px-2 py-2 text-left text-term-xs uppercase tracking-wide text-term-muted">
              group
            </th>
            <th className="px-2 py-2 text-right text-term-xs uppercase tracking-wide text-term-muted">
              inside
            </th>
            <th className="px-2 py-2 text-right text-term-xs uppercase tracking-wide text-term-muted">
              of
            </th>
            <th className="px-2 py-2 text-right text-term-xs uppercase tracking-wide text-term-muted">
              observed
            </th>
            <th className="px-2 py-2 text-right text-term-xs uppercase tracking-wide text-term-muted">
              vs claimed
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.label} className="border-b border-term-border last:border-b-0">
              <td className="whitespace-nowrap px-2 py-2 text-term-body">{group.label}</td>
              <td className="px-2 py-2 text-right tabular-nums text-term-muted">
                {group.inside.toLocaleString()}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-term-muted">
                {group.total.toLocaleString()}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-term-ink">
                {pct(group.observed)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-term-muted">
                {gapLabel(group.gap)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One population's headline: the share, and the count it rests on. */
function Headline({
  label,
  detail,
  report
}: {
  label: string;
  detail: string;
  report: CalibrationReport;
}) {
  const { observed, nominal, total } = report.overall;
  return (
    <div className="border border-term-border p-4">
      <p className="text-term-xs uppercase tracking-wide text-term-muted">{label}</p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-term-xl tabular-nums text-term-ink terminal-glow">
          {pct(observed)}
        </span>
        {/* The count is not a footnote here. Fifty forecasts and seventeen
            thousand support very different claims, and the percentage alone
            hides which one you are reading. */}
        <span className="text-term-sm tabular-nums text-term-body">
          of {total.toLocaleString()} graded
        </span>
        {nominal !== null && (
          <span className="text-term-xs text-term-muted">
            against {pct(nominal)} claimed
          </span>
        )}
      </p>
      <p className="mt-2 text-term-xs leading-relaxed text-term-muted">{detail}</p>
    </div>
  );
}

export function CalibrationPanel({
  live,
  backtest
}: {
  live: CalibrationReport;
  backtest: CalibrationReport;
}) {
  // Worst first, and only groups with enough behind them to mean anything.
  // Thirty is the same floor the intervals themselves use before they will
  // draw on a bucket, so a group too thin to set a range is also too thin to
  // be judged by one.
  const worstBacktest = [...backtest.byRegime]
    .filter((group) => group.total >= 30)
    .sort(byWorstGap)
    .slice(0, 6);

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Headline
          label="live · issued for real"
          detail="Forecasts this pipeline published, graded once their target passed. Small and moving: every six hours adds six more."
          report={live}
        />
        <Headline
          label="backtest · replayed history"
          detail="The seeding run, replayed across the archive before anything went live. Large enough to trust, but these forecasts never faced anyone."
          report={backtest}
        />
      </div>

      {live.overall.observed !== null &&
        backtest.overall.observed !== null &&
        Math.abs(live.overall.observed - backtest.overall.observed) > 0.1 && (
          <p className="mt-4 max-w-[39rem] border-l-2 border-term-accent pl-4 text-term-sm leading-relaxed text-term-body">
            Those two disagree, and the gap is too wide to be sampling noise. A backtest that
            calibrates well is not evidence that the live system does — which is the whole reason
            both are on this page rather than one number.
          </p>
        )}

      {worstBacktest.length > 0 && (
        <div className="mt-8">
          <h3 className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            coverage --by river-state --backtest
          </h3>
          <p className="mt-2 max-w-[39rem] text-term-sm leading-relaxed text-term-body">
            Worst first, over the replayed record, for groups with at least 30 grades behind them.
            A single pooled figure can sit near the claim while one river state is badly wrong and
            another compensates, which is exactly what these rows are for.
          </p>
          <CoverageRows groups={worstBacktest} />
        </div>
      )}
    </>
  );
}
