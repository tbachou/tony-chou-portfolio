'use client';

import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FeedbackRequestError,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackSource,
} from '@/lib/feedback-api';

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  feature: 'Feature request',
  other: 'Other',
};

const RATE_LIMIT_MESSAGE_FALLBACK =
  "You've hit the feedback rate limit. Please wait a bit before sending more.";

const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the feedback service. Check your connection and try again.";

const EMPTY_MESSAGE_ERROR = 'Please write a message before sending.';

const OVER_LIMIT_ERROR = `Please shorten your message to ${FEEDBACK_MESSAGE_MAX_LENGTH} characters or fewer.`;

/**
 * The length cap counts raw characters, matching both the textarea's own
 * maxLength and the counter under it; the emptiness check counts trimmed
 * ones, so whitespace alone is not a message.
 */
const feedbackSchema = z.object({
  category: z.union([z.enum(FEEDBACK_CATEGORIES), z.literal('')]),
  message: z
    .string()
    .max(FEEDBACK_MESSAGE_MAX_LENGTH, OVER_LIMIT_ERROR)
    .refine((value) => value.trim().length > 0, EMPTY_MESSAGE_ERROR),
});

type FeedbackValues = z.infer<typeof feedbackSchema>;

type FeedbackFormProps = {
  /** Which surface is hosting the form — sent verbatim to the api. */
  source: FeedbackSource;
  /** Visual language: terminal tokens/bracket-buttons, or the Beta identity. */
  variant: 'terminal' | 'beta';
  className?: string;
};

/**
 * Shared anonymous feedback form (spec 0005 child: feedback-intake).
 * No identity field exists anywhere here by design (AC-I2) — do not add
 * one without a spec change. Styling switches on `variant` since each
 * surface keeps its own visual language (design.md / AGENTS.md); the
 * behavior (validation, submit, states) is identical either way.
 */
