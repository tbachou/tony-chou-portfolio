'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchToday,
  submitGuess,
  GradeRequestError,
  type GradeReveal,
  type GradeToday
} from '@/lib/grade-api';
import { GuessPad } from './GuessPad';
import { RevealPanel } from './RevealPanel';
import { useGradeStreak } from './useGradeStreak';

/**
 * Grade Guesser, the whole game (spec 0006).
 *
 * SELF-CONTAINED BY CONTRACT (AC-10). This tree imports nothing from the
 * portfolio's terminal shell — no TerminalWindow, no SiteNav, no page
 * chrome — and paints only through the design system's CSS custom properties
 * (the `term.*` Tailwind colours resolve to `var(--color-*)`). A future
 * climbing-branded host can therefore mount <GradeGame /> inside its own
 * chrome and restyle it by redefining those variables, with no rebuild of
 * anything in here. Keep it that way: if this file ever needs something from
 * the portfolio's layout, take it as a prop instead.
 */

type Phase = 'loading' | 'ready' | 'guessing' | 'revealed' | 'error';

const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the game server. Check your connection and try again.";

const RATE_LIMITED_FALLBACK =
  "You've been playing fast. Give it a minute and try again.";

/**
 * The api refused the guess because the UTC day rolled over between the page
 * loading and the guess landing (AC-19). The guess never counted, so the fix
 * is to pull the new day and let them play it.
 */
const DAY_ROLLED_OVER_MESSAGE =
  "A new day started while you were looking. Here's today's problem.";

export function GradeGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [today, setToday] = useState<GradeToday | null>(null);
  const [reveal, setReveal] = useState<GradeReveal | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const { streak, recordPlay } = useGradeStreak();

  /**
   * Fetch the day.
   *
   * `notice` is applied AFTER the fetch succeeds, never before: this function
   * clears the message on entry, so a caller that set one first would have it
   * wiped and the visitor would be left with no explanation for what happened.
   */
  const load = useCallback(async (notice?: string) => {
    setPhase('loading');
    setErrorMessage(null);
    try {
      setToday(await fetchToday());
      setPhase('ready');
      if (notice) setErrorMessage(notice);
    } catch (error) {
      setErrorMessage(
        error instanceof GradeRequestError ? error.message : NETWORK_ERROR_MESSAGE
      );
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGuess = useCallback(
    async (grade: number) => {
      // Checked before any state moves: bailing after setPhase('guessing')
      // would strand the UI in a state nothing clears.
      if (!today) return;

      setPending(grade);
      setPhase('guessing');
      setErrorMessage(null);

      try {
        const result = await submitGuess(grade, today.date);
        setReveal(result);
        // The streak is recorded from the reveal's own date, so a play that
        // straddles UTC midnight counts for the day the server scored.
        recordPlay({ date: result.date, won: result.yourDistance === 0 });
        setPhase('revealed');
      } catch (error) {
        if (error instanceof GradeRequestError && error.status === 409) {
          // Midnight UTC passed mid-play. Reload rather than reporting a
          // failure: the photo, the date and the answer have all moved on, and
          // re-submitting against the stale date would only be refused again.
          setPending(null);
          await load(DAY_ROLLED_OVER_MESSAGE);
          return;
        }
        if (error instanceof GradeRequestError) {
          setErrorMessage(error.status === 429 ? RATE_LIMITED_FALLBACK : error.message);
        } else {
          setErrorMessage(NETWORK_ERROR_MESSAGE);
        }
        // Back to a playable state: the guess never counted, so let them retry.
        setPhase('ready');
      } finally {
        setPending(null);
      }
    },
    [recordPlay, today, load]
  );

  return (
    <div className="grade-game">
      <header>
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          ./grade-guesser --today
        </p>
        <h1 className="mt-4 text-term-3xl font-bold text-term-ink terminal-glow sm:text-term-4xl">
          Grade Guesser
        </h1>
        <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
          One boulder problem a day. Read the wall, call the grade, then see how you did against
          the gym&apos;s answer, against everyone else who played, and against Claude&apos;s own
          look at the same photo.
        </p>
        {today && (
          <p className="mt-3 text-term-xs uppercase tracking-wide text-term-muted">
            {today.date} · drawn from a {today.poolSize}-problem pool · resets at midnight UTC
          </p>
        )}
      </header>

      {phase === 'loading' && (
        <p className="mt-10 text-term-base text-term-muted" role="status">
          <span aria-hidden="true">$ </span>
          loading today&apos;s problem
          <span className="terminal-cursor" aria-hidden="true">
            _
          </span>
        </p>
      )}

      {phase === 'error' && (
        <div className="mt-10 border border-term-border p-5" role="alert">
          <p className="text-term-base text-term-error">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 min-h-[44px] text-term-base font-bold text-term-ink transition-colors duration-term-instant hover:text-term-accent"
          >
            [ try again ]
          </button>
        </div>
      )}

      {today && phase !== 'error' && phase !== 'loading' && (
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <figure className="m-0">
            <div className="border border-term-border">
              {imageFailed ? (
                <div className="flex aspect-[3/4] items-center justify-center p-6 text-center text-term-sm text-term-muted">
                  Today&apos;s photo could not be loaded. The guess buttons still work — but you
                  will be calling it blind.
                </div>
              ) : (
                // Plain <img>: the src is a presigned S3 URL that carries a
                // signature and expires in an hour, so it differs on every load.
                // next/image would need a remote-pattern allowlist for a bucket
                // it cannot read, and would have nothing stable to cache.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={today.imageUrl}
                  alt="Today's boulder problem. Guess its V grade from the holds and the wall angle."
                  className="block h-auto w-full"
                  onError={() => setImageFailed(true)}
                />
              )}
            </div>
            <figcaption className="mt-2 text-term-xs text-term-muted">
              {phase === 'revealed' && reveal?.note
                ? reveal.note
                : 'Shot by Tony. The grade is the gym’s own.'}
            </figcaption>
          </figure>

          <div>
            {phase === 'revealed' && reveal ? (
              <RevealPanel reveal={reveal} streak={streak} />
            ) : (
              <>
                <GuessPad
                  onGuess={(grade) => void handleGuess(grade)}
                  disabled={phase === 'guessing'}
                  pending={pending}
                />
                {phase === 'guessing' && (
                  <p className="mt-4 text-term-sm text-term-muted" role="status">
                    <span aria-hidden="true">$ </span>
                    scoring your guess
                    <span className="terminal-cursor" aria-hidden="true">
                      _
                    </span>
                  </p>
                )}
                {errorMessage && (
                  <p className="mt-4 text-term-sm text-term-error" role="alert">
                    {errorMessage}
                  </p>
                )}
                {streak.streak > 0 && (
                  <p className="mt-6 border-t border-term-border pt-4 text-term-xs text-term-muted">
                    Current streak: {streak.streak} day{streak.streak === 1 ? '' : 's'} · best{' '}
                    {streak.bestStreak}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
