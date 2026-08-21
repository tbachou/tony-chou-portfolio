'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { signOut } from '@/lib/auth-client';
import { fetchGradePhotos, type GradePhoto } from '@/lib/grade-photos-api';
import { GradePhotoPool } from './GradePhotoPool';
import { GradePhotoUploadForm } from './GradePhotoUploadForm';

/** The pool the release checklist asks for: 10 or more, spanning V0 to V8. */
const TARGET_POOL_SIZE = 10;
const GRADES = Array.from({ length: 9 }, (_, i) => i);

interface GradePhotoAdminProps {
  email: string;
}

export function GradePhotoAdmin({ email }: GradePhotoAdminProps) {
  const [photos, setPhotos] = useState<GradePhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchGradePhotos()
      .then((data) => {
        if (!cancelled) setPhotos(data);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : 'Could not load the photo pool.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUploaded = useCallback((photo: GradePhoto) => {
    setPhotos((current) => [photo, ...(current ?? [])]);
  }, []);

  const handleChanged = useCallback((photo: GradePhoto) => {
    setPhotos((current) =>
      (current ?? []).map((existing) =>
        existing.id === photo.id ? photo : existing
      )
    );
  }, []);

  /**
   * What the release checklist actually needs to see (spec 0006 R8): how many
   * photos the game would really draw from, and whether the grade range is
   * covered. "Eligible" is narrower than "active" on purpose — an
   * unlicensed_test photo is active but is refused once the game is live, so
   * counting it here would report a pool that does not exist at release.
   */
  const health = useMemo(() => {
    const all = photos ?? [];
    const active = all.filter((p) => p.active);
    const eligible = active.filter((p) => p.source !== 'unlicensed_test');
    const covered = new Set(eligible.map((p) => p.trueGrade));
    return {
      total: all.length,
      active: active.length,
      eligible: eligible.length,
      blockedOnRelease: active.length - eligible.length,
      missingGrades: GRADES.filter((g) => !covered.has(g))
    };
  }, [photos]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-term-border pb-4">
        <div>
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            grade-photo-pool --user {email}
          </p>
          <h1 className="mt-1 text-term-xl font-bold text-term-ink terminal-glow">
            PHOTO POOL
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="border border-term-border px-3 py-1.5 text-term-sm text-term-muted transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent focus-visible:border-term-accent"
        >
          [ SIGN OUT ]
        </button>
      </div>

      <p className="mt-4 text-term-sm text-term-body">
        The daily problem for Grade Guesser is drawn from these rows. Adding one takes
        effect immediately — no commit, no deploy. Photos live in a private S3 bucket
        and are never served from the site itself.
      </p>

      {isLoading ? (
        <p
          className="mt-8 text-term-sm text-term-muted"
          role="status"
          aria-live="polite"
        >
          LOADING PHOTO POOL<span className="terminal-cursor" aria-hidden="true" />
        </p>
      ) : error ? (
        <p className="mt-8 text-term-sm text-term-error" role="alert">
          <span aria-hidden="true">!! </span>
          {error}
        </p>
      ) : (
        <>
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">IN POOL</dt>
              <dd className="mt-1 text-term-lg text-term-ink">{health.total}</dd>
            </div>
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">ACTIVE</dt>
              <dd className="mt-1 text-term-lg text-term-ink">{health.active}</dd>
            </div>
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">PLAYABLE ON RELEASE</dt>
              <dd
                className={`mt-1 text-term-lg ${
                  health.eligible >= TARGET_POOL_SIZE
                    ? 'text-term-ink'
                    : 'text-term-muted'
                }`}
              >
                {health.eligible}
                <span className="text-term-sm text-term-muted">
                  {' '}
                  / {TARGET_POOL_SIZE}
                </span>
              </dd>
            </div>
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">CYCLE REPEATS EVERY</dt>
              <dd className="mt-1 text-term-lg text-term-ink">
                {health.eligible === 0 ? '—' : `${health.eligible}d`}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-col gap-1">
            {health.blockedOnRelease > 0 ? (
              <p className="text-term-sm text-term-muted">
                <span aria-hidden="true">· </span>
                {health.blockedOnRelease} active{' '}
                {health.blockedOnRelease === 1 ? 'photo is' : 'photos are'} marked as an
                unlicensed test image and will be excluded once the game is released.
              </p>
            ) : null}
            {health.missingGrades.length > 0 ? (
              <p className="text-term-sm text-term-muted">
                <span aria-hidden="true">· </span>
                No playable photo yet for{' '}
                {health.missingGrades.map((g) => `V${g}`).join(', ')}. The game works
                without full coverage; it just guesses from a narrower range.
              </p>
            ) : (
              <p className="text-term-sm text-term-muted">
                <span aria-hidden="true">· </span>
                Every grade from V0 to V8 has at least one playable photo.
              </p>
            )}
          </div>

          <GradePhotoUploadForm onUploaded={handleUploaded} />
          <GradePhotoPool photos={photos ?? []} onChanged={handleChanged} />
        </>
      )}

      <p className="mt-10 text-term-xs text-term-muted">
        Internal tool — Tony Chou&rsquo;s portfolio backend. Not for public access.
      </p>
    </div>
  );
}
