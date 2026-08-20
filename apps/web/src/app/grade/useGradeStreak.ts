'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The visitor's play history (AC-7).
 *
 * This lives in localStorage and NOWHERE else. It is never sent to the api,
 * never put in a URL, and has no server counterpart — the server's only
 * record of a play is an anonymous integer in the day's histogram, which
 * cannot be tied back to anyone. Do not add a sync call here.
 */
export const STREAK_STORAGE_KEY = 'tc-grade-streak';

export type GradeStreak = {
  /** Consecutive UTC days played, counting today. */
  streak: number;
  /** The longest run this browser has ever managed. */
  bestStreak: number;
  /** UTC `YYYY-MM-DD` of the last counted play, or null if never played. */
  lastPlayedDate: string | null;
  /** Exact hits, i.e. guesses that matched the true grade. */
  wins: number;
  /** Plays that missed. wins + losses is the total counted plays. */
  losses: number;
};

export const EMPTY_STREAK: GradeStreak = {
  streak: 0,
  bestStreak: 0,
  lastPlayedDate: null,
  wins: 0,
  losses: 0
};

function isStreak(value: unknown): value is GradeStreak {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.streak === 'number' &&
    typeof v.bestStreak === 'number' &&
    typeof v.wins === 'number' &&
    typeof v.losses === 'number' &&
    (typeof v.lastPlayedDate === 'string' || v.lastPlayedDate === null)
  );
}

export function readStreak(): GradeStreak {
  try {
    const raw = window.localStorage.getItem(STREAK_STORAGE_KEY);
    if (!raw) return EMPTY_STREAK;
    const parsed: unknown = JSON.parse(raw);
    return isStreak(parsed) ? parsed : EMPTY_STREAK;
  } catch {
    // Private browsing, a disabled store, or a corrupt value: the game is
    // fully playable without history, so this is never surfaced as an error.
    return EMPTY_STREAK;
  }
}

/** The UTC date one day before the given `YYYY-MM-DD`. */
export function previousUtcDate(date: string): string {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(time - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Fold one finished play into the stored history.
 *
 * Pure and exported so the rules are testable without a browser. Replaying
 * the same UTC day is a no-op: the spec accepts that an incognito replay
 * double-counts the anonymous histogram, but a visitor must not be able to
 * inflate their own streak by reloading.
 */
export function applyPlay(
  previous: GradeStreak,
  params: { date: string; won: boolean }
): GradeStreak {
  if (previous.lastPlayedDate === params.date) return previous;

  const continued = previous.lastPlayedDate === previousUtcDate(params.date);
  const streak = continued ? previous.streak + 1 : 1;

  return {
    streak,
    bestStreak: Math.max(previous.bestStreak, streak),
    lastPlayedDate: params.date,
    wins: previous.wins + (params.won ? 1 : 0),
    losses: previous.losses + (params.won ? 0 : 1)
  };
}

/**
 * Reads the stored history after mount (never during render, so the server
 * and first client paint agree) and hands back a recorder for the reveal.
 */
export function useGradeStreak() {
  const [streak, setStreak] = useState<GradeStreak>(EMPTY_STREAK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setStreak(readStreak());
    setLoaded(true);
  }, []);

  const recordPlay = useCallback((params: { date: string; won: boolean }) => {
    setStreak((previous) => {
      const next = applyPlay(previous, params);
      if (next !== previous) {
        try {
          window.localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Store unavailable: keep the in-memory value for this session.
        }
      }
      return next;
    });
  }, []);

  return { streak, loaded, recordPlay };
}
