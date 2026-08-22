'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GradeReveal } from '@/lib/grade-api';

/**
 * The visitor's progress through the set (AC-24) and their saved reveals
 * (AC-26).
 *
 * This lives in localStorage and NOWHERE else. It is never sent to the api,
 * never put in a URL, and has no server counterpart — the server's only record
 * of a play is an anonymous integer in that problem's histogram, which cannot
 * be tied back to anyone. Do not add a sync call here.
 *
 * Replaced the streak on 2026-08-22. A streak counted consecutive days and
 * there are no days any more; progress through a fixed set is what replaced it.
 *
 * Caching the reveal is what makes a refresh non destructive. Without it the
 * only way back to Claude's analysis would be to guess again, which would count
 * a second time in the histogram. It is safe to store because a reveal is
 * server generated content, not anything the visitor typed, so the data
 * boundary is untouched. There is deliberately no server route that returns a
 * reveal without a guess: it would have to be unauthenticated, and would hand
 * the answer to anyone who called it (AC-2).
 */
export const PROGRESS_STORAGE_KEY = 'tc-grade-progress';

/** Bumped when the stored shape changes, so an old value is dropped not parsed. */
export const PROGRESS_VERSION = 1;

export type GradeProgress = {
  version: number;
  /** Reveals already seen, keyed by public id. The keys ARE the read markers. */
  revealed: Record<string, GradeReveal>;
};

export const EMPTY_PROGRESS: GradeProgress = { version: PROGRESS_VERSION, revealed: {} };

function isReveal(value: unknown): value is GradeReveal {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.publicId === 'string' &&
    typeof v.trueGrade === 'number' &&
    typeof v.yourGuess === 'number' &&
    typeof v.yourDistance === 'number' &&
    Array.isArray(v.guessCounts) &&
    typeof v.plays === 'number'
  );
}

/**
 * Parse stored progress, discarding anything that does not match.
 *
 * Deliberately strict per entry rather than all or nothing: one corrupt reveal
 * should cost that problem's saved copy, not the visitor's whole history.
 */
export function parseProgress(raw: string | null): GradeProgress {
  if (!raw) return EMPTY_PROGRESS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_PROGRESS;
    const value = parsed as Record<string, unknown>;
    if (value.version !== PROGRESS_VERSION) return EMPTY_PROGRESS;
    const revealed: Record<string, GradeReveal> = {};
    for (const [id, entry] of Object.entries(value.revealed ?? {})) {
      if (isReveal(entry)) revealed[id] = entry;
    }
    return { version: PROGRESS_VERSION, revealed };
  } catch {
    // Private browsing, a disabled store, or a corrupt value: the game is fully
    // playable without history, so this is never surfaced as an error.
    return EMPTY_PROGRESS;
  }
}

/** Fold one finished play into the stored progress. Pure, so it is testable. */
export function applyReveal(previous: GradeProgress, reveal: GradeReveal): GradeProgress {
  return {
    version: PROGRESS_VERSION,
    revealed: { ...previous.revealed, [reveal.publicId]: reveal }
  };
}

/**
 * How many of the CURRENT set the visitor has read.
 *
 * Intersected with the live set rather than counting stored keys, so a marker
 * left over from a problem the owner has since retired cannot report "9 of 8".
 */
export function countRead(progress: GradeProgress, problemIds: string[]): number {
  return problemIds.filter((id) => id in progress.revealed).length;
}

/**
 * Which problem to open on: the first unread one, else the first in the set.
 *
 * Falls out of the markers rather than needing its own stored cursor, so there
 * is one piece of state to keep honest instead of two.
 */
export function firstUnreadIndex(progress: GradeProgress, problemIds: string[]): number {
  const index = problemIds.findIndex((id) => !(id in progress.revealed));
  return index === -1 ? 0 : index;
}

/**
 * Reads stored progress after mount (never during render, so the server and
 * the first client paint agree) and hands back a recorder.
 */
export function useGradeProgress() {
  const [progress, setProgress] = useState<GradeProgress>(EMPTY_PROGRESS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setProgress(parseProgress(window.localStorage.getItem(PROGRESS_STORAGE_KEY)));
    } catch {
      setProgress(EMPTY_PROGRESS);
    }
    setLoaded(true);
  }, []);

  const recordReveal = useCallback((reveal: GradeReveal) => {
    setProgress((previous) => {
      const next = applyReveal(previous, reveal);
      try {
        window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Store unavailable or full: keep the in-memory value for this session.
      }
      return next;
    });
  }, []);

  return { progress, loaded, recordReveal };
}
