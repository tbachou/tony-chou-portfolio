'use client';

import { useId, useState } from 'react';
import { AccessRequestStatusResult, AppSlug, fetchAccessRequestStatus, requestAccess } from '@/lib/api';

interface RequestAccessFormProps {
  appSlug: AppSlug;
  appName: string;
}

type View = 'request' | 'check';

function StatusLine({ result }: { result: AccessRequestStatusResult | null }) {
  if (result === null) {
    return (
      <p className="mt-3 text-term-sm text-term-muted">
        No request found for that email — submit one above first.
      </p>
    );
  }
  if (result.status === 'approved' && result.downloadUrl) {
    return (
      <p className="mt-3 text-term-sm text-term-body">
        [ APPROVED ] —{' '}
        <a
          href={result.downloadUrl}
          className="text-term-ink underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:decoration-term-accent"
        >
          download
        </a>
      </p>
    );
  }
  if (result.status === 'denied') {
    return <p className="mt-3 text-term-sm text-term-muted">[ NOT APPROVED ]</p>;
  }
  return <p className="mt-3 text-term-sm text-term-muted">[ PENDING ] — check back later.</p>;
}

export function RequestAccessForm({ appSlug, appName }: RequestAccessFormProps) {
  const [view, setView] = useState<View>('request');
  const [email, setEmail] = useState('');
  const [checkEmail, setCheckEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestResult, setRequestResult] = useState<AccessRequestStatusResult | null>(null);
  const [checkResult, setCheckResult] = useState<AccessRequestStatusResult | null | undefined>(
    undefined
  );
  const emailId = useId();
  const checkEmailId = useId();

  async function handleRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await requestAccess(email, appSlug);
      setRequestResult(result);
    } catch {
      setError('Could not submit request. Try again in a moment.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCheck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await fetchAccessRequestStatus(checkEmail, appSlug);
      setCheckResult(result);
    } catch {
      setError('Could not check status. Try again in a moment.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="border border-term-border p-4 sm:p-5">
      <p className="text-term-xs uppercase tracking-wide text-term-muted">
        beta access — {appName}
      </p>

      {view === 'request' ? (
        <>
          <form onSubmit={handleRequest} className="mt-3 flex flex-wrap items-end gap-3" noValidate>
            <div className="flex flex-1 min-w-[12rem] flex-col gap-1.5">
              <label htmlFor={emailId} className="text-term-sm text-term-muted">
                email:
              </label>
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
                className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[44px] border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'REQUESTING…' : '[ request access ]'}
            </button>
          </form>

          {requestResult ? <StatusLine result={requestResult} /> : null}

          <button
            type="button"
            onClick={() => {
              setView('check');
              setError(null);
            }}
            className="mt-4 text-term-xs text-term-muted underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:text-term-ink hover:decoration-term-accent"
          >
            already requested? check status →
          </button>
        </>
      ) : (
        <>
          <form onSubmit={handleCheck} className="mt-3 flex flex-wrap items-end gap-3" noValidate>
            <div className="flex flex-1 min-w-[12rem] flex-col gap-1.5">
              <label htmlFor={checkEmailId} className="text-term-sm text-term-muted">
                email:
              </label>
              <input
                id={checkEmailId}
                type="email"
                autoComplete="email"
                required
                value={checkEmail}
                onChange={(event) => setCheckEmail(event.target.value)}
                disabled={isSubmitting}
                className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[44px] border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'CHECKING…' : '[ check status ]'}
            </button>
          </form>

          {checkResult !== undefined ? <StatusLine result={checkResult} /> : null}

          <button
            type="button"
            onClick={() => {
              setView('request');
              setError(null);
            }}
            className="mt-4 text-term-xs text-term-muted underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:text-term-ink hover:decoration-term-accent"
          >
            ← back to request access
          </button>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-term-sm text-term-error">
          <span aria-hidden="true">!! </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
