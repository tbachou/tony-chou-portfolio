'use client';

import { GRADES, formatGrade } from '@/lib/grade-api';

type GuessPadProps = {
  onGuess: (grade: number) => void;
  disabled: boolean;
  /** The grade currently being submitted, so the pad can show which one. */
  pending: number | null;
};

/**
 * The V0-V8 pad. Bracket-styled text buttons per design.md, at a 44px
 * minimum touch target so the game is playable one-thumbed on a phone.
 */
export function GuessPad({ onGuess, disabled, pending }: GuessPadProps) {
  return (
    <div>
      <p className="text-term-sm text-term-muted" id="guess-pad-label">
        <span aria-hidden="true">$ </span>
        select grade
      </p>

      <div
        role="group"
        aria-labelledby="guess-pad-label"
        className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3"
      >
        {GRADES.map((grade) => (
          <button
            key={grade}
            type="button"
            onClick={() => onGuess(grade)}
            disabled={disabled}
            aria-label={`Guess ${formatGrade(grade)}`}
            className="flex min-h-[44px] items-center justify-center whitespace-nowrap border border-term-border px-2 py-2 text-term-base font-bold text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:bg-term-accent hover:text-term-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-term-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-term-ink"
          >
            {pending === grade ? '…' : `[ ${formatGrade(grade)} ]`}
          </button>
        ))}
      </div>

      <p className="mt-3 text-term-xs text-term-muted">
        One guess reveals the answer. Nothing you click is stored against you — the server keeps
        an anonymous count per grade and nothing else.
      </p>
    </div>
  );
}
