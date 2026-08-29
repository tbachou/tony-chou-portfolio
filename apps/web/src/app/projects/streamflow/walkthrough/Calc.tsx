/**
 * A formula, then what it means in words.
 *
 * The walkthrough's job is to leave nothing as jargon, so every calculation
 * the pipeline performs is shown twice: once as the code states it, once in
 * plain language. Pairing them in one component is what keeps that promise
 * mechanical rather than remembered — a formula added without its explanation
 * has nowhere to render.
 *
 * `formula` keeps its own whitespace, so multi line expressions line up the
 * way they do in a terminal. It scrolls sideways on its own rather than
 * letting a long line widen the page.
 */
export function Calc({
  label,
  formula,
  children
}: {
  label: string;
  formula: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 max-w-[39rem] border border-term-border">
      <p className="border-b border-term-border px-3 py-2 text-term-xs uppercase tracking-wide text-term-muted">
        {label}
      </p>
      {/* The multi line formulas run past a phone's width, so this scrolls
          like the tables and figures do — and, like them, has to be reachable
          from a keyboard and show that there is more to the right. */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={`${label}. Scrolls sideways.`}
        className="terminal-scrollable overflow-x-auto border-b border-term-border px-3 py-3 text-term-sm text-term-ink"
      >
        {formula}
      </pre>
      <div className="space-y-2 px-3 py-3 text-term-base leading-relaxed text-term-body">
        {children}
      </div>
    </div>
  );
}

/**
 * The uppercase lead-in that opens a Calc's explanation, usually "in plain
 * words". Its own element rather than a string, so the label never gets
 * styled as body copy by accident.
 */
export function CalcLead({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-term-xs uppercase tracking-wide text-term-muted">{children}</span>
  );
}
