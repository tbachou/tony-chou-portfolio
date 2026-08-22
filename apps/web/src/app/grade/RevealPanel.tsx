'use client';

import { formatGrade, type GradeReveal } from '@/lib/grade-api';
import { GuessHistogram } from './GuessHistogram';
import { ShareButton } from './ShareButton';
import { useTypewriter } from './useTypewriter';

type RevealPanelProps = {
  reveal: GradeReveal;
  /** 1 based position in the set, for the share summary (AC-11). */
  position: number;
  total: number;
  /**
   * True when this reveal came from the browser's saved copy rather than from
   * a guess just made (AC-26). It changes the framing, not the content: the
   * counts are as they stood when this visitor played, and saying so is more
   * honest than showing stale numbers as if they were live.
   */
  fromCache: boolean;
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

/**
 * Claude's reasoning, printed rather than pasted.
 *
 * The animated copy is `aria-hidden` and the real string sits beside it in a
 * visually hidden element, so a screen reader gets the whole paragraph once
 * instead of a string growing two characters at a time.
 */
function TypedReasoning({ text }: { text: string }) {
  const { visible, done } = useTypewriter(text);

  return (
    <p className="mt-4 max-w-[70ch] text-term-base leading-relaxed text-term-body">
      <span aria-hidden="true">
        {visible}
        {!done && (
          <span className="terminal-cursor" aria-hidden="true">
            _
          </span>
        )}
      </span>
      <span className="sr-only">{text}</span>
    </p>
  );
}

export function RevealPanel({ reveal, position, total, fromCache }: RevealPanelProps) {
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
              {reveal.modelDistance === null ? 'No analysis yet.' : verdict(reveal.modelDistance)}
            </p>
          </div>
        </div>

        <p className="mt-4 text-term-base text-term-body">
          {comparison(reveal.yourDistance, reveal.modelDistance)}
        </p>
      </div>

      <section className="mt-10">
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          cat claude-analysis.txt
        </p>

        {reveal.model ? (
          <>
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

            <TypedReasoning text={reveal.model.reasoning} />
          </>
        ) : (
          <p className="mt-2 max-w-[70ch] text-term-sm leading-relaxed text-term-muted">
            Claude&apos;s read of this problem isn&apos;t available right now. The answer and the
            community numbers above are unaffected — the analysis fills in on a later play.
          </p>
        )}
      </section>

      <section className="mt-10">
        <GuessHistogram
          counts={reveal.guessCounts}
          total={reveal.plays}
          yourGuess={reveal.yourGuess}
          trueGrade={reveal.trueGrade}
          modelGrade={reveal.model?.grade ?? null}
        />
        {fromCache && (
          <p className="mt-3 text-term-xs text-term-muted">
            These counts are from when you played this one. Others have kept guessing since.
          </p>
        )}
      </section>

      <section className="mt-10 border-t border-term-border pt-6">
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          ./share
        </p>
        <div className="mt-3">
          <ShareButton reveal={reveal} position={position} total={total} />
        </div>
      </section>
    </div>
  );
}
