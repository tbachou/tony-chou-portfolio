'use client';

import { useCallback, useState } from 'react';
import { formatGrade, type GradeReveal } from '@/lib/grade-api';

type ShareButtonProps = {
  reveal: GradeReveal;
  /** 1 based position in the set the client already holds (AC-11). */
  position: number;
  total: number;
};

const SITE_URL = 'https://tonychou.dev/grade';

/** Filled squares to the truth, hollow past it: distance read at a glance. */
function distanceBar(distance: number): string {
  if (distance === 0) return '🟩';
  return '🟨'.repeat(Math.min(distance, 4));
}

/**
 * The spoiler safe summary (AC-11).
 *
 * Deliberately carries NO grade of any kind, neither the truth, the guess, nor
 * Claude's. It reports how CLOSE each was, which is the interesting part and
 * the part that cannot spoil the problem for whoever reads it. A summary
 * naming V5 would hand the answer to the next player.
 */
export function buildShareText(reveal: GradeReveal, position: number, total: number): string {
  const yours = `you  ${distanceBar(reveal.yourDistance)}`;
  const claude =
    reveal.modelDistance === null
      ? 'claude  (no read)'
      : `claude  ${distanceBar(reveal.modelDistance)}`;
  const verdict =
    reveal.modelDistance === null
      ? ''
      : reveal.yourDistance < reveal.modelDistance
        ? '\nI read it better than Claude.'
        : reveal.yourDistance > reveal.modelDistance
          ? '\nClaude read it better than I did.'
          : '\nDead even with Claude.';

  return `Grade Guesser — problem ${position}/${total}\n${yours}\n${claude}${verdict}\n${SITE_URL}`;
}

/**
 * Clipboard only (AC-11): no share tracking, no visitor identifier, nothing
 * sent to the server. The Web Share API is deliberately NOT used — it hands
 * the text to an OS sheet that may report what was chosen, and the clipboard
 * keeps the whole thing on the visitor's machine.
 */
export function ShareButton({ reveal, position, total }: ShareButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildShareText(reveal, position, total));
      setState('copied');
      window.setTimeout(() => setState('idle'), 2400);
    } catch {
      // Clipboard blocked (no permission, insecure origin, older browser).
      setState('failed');
    }
  }, [reveal, position, total]);

  return (
    <div>
      <button
        type="button"
        onClick={() => void copy()}
        className="min-h-[44px] text-term-base font-bold text-term-ink terminal-select transition-colors duration-term-instant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-term-accent"
      >
        {state === 'copied' ? '[ copied ]' : '[ copy result ]'}
      </button>
      <p className="mt-2 text-term-xs text-term-muted" role="status">
        {state === 'copied'
          ? 'Copied. It names no grades, so it spoils nothing.'
          : state === 'failed'
            ? 'Your browser blocked the clipboard. Nothing was sent anywhere.'
            : 'Copies a spoiler safe summary. Nothing is sent anywhere.'}
      </p>
    </div>
  );
}
