'use client';

import { useId, useState, type FormEvent } from 'react';
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

type Phase = 'idle' | 'submitting' | 'success' | 'error';

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
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const messageId = useId();
  const categoryId = useId();
  const counterId = useId();
  const noticeId = useId();

  const trimmedLength = message.trim().length;
  const overLimit = message.length > FEEDBACK_MESSAGE_MAX_LENGTH;
  const canSubmit = phase !== 'submitting' && trimmedLength > 0 && !overLimit;

  function resetToIdle() {
    setPhase('idle');
    setCategory('');
    setMessage('');
    setErrorMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setPhase('submitting');
    setErrorMessage(null);
    setAnnouncement('Sending your feedback.');

    try {
      await submitFeedback({
        message: message.trim(),
        category: category || undefined,
        source,
      });
      setPhase('success');
      setAnnouncement('Feedback sent. Thank you.');
    } catch (error) {
      setPhase('error');
      if (error instanceof FeedbackRequestError && error.status === 429) {
        setErrorMessage(error.message || RATE_LIMIT_MESSAGE_FALLBACK);
        setAnnouncement('You have reached the feedback rate limit.');
      } else if (error instanceof FeedbackRequestError) {
        setErrorMessage(error.message);
        setAnnouncement('Your feedback could not be sent. Details are on screen.');
      } else {
        setErrorMessage(NETWORK_ERROR_MESSAGE);
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
        {phase === 'success' ? (
          <div role="status" className="border border-term-border p-4 text-term-sm">
            <p className="text-term-ink">$ feedback sent — thank you.</p>
            <button
              type="button"
              onClick={resetToIdle}
              className="mt-3 text-term-sm text-term-ink transition-colors duration-term-instant hover:text-term-accent"
            >
              [ send more feedback ]
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={categoryId} className="text-term-sm text-term-muted">
                category (optional)
              </label>
              <select
                id={categoryId}
                value={category}
                onChange={(e) => setCategory(e.target.value as FeedbackCategory | '')}
                disabled={phase === 'submitting'}
                className="w-full max-w-xs rounded-term-sm border border-term-border bg-term-canvas px-3 py-2 text-term-sm text-term-ink focus-visible:outline-none disabled:opacity-60"
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
                required
                rows={4}
                maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={phase === 'submitting'}
                aria-describedby={`${noticeId} ${counterId}`}
                className="w-full rounded-term-sm border border-term-border bg-term-canvas px-3 py-2 text-term-sm text-term-body transition-colors duration-term-instant focus-visible:outline-none disabled:opacity-60"
                placeholder="What's on your mind?"
              />
              <p
                id={counterId}
                className={`text-term-xs ${overLimit ? 'text-term-error' : 'text-term-muted'}`}
              >
                {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
              </p>
            </div>

            {phase === 'error' && errorMessage && (
              <p role="alert" className="mt-3 text-term-sm text-term-error">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-4 text-term-sm text-term-ink transition-colors duration-term-instant hover:text-term-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-term-ink"
            >
              {phase === 'submitting' ? '[ sending... ]' : '[ send feedback ]'}
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
      {phase === 'success' ? (
        <div role="status" className="beta-card p-6 sm:p-8">
          <h3 className="text-[length:var(--beta-text-lg)]">Thank you</h3>
          <p className="mt-2 max-w-[65ch]">Your feedback has been sent.</p>
          <button type="button" onClick={resetToIdle} className="beta-btn beta-btn-secondary mt-5">
            Send more feedback
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="beta-card p-6 sm:p-8">
          <div>
            <label htmlFor={categoryId} className="beta-legend">
              Category <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
            </label>
            <select
              id={categoryId}
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory | '')}
              disabled={phase === 'submitting'}
              className="beta-input mt-2 max-w-xs"
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
              required
              rows={5}
              maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={phase === 'submitting'}
              aria-describedby={`${noticeId} ${counterId}`}
              className="beta-textarea mt-3 max-w-[40rem]"
              placeholder="What's on your mind?"
            />
            <p
              id={counterId}
              className={`beta-hint mt-1.5 ${overLimit ? 'text-[color:var(--beta-error)]' : ''}`}
            >
              {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
            </p>
          </div>

          {phase === 'error' && errorMessage && (
            <p role="alert" className="mt-4 max-w-[65ch] text-[color:var(--beta-error)]">
              {errorMessage}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className="beta-btn beta-btn-primary mt-6">
            {phase === 'submitting' ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      )}
    </div>
  );
}