export function FeedbackForm({ source, variant, className = '' }: FeedbackFormProps) {
  const [sent, setSent] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: { category: '', message: '' },
  });

  const messageId = useId();
  const categoryId = useId();
  const counterId = useId();
  const noticeId = useId();
  const validationId = useId();

  // Drives the live counter, so it has to be subscribed to rather than read
  // on submit like the rest of the values. useWatch rather than watch(): the
  // latter returns a function React Compiler cannot memoize safely.
  const message = useWatch({ control, name: 'message' });
  const overLimit = message.length > FEEDBACK_MESSAGE_MAX_LENGTH;

  // The api's answer, kept apart from the field error: one describes the
  // request, the other describes what was typed.
  const requestError = errors.root?.message;
  const validationError = errors.message?.message;

  // The submit button stays enabled even when the message is empty. It used
  // to be disabled on exactly that condition, and since the form is
  // noValidate nothing ever said why: a screen-reader visitor heard "Send
  // feedback, dimmed" with no stated reason and no way to provoke an error.
  // Blocking now happens in validation, which produces a real message — and
  // react-hook-form puts focus on the field that failed.
  const describedBy = [noticeId, counterId, validationError ? validationId : null]
    .filter(Boolean)
    .join(' ');

  function resetToIdle() {
    setSent(false);
    setAnnouncement('');
    reset();
  }

  async function onSubmit(values: FeedbackValues) {
    setAnnouncement('Sending your feedback.');

    try {
      await submitFeedback({
        message: values.message.trim(),
        category: values.category || undefined,
        source,
      });
      setSent(true);
      setAnnouncement('Feedback sent. Thank you.');
    } catch (error) {
      if (error instanceof FeedbackRequestError && error.status === 429) {
        setError('root', { message: error.message || RATE_LIMIT_MESSAGE_FALLBACK });
        setAnnouncement('You have reached the feedback rate limit.');
      } else if (error instanceof FeedbackRequestError) {
        setError('root', { message: error.message });
        setAnnouncement('Your feedback could not be sent. Details are on screen.');
      } else {
        setError('root', { message: NETWORK_ERROR_MESSAGE });
        setAnnouncement('Your feedback could not be sent. Details are on screen.');
      }
    }
  }

  const statusRegion = (
    <p aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (variant === 'terminal') {
    return (
      <div className={className}>
        {statusRegion}
        {sent ? (
          <div role="status" className="border border-term-border p-4 text-term-sm">
            <p className="text-term-ink">$ feedback sent — thank you.</p>
            <button
              type="button"
              onClick={resetToIdle}
              className="mt-3 text-term-sm text-term-ink underline-offset-4 hover:underline"
            >
              [ send more feedback ]
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={categoryId} className="text-term-sm text-term-muted">
                category (optional)
              </label>
              <select
                id={categoryId}
                disabled={isSubmitting}
                className="w-full max-w-xs rounded-term-sm border border-term-border bg-term-canvas px-3 py-2 text-term-sm text-term-ink focus-visible:outline-none disabled:opacity-60"
                {...register('category')}
              >
                <option value="">no category</option>
                {FEEDBACK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor={messageId} className="text-term-sm text-term-muted">
                message
              </label>
              <p id={noticeId} className="text-term-xs text-term-muted">
                Please do not include personal or medical details.
              </p>
              <textarea
                id={messageId}
                rows={4}
                maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                disabled={isSubmitting}
                aria-describedby={describedBy}
                aria-invalid={validationError ? true : undefined}
                className="w-full rounded-term-sm border border-term-border bg-term-canvas px-3 py-2 text-term-sm text-term-body transition-colors duration-term-instant focus-visible:outline-none disabled:opacity-60"
                placeholder="What's on your mind?"
                {...register('message')}
              />
              <p
                id={counterId}
                className={`text-term-xs ${overLimit ? 'text-term-error' : 'text-term-muted'}`}
              >
                {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
              </p>
              {validationError && (
                <p id={validationId} role="alert" className="text-term-sm text-term-error">
                  {validationError}
                </p>
              )}
            </div>

            {requestError && (
              <p role="alert" className="mt-3 text-term-sm text-term-error">
                {requestError}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-4 text-term-sm text-term-ink underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
            >
              {isSubmitting ? '[ sending... ]' : '[ send feedback ]'}
            </button>
          </form>
        )}
      </div>
    );
  }

  // variant === 'beta'
  return (
    <div className={className}>
      {statusRegion}
      {sent ? (
        <div role="status" className="beta-card p-6 sm:p-8">
          <h3 className="text-[length:var(--beta-text-lg)]">Thank you</h3>
          <p className="mt-2 beta-measure">Your feedback has been sent.</p>
          <button type="button" onClick={resetToIdle} className="beta-btn beta-btn-secondary mt-5">
            Send more feedback
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="beta-card p-6 sm:p-8">
          <div>
            <label htmlFor={categoryId} className="beta-legend">
              Category <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
            </label>
            <select
              id={categoryId}
              disabled={isSubmitting}
              className="beta-input mt-2 max-w-xs"
              {...register('category')}
            >
              <option value="">No category</option>
              {FEEDBACK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6">
            <label htmlFor={messageId} className="beta-legend">
              Message
            </label>
            <p id={noticeId} className="beta-hint mt-1">
              Please do not include personal or medical details.
            </p>
            <textarea
              id={messageId}
              rows={5}
              maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
              disabled={isSubmitting}
              aria-describedby={describedBy}
              aria-invalid={validationError ? true : undefined}
              // Full width of the card: a textarea is something you TYPE
              // into, not prose you read, so a reading measure does not
              // apply and a control stopping short of its own card looks
              // unfinished. The category select keeps its own narrow cap,
              // being a short list rather than free text.
              className="beta-textarea mt-3"
              placeholder="What's on your mind?"
              {...register('message')}
            />
            <p
              id={counterId}
              className={`beta-hint mt-1.5 ${overLimit ? 'text-[color:var(--beta-error)]' : ''}`}
            >
              {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
            </p>
            {validationError && (
              <p
                id={validationId}
                role="alert"
                className="mt-1.5 beta-measure text-[color:var(--beta-error)]"
              >
                {validationError}
              </p>
            )}
          </div>

          {requestError && (
            <p role="alert" className="mt-4 beta-measure text-[color:var(--beta-error)]">
              {requestError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="beta-btn beta-btn-primary mt-6"
          >
            {isSubmitting ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      )}
    </div>
  );
}
