'use client';

import { formatGrade, type GradeReveal } from '@/lib/grade-api';
import { GuessHistogram } from './GuessHistogram';
import type { GradeStreak } from './useGradeStreak';

type RevealPanelProps = {
  reveal: GradeReveal;
  streak: GradeStreak;
};

function verdict(distance: number): string {
  if (distance === 0) return 'Exactly right.';
  if (distance === 1) return 'One grade off.';
  return `${distance} grades off.`;
}

/** Who read the wall better, said plainly and without gloating either way. */
function comparison(yours: number, model: number | null): string {
  if (model === null) return 'Claude has not weighed in on this one yet.';
  if (yours < model) return 'You read it better than Claude did.';
  if (yours > model) return 'Claude read it better than you did.';
  return 'You and Claude were equally close.';
}

export function RevealPanel({ reveal, streak }: RevealPanelProps) {
  const total = reveal.plays;

  return (
    <div>
      {/* The reveal replaces the pad, so announce it rather than leaving a
          screen-reader visitor to discover the page changed under them. */}
      <div role="status" aria-live="polite">
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          cat answer.txt
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="border border-term-border p-4">
            <p className="text-term-xs uppercase tracking-wide text-term-muted">The gym says</p>
            <p className="mt-1 text-term-3xl font-bold text-term-ink terminal-glow">
              {formatGrade(reveal.trueGrade)}
            </p>
          </div>
          <div className="border border-term-border p-4">
            <p className="text-term-xs uppercase tracking-wide text-term-muted">You said</p>
            <p className="mt-1 text-term-3xl font-bold text-term-body">
              {formatGrade(reveal.yourGuess)}
            </p>
            <p className="mt-1 text-term-xs text-term-muted">{verdict(reveal.yourDistance)}</p>
          </div>
          <div className="border border-term-border p-4">
            <p className="text-term-xs uppercase tracking-wide text-term-muted">Claude said</p>
            <p className="mt-1 text-term-3xl font-bold text-term-body">
              {reveal.model ? formatGrade(reveal.model.grade) : '—'}
            </p>
            <p className="mt-1 text-term-xs text-term-muted">
              {reveal.modelDistance === null
                ? 'No analysis yet.'
                : verdict(reveal.modelDistance)}
            </p>
          </div>
        </div>

        <p className="mt-4 text-term-base text-term-body">
          {comparison(reveal.yourDistance, reveal.modelDistance)}
        </p>
      </div>

      {reveal.model ? (
        <section className="mt-10">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat claude-analysis.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-muted">
            confidence: <span className="text-term-ink">{reveal.model.confidence}</span>
          </p>

          {reveal.model.observations.length > 0 && (
            <ul className="mt-4 space-y-2">
              {reveal.model.observations.map((observation) => (
                <li
                  key={observation}
                  className="border-l border-term-border pl-4 text-term-sm leading-relaxed text-term-body"
                >
                  {observation}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 max-w-prose text-term-base leading-relaxed text-term-body">
            {reveal.model.reasoning}
          </p>
        </section>
      ) : (
        <section className="mt-10">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat claude-analysis.txt
          </p>
          <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-muted">
            Claude&apos;s read of this problem isn&apos;t available right now. The answer and the
            community numbers above are unaffected — the analysis fills in on a later play.
          </p>
        </section>
      )}

      <section className="mt-10">
        <GuessHistogram
          counts={reveal.guessCounts}
          total={total}
          yourGuess={reveal.yourGuess}
          trueGrade={reveal.trueGrade}
          modelGrade={reveal.model?.grade ?? null}
        />
      </section>

      {/* The day's note is reveal content, but it belongs to the photo — the
          host renders it as the figure's caption once the reveal lands, so it
          is deliberately not repeated here. */}

      <section className="mt-10 border-t border-term-border pt-6">
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          cat streak.txt
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          {[
            { label: 'Current streak', value: `${streak.streak} day${streak.streak === 1 ? '' : 's'}` },
            { label: 'Best streak', value: `${streak.bestStreak}` },
            { label: 'Exact hits', value: `${streak.wins}` },
            { label: 'Misses', value: `${streak.losses}` }
          ].map((stat) => (
            <div key={stat.label}>
              <dt className="text-term-xs uppercase tracking-wide text-term-muted">{stat.label}</dt>
              <dd className="mt-0.5 text-term-lg font-bold tabular-nums text-term-ink">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-term-xs text-term-muted">
          Kept in this browser only. It is never sent anywhere, so clearing site data resets it and
          a different device starts fresh.
        </p>
      </section>
    </div>
  );
}
