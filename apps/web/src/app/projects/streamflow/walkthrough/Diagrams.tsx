/**
 * The three drawings in the walkthrough.
 *
 * Hand authored SVG rather than a chart library: each one shows a mechanism
 * that has no data behind it, so there is nothing to plot. Strokes and text
 * use `currentColor` and inherit the surrounding type colour, which is what
 * makes them work in both the CRT and printout palettes without a second
 * copy. The one emphasised element per drawing reaches for the accent token
 * directly, for the same reason: `var(--color-accent)` resolves per palette,
 * where a literal hex would be legible in exactly one of them.
 *
 * Each is wrapped in a scrolling container by the caller, so a narrow phone
 * pans the drawing rather than squashing its labels below legibility.
 */

const ACCENT = 'var(--color-accent)';

function Figure({
  caption,
  label,
  children
}: {
  caption: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="mt-6">
      <div className="overflow-x-auto border border-term-border p-4">
        <svg
          role="img"
          aria-label={label}
          className="mx-auto block h-auto w-full text-term-body"
          viewBox="0 0 720 260"
        >
          {children}
        </svg>
      </div>
      <figcaption className="mt-2 max-w-prose text-term-xs leading-relaxed text-term-muted">
        {caption}
      </figcaption>
    </figure>
  );
}

/** An arrowhead, one per drawing so the ids cannot collide on the page. */
function Arrow({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
    </defs>
  );
}

export function TwoTimestampsDiagram() {
  return (
    <Figure
      label="One river moment stored three times. Asking as of March returns 512 cfs; asking as of the end of June returns the reviewed value of 498 cfs."
      caption="Illustrative values. A forecast made in March must be judged against what March could see; the cutoff is the only thing standing between the reader and the correction."
    >
      <Arrow id="wt-arrow-clocks" />

      <text x="0" y="14" fontSize="12" fill="currentColor" opacity="0.65">
        three stored rows, all describing the same river moment (Jan 15, 14:00)
      </text>

      <rect x="0" y="30" width="330" height="34" fill="none" stroke="currentColor" />
      <text x="12" y="51" fontSize="12" fill="currentColor">
        learned Jan 15 · 512 cfs · provisional
      </text>

      <rect x="0" y="74" width="330" height="34" fill="none" stroke="currentColor" />
      <text x="12" y="95" fontSize="12" fill="currentColor">
        learned Feb 02 · 512 cfs · provisional
      </text>

      <rect x="0" y="118" width="330" height="34" fill="none" stroke={ACCENT} strokeWidth="2" />
      <text x="12" y="139" fontSize="12" fill="currentColor">
        learned Jun 09 · 498 cfs · approved
      </text>

      <line x1="400" y1="24" x2="400" y2="192" stroke="currentColor" strokeDasharray="4 4" />
      <text x="400" y="16" fontSize="11" fill="currentColor" textAnchor="middle" opacity="0.75">
        ask as of Mar
      </text>
      <line x1="560" y1="24" x2="560" y2="192" stroke="currentColor" strokeDasharray="4 4" />
      <text x="560" y="16" fontSize="11" fill="currentColor" textAnchor="middle" opacity="0.75">
        ask as of Jun 30
      </text>

      <line x1="336" y1="47" x2="392" y2="47" stroke="currentColor" markerEnd="url(#wt-arrow-clocks)" />
      <line x1="336" y1="91" x2="392" y2="91" stroke="currentColor" markerEnd="url(#wt-arrow-clocks)" />
      <text x="410" y="74" fontSize="13" fill="currentColor">
        answer: 512
      </text>
      <text x="410" y="92" fontSize="11" fill="currentColor" opacity="0.7">
        newest row at or before
      </text>

      <line
        x1="336"
        y1="135"
        x2="552"
        y2="135"
        stroke={ACCENT}
        strokeWidth="2"
        markerEnd="url(#wt-arrow-clocks)"
      />
      <text x="570" y="131" fontSize="13" fill="currentColor">
        answer: 498
      </text>
      <text x="570" y="149" fontSize="11" fill="currentColor" opacity="0.7">
        the correction is
      </text>
      <text x="570" y="163" fontSize="11" fill="currentColor" opacity="0.7">
        now visible
      </text>

      <text x="0" y="196" fontSize="12" fill="currentColor" opacity="0.65">
        the June row exists the whole time — the cutoff decides whether you may see it
      </text>
    </Figure>
  );
}

