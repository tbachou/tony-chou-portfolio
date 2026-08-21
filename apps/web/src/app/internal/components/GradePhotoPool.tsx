'use client';

import { useState } from 'react';
import {
  setGradePhotoActive,
  SOURCE_LABELS,
  type GradePhoto
} from '@/lib/grade-photos-api';

interface GradePhotoPoolProps {
  photos: GradePhoto[];
  onChanged: (photo: GradePhoto) => void;
}

export function GradePhotoPool({ photos, onChanged }: GradePhotoPoolProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(photo: GradePhoto) {
    setPendingId(photo.id);
    setError(null);
    try {
      onChanged(await setGradePhotoActive(photo.id, !photo.active));
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : 'That change could not be saved.'
      );
    } finally {
      setPendingId(null);
    }
  }

  if (photos.length === 0) {
    return (
      <section className="mt-10" aria-labelledby="pool-heading">
        <h2 id="pool-heading" className="text-term-base font-bold text-term-ink">
          <span aria-hidden="true">$ </span>
          ls pool/
        </h2>
        <div className="mt-3 border border-term-border p-6">
          <p className="text-term-sm text-term-muted">POOL IS EMPTY.</p>
          <p className="mt-2 text-term-sm text-term-body">
            The game serves 503 until at least one photo is active. Add one above — no
            deploy needed, which is the whole reason this page exists.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10" aria-labelledby="pool-heading">
      <h2 id="pool-heading" className="text-term-base font-bold text-term-ink">
        <span aria-hidden="true">$ </span>
        ls pool/
      </h2>
      <p className="mt-2 text-term-sm text-term-muted">
        Newest first. Thumbnails are the full-size objects behind one-hour presigned
        URLs, so leaving this page open past an hour shows broken images until reload.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-term-sm text-term-error">
          <span aria-hidden="true">!! </span>
          {error}
        </p>
      ) : null}

      <ul className="mt-4 flex flex-col gap-3">
        {photos.map((photo) => (
          <li
            key={photo.id}
            className={`flex flex-wrap items-start gap-4 border border-term-border p-3 sm:flex-nowrap ${
              photo.active ? '' : 'opacity-60'
            }`}
          >
            {/* Deliberately <img> rather than next/image: the src is a presigned
                S3 URL that changes on every load, so the optimizer would have
                nothing stable to cache and the remote host would need
                allow-listing for a private bucket it cannot read anyway. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.imageUrl}
              alt={`Boulder problem ${photo.id}, graded V${photo.trueGrade}`}
              className="h-20 w-28 shrink-0 border border-term-border object-cover"
              loading="lazy"
            />

            <div className="min-w-0 grow">
              <p className="truncate text-term-base text-term-ink">{photo.id}</p>
              <p className="mt-1 text-term-sm text-term-body">
                V{photo.trueGrade} · {SOURCE_LABELS[photo.source]}
                {photo.source === 'unlicensed_test' ? (
                  <span className="text-term-error"> · excluded on release</span>
                ) : null}
              </p>
              {photo.note ? (
                <p className="mt-1 truncate text-term-xs text-term-muted">
                  note: {photo.note}
                </p>
              ) : null}
              {photo.sourceNote ? (
                <p className="mt-0.5 truncate text-term-xs text-term-muted">
                  source: {photo.sourceNote}
                </p>
              ) : null}
              <p className="mt-1 text-term-xs text-term-muted">
                added <time dateTime={photo.createdAt}>{photo.createdAt.slice(0, 10)}</time>
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={`text-term-xs ${
                  photo.active ? 'text-term-ink' : 'text-term-muted'
                }`}
              >
                {photo.active ? 'ACTIVE' : 'INACTIVE'}
              </span>
              <button
                type="button"
                onClick={() => void toggle(photo)}
                disabled={pendingId === photo.id}
                className="border border-term-border px-3 py-1 text-term-sm text-term-ink transition-colors duration-term-instant hover:border-term-accent focus-visible:border-term-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingId === photo.id
                  ? '[ SAVING ]'
                  : photo.active
                    ? '[ DEACTIVATE ]'
                    : '[ REACTIVATE ]'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-term-xs text-term-muted">
        Photos are never deleted, only deactivated — every past day keeps pointing at the
        problem it was actually played with.
      </p>
    </section>
  );
}
