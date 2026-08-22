'use client';

import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  GRADE_PHOTO_SOURCES,
  MAX_UPLOAD_BYTES,
  SOURCE_LABELS,
  uploadGradePhoto,
  type GradePhoto
} from '@/lib/grade-photos-api';

const GRADES = Array.from({ length: 9 }, (_, i) => i);

/** The api's own rule, mirrored so the field can reject before a round trip. */
const SLUG_PATTERN = '[a-z0-9][a-z0-9-]{2,63}';

/**
 * z.custom rather than z.instanceof(FileList): this module is evaluated on
 * the server during prerender, where FileList does not exist, and
 * z.instanceof would dereference it at module scope. Inside the predicate
 * the reference is only reached in the browser.
 */
const fileListSchema = z.custom<FileList>(
  (value) => typeof FileList !== 'undefined' && value instanceof FileList
);

const uploadSchema = z.object({
  file: fileListSchema
    .refine((list) => list.length > 0, 'Choose an image first.')
    // Checked here as well as by the api so an oversized file fails
    // instantly instead of after a 10 MB upload the server was always
    // going to refuse.
    .refine((list) => !list[0] || list[0].size <= MAX_UPLOAD_BYTES, {
      // Names the actual size: "over the limit" alone leaves the admin
      // guessing how much to shrink it by.
      error: (issue) =>
        `That image is ${formatBytes(
          (issue.input as FileList)[0]?.size ?? 0
        )}, over the 10 MB limit.`
    }),
  id: z
    .string()
    .regex(
      new RegExp(`^${SLUG_PATTERN}$`),
      'Use lowercase letters, digits and hyphens, 3 to 64 characters.'
    ),
  trueGrade: z.number().int().min(0).max(8),
  source: z.enum(GRADE_PHOTO_SOURCES),
  sourceNote: z.string().max(500),
  note: z.string().max(200)
});

type UploadValues = z.infer<typeof uploadSchema>;

interface GradePhotoUploadFormProps {
  onUploaded: (photo: GradePhoto) => void;
}

export function GradePhotoUploadForm({ onUploaded }: GradePhotoUploadFormProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<UploadValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      id: '',
      trueGrade: 4,
      source: 'own_photo',
      sourceNote: '',
      note: ''
    }
  });

  const fileId = useId();
  const slugId = useId();
  const gradeId = useId();
  const sourceId = useId();
  const sourceNoteId = useId();
  const noteId = useId();
  const errorId = useId();

  // Both drive rendering rather than the request, so they have to be
  // subscribed to: the chosen file's name and size, and the provenance
  // warning. useWatch rather than watch(), which returns a function React
  // Compiler cannot memoize safely.
  const fileList = useWatch({ control, name: 'file' });
  const file = fileList?.[0] ?? null;
  const source = useWatch({ control, name: 'source' });

  const formError = errors.root?.message;
  // One line carries whichever field failed, matching the single error slot
  // this form has always had above the button.
  const fieldError =
    errors.file?.message ??
    errors.id?.message ??
    errors.trueGrade?.message ??
    errors.source?.message ??
    errors.sourceNote?.message ??
    errors.note?.message;
  const shownError = fieldError ?? formError;

  async function onSubmit(values: UploadValues) {
    try {
      const created = await uploadGradePhoto({
        file: values.file[0],
        id: values.id,
        trueGrade: values.trueGrade,
        source: values.source,
        sourceNote: values.sourceNote.trim() || undefined,
        note: values.note.trim() || undefined
      });
      onUploaded(created);
      reset();
    } catch (uploadError) {
      setError('root', {
        message:
          uploadError instanceof Error
            ? uploadError.message
            : 'The upload failed. Try again.'
      });
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

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-5"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-term-sm text-term-muted">
            image: <span className="text-term-xs">(jpeg, png or webp, max 10 MB)</span>
          </label>
          <input
            id={fileId}
            type="file"
            accept="image/*"
            disabled={isSubmitting}
            aria-invalid={errors.file ? true : undefined}
            className="border border-term-border bg-term-surface px-3 py-2 text-term-sm text-term-body file:mr-3 file:border file:border-term-border file:bg-transparent file:px-2 file:py-1 file:text-term-sm file:text-term-ink disabled:cursor-not-allowed disabled:opacity-60"
            {...register('file')}
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
              type="text"
              pattern={SLUG_PATTERN}
              disabled={isSubmitting}
              aria-invalid={errors.id ? true : undefined}
              placeholder="north-gym-blue-prow"
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
              {...register('id')}
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
              disabled={isSubmitting}
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
              {...register('trueGrade', { valueAsNumber: true })}
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
            disabled={isSubmitting}
            className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
            {...register('source')}
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
              type="text"
              maxLength={500}
              disabled={isSubmitting}
              placeholder="shot on my phone, 2026-08"
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
              {...register('sourceNote')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-term-sm text-term-muted">
              note: <span className="text-term-xs">(optional, shown after the reveal)</span>
            </label>
            <input
              id={noteId}
              type="text"
              maxLength={200}
              disabled={isSubmitting}
              placeholder="North wall, blue circuit"
              className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
              {...register('note')}
            />
            <p className="text-term-xs text-term-muted">
              never a grade hint — visitors see it after they guess.
            </p>
          </div>
        </div>

        {shownError ? (
          <p id={errorId} role="alert" className="text-term-sm text-term-error">
            <span aria-hidden="true">!! </span>
            {shownError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          aria-describedby={shownError ? errorId : undefined}
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