export function JobsDiagram() {
  const jobs = [
    { y: 26, name: 'ingest', note: 'pull new readings' },
    { y: 76, name: 'rescan', note: 're-check old ones' },
    { y: 126, name: 'predict', note: '6 forecasts / slot' },
    { y: 176, name: 'score', note: 'grade the past ones' }
  ];
  const tables = ['readings', 'forecasts', 'grades', 'job history'];

  return (
    <Figure
      label="Four scheduled jobs write to one database; the website reads from it. No job calls another; they coordinate only through stored rows."
      caption="Predict reads what ingest wrote; score reads what predict wrote. Nothing is passed between them in memory or over a network."
    >
      <Arrow id="wt-arrow-jobs" />

      <text x="0" y="14" fontSize="11" fill="currentColor" opacity="0.6">
        SCHEDULED JOBS
      </text>

      {jobs.map((job) => (
        <g key={job.name}>
          <rect x="0" y={job.y} width="150" height="40" fill="none" stroke="currentColor" />
          <text x="12" y={job.y + 18} fontSize="12" fill="currentColor">
            {job.name}
          </text>
          <text x="12" y={job.y + 33} fontSize="10" fill="currentColor" opacity="0.7">
            {job.note}
          </text>
        </g>
      ))}

      <line x1="156" y1="46" x2="286" y2="105" stroke="currentColor" markerEnd="url(#wt-arrow-jobs)" />
      <line x1="156" y1="96" x2="286" y2="112" stroke="currentColor" markerEnd="url(#wt-arrow-jobs)" />
      <line x1="156" y1="146" x2="286" y2="126" stroke="currentColor" markerEnd="url(#wt-arrow-jobs)" />
      <line x1="156" y1="196" x2="286" y2="134" stroke="currentColor" markerEnd="url(#wt-arrow-jobs)" />
      <text x="192" y="72" fontSize="10" fill="currentColor" opacity="0.75">
        only ever add rows
      </text>

      <rect x="292" y="60" width="176" height="120" fill="none" stroke={ACCENT} strokeWidth="2" />
      <text x="380" y="84" fontSize="12" fill="currentColor" textAnchor="middle">
        the database
      </text>
      <line x1="292" y1="94" x2="468" y2="94" stroke="currentColor" opacity="0.4" />
      {tables.map((table, index) => (
        <text
          key={table}
          x="304"
          y={112 + index * 18}
          fontSize="11"
          fill="currentColor"
          opacity="0.85"
        >
          {table}
        </text>
      ))}

      <line x1="474" y1="120" x2="560" y2="120" stroke="currentColor" markerEnd="url(#wt-arrow-jobs)" />
      <text x="482" y="112" fontSize="10" fill="currentColor" opacity="0.75">
        reads
      </text>

      <rect x="566" y="86" width="150" height="68" fill="none" stroke="currentColor" />
      <text x="578" y="106" fontSize="12" fill="currentColor">
        the website
      </text>
      <text x="578" y="126" fontSize="10" fill="currentColor" opacity="0.75">
        the public scorecard
      </text>

      <line x1="0" y1="218" x2="720" y2="218" stroke="currentColor" opacity="0.3" />
      <text x="0" y="238" fontSize="11" fill="currentColor" opacity="0.7">
        No job ever calls another. They coordinate entirely through rows in the database,
      </text>
      <text x="0" y="254" fontSize="11" fill="currentColor" opacity="0.7">
        so a job that fails simply leaves less for the next one to find.
      </text>
    </Figure>
  );
}

export function IntervalLadderDiagram() {
  return (
    <Figure
      label="The interval ladder: try the errors from this river state, then all errors pooled together, then a fixed placeholder band. Each rung requires at least thirty past errors."
      caption="Thirty is the conventional minimum for a sample's edges to mean anything. Every published forecast records which rung it landed on, so a reader can tell an earned range from a placeholder."
    >
      <Arrow id="wt-arrow-ladder" />

      <rect x="0" y="10" width="300" height="52" fill="none" stroke={ACCENT} strokeWidth="2" />
      <text x="14" y="32" fontSize="12" fill="currentColor">
        errors in THIS river state
      </text>
      <text x="14" y="50" fontSize="10" fill="currentColor" opacity="0.75">
        same forecaster, same horizon
      </text>

      <text x="316" y="32" fontSize="11" fill="currentColor">
        30 or more?
      </text>
      <line x1="392" y1="28" x2="440" y2="28" stroke="currentColor" markerEnd="url(#wt-arrow-ladder)" />
      <text x="450" y="26" fontSize="12" fill="currentColor">
        use them
      </text>
      <text x="450" y="44" fontSize="10" fill="currentColor" opacity="0.75">
        the earned range
      </text>

      <line
        x1="150"
        y1="62"
        x2="150"
        y2="92"
        stroke="currentColor"
        strokeDasharray="3 3"
        markerEnd="url(#wt-arrow-ladder)"
      />
      <text x="160" y="82" fontSize="10" fill="currentColor" opacity="0.75">
        too few
      </text>

      <rect x="0" y="96" width="300" height="52" fill="none" stroke="currentColor" />
      <text x="14" y="118" fontSize="12" fill="currentColor">
        errors in ALL river states
      </text>
      <text x="14" y="136" fontSize="10" fill="currentColor" opacity="0.75">
        pooled together
      </text>

      <text x="316" y="118" fontSize="11" fill="currentColor">
        30 or more?
      </text>
      <line
        x1="392"
        y1="114"
        x2="440"
        y2="114"
        stroke="currentColor"
        markerEnd="url(#wt-arrow-ladder)"
      />
      <text x="450" y="112" fontSize="12" fill="currentColor">
        use them
      </text>
      <text x="450" y="130" fontSize="10" fill="currentColor" opacity="0.75">
        real, but not tailored
      </text>

      <line
        x1="150"
        y1="148"
        x2="150"
        y2="178"
        stroke="currentColor"
        strokeDasharray="3 3"
        markerEnd="url(#wt-arrow-ladder)"
      />
      <text x="160" y="168" fontSize="10" fill="currentColor" opacity="0.75">
        still too few
      </text>

      <rect
        x="0"
        y="182"
        width="300"
        height="52"
        fill="none"
        stroke="currentColor"
        strokeDasharray="5 3"
      />
      <text x="14" y="204" fontSize="12" fill="currentColor">
        a fixed wide band
      </text>
      <text x="14" y="222" fontSize="10" fill="currentColor" opacity="0.75">
        a third of the guess, to triple it
      </text>

      <line
        x1="306"
        y1="208"
        x2="440"
        y2="208"
        stroke="currentColor"
        markerEnd="url(#wt-arrow-ladder)"
      />
      <text x="450" y="206" fontSize="12" fill="currentColor">
        admit we do not know
      </text>
      <text x="450" y="224" fontSize="10" fill="currentColor" opacity="0.75">
        marked as unearned
      </text>
    </Figure>
  );
}
