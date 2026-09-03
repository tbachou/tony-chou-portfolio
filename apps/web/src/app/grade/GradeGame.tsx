'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchProblems,
  fetchProblemImage,
  submitGuess,
  GradeRequestError,
  type GradeProblemList,
  type GradeReveal
} from '@/lib/grade-api';
import { GuessPad } from './GuessPad';
import { RevealPanel } from './RevealPanel';
import {
  countRead,
  firstUnreadIndex,
  useGradeProgress,
  type GradeProgress
} from './useGradeProgress';

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
 *
 * R7 rebuilt this for the fixed set. It shows ONE problem at a time with a
 * control to move through them (AC-25), because the alternative — the whole
 * set as a list — would mint a presigned URL per problem on load and let a
 * visitor see ten photos they have not earned.
 */

type Phase = 'loading' | 'ready' | 'guessing' | 'error';

const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the game server. Check your connection and try again.";

const RATE_LIMITED_FALLBACK =
  "You've been playing fast. Give it a minute and try again.";

/** The first guess on a problem pays for its vision call, and that takes a while. */
const STUDYING_MESSAGE = 'Claude is studying the problem';

export function GradeGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [list, setList] = useState<GradeProblemList | null>(null);
  const [index, setIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [liveReveal, setLiveReveal] = useState<GradeReveal | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { progress, loaded: progressLoaded, recordReveal } = useGradeProgress();

  // Memoised so the array identity is stable across renders. Without this the
  // `?? []` fallback mints a new array every render, and any effect depending
  // on it re-runs every render.
  const problems = useMemo(() => list?.problems ?? [], [list]);
  const problemIds = useMemo(() => problems.map((p) => p.publicId), [problems]);
  const current = problems[index] ?? null;
  const publicId = current?.publicId ?? null;

  // The saved copy wins over the live one only when there is no live one: a
  // guess just made must show its own fresh counts, not the older stored pair.
  const cached = publicId ? progress.revealed[publicId] : undefined;
  const reveal = liveReveal ?? cached ?? null;
  const fromCache = liveReveal === null && cached !== undefined;

  const readCount = countRead(progress, problemIds);

  /** Load the set. Runs once; the set does not change under a visitor. */
  const loadSet = useCallback(async () => {
    setPhase('loading');
    setErrorMessage(null);
    try {
      setList(await fetchProblems());
      setPhase('ready');
    } catch (error) {
      setErrorMessage(
        error instanceof GradeRequestError ? error.message : NETWORK_ERROR_MESSAGE
      );
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void loadSet();
  }, [loadSet]);

  /**
   * Open on the first problem the visitor has not read (AC-24's marker doing
   * double duty). Waits for BOTH the set and the stored progress, because
   * running before progress loads would always compute index 0 and drop the
   * visitor back at the start of a set they were part way through.
   */
  const [startingIndexApplied, setStartingIndexApplied] = useState(false);
  useEffect(() => {
    if (startingIndexApplied || !progressLoaded || problemIds.length === 0) return;
    setIndex(firstUnreadIndex(progress, problemIds));
    setStartingIndexApplied(true);
  }, [startingIndexApplied, progressLoaded, problemIds, progress]);

  /**
   * Mint this problem's image when it goes on screen (AC-25).
   *
   * Per problem rather than per set, so a visitor who reads two problems mints
   * two URLs, and so a one hour presign cannot expire under a long sitting.
   */
  useEffect(() => {
    if (!publicId) return;
    let cancelled = false;
    setImageUrl(null);
    setImageError(null);

    void (async () => {
      try {
        const { imageUrl: url } = await fetchProblemImage(publicId);
        if (!cancelled) setImageUrl(url);
      } catch (error) {
        if (cancelled) return;
        setImageError(
          error instanceof GradeRequestError
            ? error.message
            : "Couldn't load this problem's photo."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicId]);

  /** Moving between problems clears the live reveal; the saved copy takes over. */
  const goTo = useCallback((next: number) => {
    setIndex(next);
    setLiveReveal(null);
    setErrorMessage(null);
  }, []);

  const handleGuess = useCallback(
    async (grade: number) => {
      if (!publicId) return;

      setPending(grade);
      setPhase('guessing');
      setErrorMessage(null);

      try {
        const result = await submitGuess(grade, publicId);
        setLiveReveal(result);
        recordReveal(result);
        setPhase('ready');
      } catch (error) {
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
    [publicId, recordReveal]
  );

  return (
    <div className="grade-game">
      <header>
        <p className="text-term-sm text-term-muted">
          <span aria-hidden="true">$ </span>
          ./grade-guesser
        </p>
        <h1 className="mt-4 text-term-3xl font-bold text-term-ink terminal-glow sm:text-term-4xl">
          Grade Guesser
        </h1>
        <p className="mt-2 max-w-[70ch] text-term-base leading-relaxed text-term-body">
          A set of real boulder problems. Read the wall, call the grade, then see how you did
          against the gym&apos;s answer, against everyone else who played, and against
          Claude&apos;s own look at the same photo.
        </p>
        {problems.length > 0 && (
          <p className="mt-3 text-term-xs uppercase tracking-wide text-term-muted">
            {readCount} of {problems.length} read
          </p>
        )}
      </header>

      {phase === 'loading' && (
        <p className="mt-10 text-term-base text-term-muted" role="status">
          <span aria-hidden="true">$ </span>
          loading the problem set
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
            onClick={() => void loadSet()}
            className="mt-4 min-h-[44px] text-term-base font-bold text-term-ink terminal-select transition-colors duration-term-instant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-term-accent"
          >
            [ try again ]
          </button>
        </div>
      )}

      {/* An empty set is the owner not having uploaded yet, not a fault. It gets
          real copy rather than a spinner that never resolves or a bare error. */}
      {phase !== 'loading' && phase !== 'error' && problems.length === 0 && (
        <div className="mt-10 border border-term-border p-6">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            ls problems/
          </p>
          <p className="mt-3 max-w-[70ch] text-term-base leading-relaxed text-term-body">
            No problems in the set yet. The pool is photographed and graded by hand, one wall at a
            time, so it starts empty rather than with filler.
          </p>
          <p className="mt-3 max-w-[70ch] text-term-sm leading-relaxed text-term-muted">
            Check back once the first set is up.
          </p>
        </div>
      )}

      {problems.length > 0 && phase !== 'loading' && phase !== 'error' && (
        <>
          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
            <figure className="m-0">
              <figcaption className="mb-2 text-term-xs uppercase tracking-wide text-term-muted">
                problem {index + 1} of {problems.length}
                {cached && <span> · read</span>}
              </figcaption>
              <div className="border border-term-border">
                {imageError ? (
                  <div className="flex aspect-[3/4] items-center justify-center p-6 text-center text-term-sm text-term-muted">
                    {imageError} The guess buttons still work, but you would be calling it blind.
                  </div>
                ) : imageUrl === null ? (
                  <div
                    className="flex aspect-[3/4] items-center justify-center p-6 text-center text-term-sm text-term-muted"
                    role="status"
                  >
                    <span aria-hidden="true">$ </span>
                    loading photo
                    <span className="terminal-cursor" aria-hidden="true">
                      _
                    </span>
                  </div>
                ) : (
                  // Plain <img>: the src is a presigned S3 URL that carries a
                  // signature and expires in an hour, so it differs on every load.
                  // next/image would need a remote-pattern allowlist for a bucket
                  // it cannot read, and would have nothing stable to cache.
                  // Capped and centred rather than plain `w-full`: a tall
                  // portrait shot otherwise runs far past the column beside it
                  // and strands the guess pad in dead space.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt={`Boulder problem ${index + 1} of ${problems.length}. Guess its V grade from the holds and the wall angle.`}
                    className="mx-auto block h-auto max-h-[560px] w-auto max-w-full"
                    onError={() => setImageError("This problem's photo could not be loaded.")}
                  />
                )}
              </div>
              {reveal?.note && (
                <p className="mt-2 text-term-xs text-term-muted">{reveal.note}</p>
              )}
            </figure>

            <div>
              {reveal ? (
                <RevealPanel
                  reveal={reveal}
                  position={index + 1}
                  total={problems.length}
                  fromCache={fromCache}
                />
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
                      {STUDYING_MESSAGE}
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

                  {/* Supporting content, not filler: the pad is nine buttons
                      and a line of text, which leaves the column stranded
                      beside a portrait photo. This says what the scale IS,
                      which a non-climber needs and which gives away nothing
                      about THIS problem. */}
                  <section className="mt-8 border-t border-term-border pt-5">
                    <h2 className="text-term-sm text-term-muted">
                      <span aria-hidden="true">$ </span>
                      man v-scale
                    </h2>
                    <dl className="mt-3 space-y-2 text-term-sm leading-relaxed">
                      <div>
                        <dt className="inline font-bold text-term-ink">V0–V2 </dt>
                        <dd className="inline text-term-body">
                          big holds, mostly upright walls. Where most people start.
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-bold text-term-ink">V3–V5 </dt>
                        <dd className="inline text-term-body">
                          smaller holds, steeper ground, real body tension.
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-bold text-term-ink">V6+ </dt>
                        <dd className="inline text-term-body">
                          tiny holds, severe angles, moves most climbers cannot do.
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-term-xs leading-relaxed text-term-muted">
                      Grades are one gym&apos;s opinion, not a measurement. Being a grade off is
                      normal, and disagreeing is most of the fun.
                    </p>
                  </section>
                </>
              )}
            </div>
          </div>

          <nav
            aria-label="Problem set"
            className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-term-border pt-6"
          >
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="min-h-[44px] text-term-base font-bold text-term-ink terminal-select transition-colors duration-term-instant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-term-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              [ ← previous ]
            </button>
            <p className="text-term-xs uppercase tracking-wide text-term-muted">
              {readCount} of {problems.length} read
            </p>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={index >= problems.length - 1}
              className="min-h-[44px] text-term-base font-bold text-term-ink terminal-select transition-colors duration-term-instant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-term-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              [ next problem → ]
            </button>
          </nav>

          <p className="mt-6 max-w-[70ch] text-term-xs leading-relaxed text-term-muted">
            Your progress and your saved reveals live in this browser only. They are never sent
            anywhere, so clearing site data resets them and a different device starts fresh. The
            server keeps an anonymous count per grade and nothing else.
          </p>
        </>
      )}
    </div>
  );
}

/** Re-exported so the progress type is reachable from tests without the hook. */
export type { GradeProgress };
