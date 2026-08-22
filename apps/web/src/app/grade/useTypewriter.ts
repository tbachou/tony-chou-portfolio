'use client';

import { useEffect, useState } from 'react';

/** Characters per tick and the tick interval: fast enough to read, not to wait. */
const CHARS_PER_TICK = 2;
const TICK_MS = 16;

/**
 * Reveal text a few characters at a time, the way a terminal prints it.
 *
 * `design.md` calls for motion that is fast and a little harsh, so this types
 * briskly rather than dramatically.
 *
 * Two rules make it safe rather than merely decorative:
 *
 * 1. Under `prefers-reduced-motion` the full text is returned immediately. The
 *    animation is pure decoration and some visitors get motion sickness from
 *    it, so it is skipped outright rather than shortened.
 * 2. The full text is always in the DOM for assistive technology; only the
 *    VISIBLE slice animates. A screen reader reading a string that grows two
 *    characters at a time would be unusable, so the caller renders the whole
 *    string for readers and marks the animated copy `aria-hidden`.
 */
export function useTypewriter(text: string): { visible: string; done: boolean } {
  const [count, setCount] = useState(0);
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    // Read after mount, not during render, so server and client first paint agree.
    setSkip(
      typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }, []);

  useEffect(() => {
    setCount(0);
  }, [text]);

  useEffect(() => {
    if (skip || count >= text.length) return;
    const timer = window.setTimeout(
      () => setCount((c) => Math.min(c + CHARS_PER_TICK, text.length)),
      TICK_MS
    );
    return () => window.clearTimeout(timer);
  }, [count, text, skip]);

  if (skip) return { visible: text, done: true };
  return { visible: text.slice(0, count), done: count >= text.length };
}
