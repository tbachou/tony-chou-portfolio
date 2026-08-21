'use client';

import { useId, useRef, useState } from 'react';
import {
  GRADE_PHOTO_SOURCES,
  MAX_UPLOAD_BYTES,
  SOURCE_LABELS,
  uploadGradePhoto,
  type GradePhoto,
  type GradePhotoSource
} from '@/lib/grade-photos-api';

const GRADES = Array.from({ length: 9 }, (_, i) => i);

/** The api's own rule, mirrored so the field can reject before a round trip. */
const SLUG_PATTERN = '[a-z0-9][a-z0-9-]{2,63}';

interface GradePhotoUploadFormProps {
  onUploaded: (photo: GradePhoto) => void;
}

export function GradePhotoUploadForm({ onUploaded }: GradePhotoUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState('');
  const [trueGrade, setTrueGrade] = useState(4);
  const [source, setSource] = useState<GradePhotoSource>('own_photo');
  const [sourceNote, setSourceNote] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const slugId = useId();
  const gradeId = useId();
  const sourceId = useId();
  const sourceNoteId = useId();
  const noteId = useId();
  const errorId = useId();

  function reset() {
    setFile(null);
    setId('');
    setTrueGrade(4);
    setSource('own_photo');
    setSourceNote('');
    setNote('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError('Choose an image first.');
      return;
    }
    // Checked here as well as by the api so an oversized file fails instantly
    // instead of after a 10 MB upload the server was always going to refuse.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That image is ${formatBytes(file.size)}, over the 10 MB limit.`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const created = await uploadGradePhoto({
        file,
        id,
        trueGrade,
        source,
        sourceNote: sourceNote.trim() || undefined,
        note: note.trim() || undefined
      });
      onUploaded(created);
      reset();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'The upload failed. Try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-10" aria-labelledby="upload-heading">
      <h2 id="upload-heading" className="text-term-base font-bold text-term-ink">
        <span aria-hidden="true">$ </span>
        upload --photo
      </h2>
      <p className="mt-2 text-term-sm text-term-body">
        Every image is re-encoded on the server: resized to 1568px on its long edge,
        converted to WebP, and stripped of EXIF. That last part matters — a phone photo
        carries GPS coordinates, and visitors get the stored file itself.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-term-sm text-term-muted">
            image: <span className="text-term-xs">(jpeg, png or webp, max 10 MB)</span>
          </label>
          <input
            ref={fileInput}
            id={fileId}
            name="file"
            type="file"
            accept="image/*"
            required
            disabled={isSubmitting}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
            className="border border-term-border bg-term-surface px-3 py-2 text-term-sm text-term-body file:mr-3 file:border file:border-term-border file:bg-transparent file:px-2 file:py-1 file:text-term-sm file:text-term-ink disabled:cursor-not-allowed disabled:opacity-60"
          />
          {file ? (
            <p className="text-term-xs text-term-muted">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={slugId} className="text-term-sm text-term-muted">
              id:
            </label>
            <input
              id={slugId}
              name="id"
              type="text"
              required
              pattern={SLUG_PATTERN}
              value={id}
              onChange={(event) => setId(event.target.value)}
              disabled={isSubmitting}
              placeholder="north-gym-blue-prow"
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-term-xs text-term-muted">
              lowercase, digits and hyphens, 3 to 64 characters. Permanent once set.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={gradeId} className="text-term-sm text-term-muted">
              true grade:
            </label>
            <select
              id={gradeId}
              name="trueGrade"
              value={trueGrade}
              onChange={(event) => setTrueGrade(Number(event.target.value))}
              disabled={isSubmitting}
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  V{grade}
                </option>
              ))}
            </select>
            <p className="text-term-xs text-term-muted">
              the gym&rsquo;s grade. Never sent to the model.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={sourceId} className="text-term-sm text-term-muted">
            source:
          </label>
          <select
            id={sourceId}
            name="source"
            value={source}
            onChange={(event) => setSource(event.target.value as GradePhotoSource)}
            disabled={isSubmitting}
            className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {GRADE_PHOTO_SOURCES.map((value) => (
              <option key={value} value={value}>
                {SOURCE_LABELS[value]}
              </option>
            ))}
          </select>
          {source === 'unlicensed_test' ? (
            <p className="text-term-xs text-term-error">
              <span aria-hidden="true">!! </span>
              Kept out of the daily cycle once the game is released, so it is safe to
              upload now and it can never go live by being forgotten.
            </p>
          ) : (
            <p className="text-term-xs text-term-muted">
              recorded so provenance is data rather than memory.
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={sourceNoteId} className="text-term-sm text-term-muted">
              source note: <span className="text-term-xs">(optional, private)</span>
            </label>
            <input
              id={sourceNoteId}
              name="sourceNote"
              type="text"
              maxLength={500}
              value={sourceNote}
              onChange={(event) => setSourceNote(event.target.value)}
              disabled={isSubmitting}
              placeholder="shot on my phone, 2026-08"
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-term-sm text-term-muted">
              note: <span className="text-term-xs">(optional, shown after the reveal)</span>
            </label>
            <input
              id={noteId}
              name="note"
              type="text"
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={isSubmitting}
              placeholder="North wall, blue circuit"
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-term-xs text-term-muted">
              never a grade hint — visitors see it after they guess.
            </p>
          </div>
        </div>

        {error ? (
          <p id={errorId} role="alert" className="text-term-sm text-term-error">
            <span aria-hidden="true">!! </span>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 self-start border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent focus-visible:border-term-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <span aria-live="polite">
              UPLOADING<span className="terminal-cursor" aria-hidden="true" />
            </span>
          ) : (
            '[ ADD PHOTO ]'
          )}
        </button>
      </form>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
