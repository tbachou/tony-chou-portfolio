import { GRADES, formatGrade } from '@/lib/grade-api';

type GuessHistogramProps = {
  /** One anonymous count per grade, index = grade. */
  counts: number[];
  total: number;
  yourGuess: number;
  trueGrade: number;
  modelGrade: number | null;
};

/**
 * How everyone guessed this problem.
 *
 * Rows are marked with words rather than extra colours — the terminal system
 * has one accent and design.md forbids inventing a second, so "you", "truth"
 * and "claude" are labels, which also means the distinction survives for
 * anyone who cannot separate the hues.
 */
export function GuessHistogram({
  counts,
  total,
  yourGuess,
  trueGrade,
  modelGrade
}: GuessHistogramProps) {
  const max = Math.max(1, ...counts);

  return (
    <div>
      <p className="text-term-sm text-term-muted">
        <span aria-hidden="true">$ </span>
        cat guesses.txt
      </p>
      <p className="mt-2 text-term-sm text-term-body">
        {total === 1
          ? 'You are the first to play this one.'
          : `${total.toLocaleString()} guesses on this problem so far.`}
      </p>

      <ul className="mt-4 space-y-1.5">
        {GRADES.map((grade) => {
          const count = counts[grade] ?? 0;
          const share = total > 0 ? Math.round((count / total) * 100) : 0;
          const marks = [
            grade === yourGuess ? 'you' : null,
            grade === trueGrade ? 'truth' : null,
            grade === modelGrade ? 'claude' : null
          ].filter(Boolean) as string[];

          return (
            // Wrapping matters on a phone: a fixed marks column beside the bar
            // squeezed the bar to about 70px at 375px wide. Below `sm` the
            // marks drop to their own line and the bar gets the row back.
            <li
              key={grade}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap sm:gap-x-3"
            >
              <span
                className={`w-7 shrink-0 text-term-sm tabular-nums ${
                  grade === trueGrade ? 'font-bold text-term-ink' : 'text-term-muted'
                }`}
              >
                {formatGrade(grade)}
              </span>

              {/* Decorative: the row's own numbers and labels carry the data. */}
              <span
                aria-hidden="true"
                className="h-3 min-w-[4rem] flex-1 border border-term-border"
              >
                <span
                  className="block h-full bg-term-accent"
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </span>

              <span className="w-9 shrink-0 text-right text-term-sm tabular-nums text-term-body">
                {count}
              </span>
              <span className="hidden w-10 shrink-0 text-right text-term-xs tabular-nums text-term-muted sm:inline">
                {share}%
              </span>
              {marks.length > 0 ? (
                <span className="w-full shrink-0 pl-9 text-term-xs text-term-muted sm:w-32 sm:pl-0">
                  [ {marks.join(' · ')} ]
                </span>
              ) : (
                // Keeps the columns aligned on wide viewports; on mobile the
                // row simply ends after the count.
                <span className="hidden shrink-0 sm:block sm:w-32" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
