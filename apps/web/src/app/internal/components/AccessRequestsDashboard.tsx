'use client';

import { useEffect, useState } from 'react';
import {
  AccessRequestAdmin,
  approveAccessRequest,
  denyAccessRequest,
  fetchAccessRequests
} from '@/lib/api';
import { signOut } from '@/lib/auth-client';

interface AccessRequestsDashboardProps {
  email: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function AccessRequestsDashboard({ email }: AccessRequestsDashboardProps) {
  const [requests, setRequests] = useState<AccessRequestAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>({});
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    setError(null);
    fetchAccessRequests()
      .then((data) => setRequests(data))
      .catch(() => setError('Could not load access requests. Your session may have expired.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleApprove(id: string) {
    const downloadUrl = (draftUrls[id] ?? '').trim();
    if (!downloadUrl) {
      setActionError('Enter a download URL before approving.');
      return;
    }
    setActionError(null);
    setPendingActionId(id);
    try {
      const updated = await approveAccessRequest(id, downloadUrl);
      setRequests((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? prev);
    } catch {
      setActionError('Could not approve that request. Try again.');
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleDeny(id: string) {
    setActionError(null);
    setPendingActionId(id);
    try {
      const updated = await denyAccessRequest(id);
      setRequests((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? prev);
    } catch {
      setActionError('Could not deny that request. Try again.');
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-term-border pb-4">
        <div>
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            internal-access-requests --user {email}
          </p>
          <h1 className="mt-1 text-term-xl font-bold text-term-ink terminal-glow">ACCESS REQUESTS</h1>
        </div>
        <div className="flex gap-3">
          <a
            href="/internal/usage"
            className="border border-term-border px-3 py-1.5 text-term-sm text-term-muted transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
          >
            [ usage monitor ]
          </a>
          <button
            type="button"
            onClick={() => void signOut()}
            className="border border-term-border px-3 py-1.5 text-term-sm text-term-muted transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent focus-visible:border-term-accent"
          >
            [ SIGN OUT ]
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-8 text-term-sm text-term-muted" role="status" aria-live="polite">
          LOADING ACCESS REQUESTS<span className="terminal-cursor" aria-hidden="true" />
        </p>
      ) : error ? (
        <p className="mt-8 text-term-sm text-term-error" role="alert">
          <span aria-hidden="true">!! </span>
          {error}
        </p>
      ) : requests && requests.length === 0 ? (
        <p className="mt-8 text-term-sm text-term-muted">NO ACCESS REQUESTS YET.</p>
      ) : requests ? (
        <>
          {actionError ? (
            <p className="mt-6 text-term-sm text-term-error" role="alert">
              <span aria-hidden="true">!! </span>
              {actionError}
            </p>
          ) : null}

          <ul className="mt-6 space-y-4">
            {requests.map((request) => (
              <li key={request.id} className="border border-term-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-term-sm font-bold text-term-ink">{request.email}</p>
                  <span className="text-term-xs uppercase tracking-wide text-term-muted">
                    [ {request.status} ]
                  </span>
                </div>
                <p className="mt-1 text-term-xs text-term-muted">
                  app: {request.appSlug} · requested {formatDate(request.createdAt)}
                </p>

                {request.status === 'approved' && request.downloadUrl ? (
                  <p className="mt-3 break-all text-term-xs text-term-body">{request.downloadUrl}</p>
                ) : null}

                {request.status === 'pending' ? (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div className="flex flex-1 min-w-[14rem] flex-col gap-1.5">
                      <label
                        htmlFor={`download-url-${request.id}`}
                        className="text-term-xs text-term-muted"
                      >
                        download url:
                      </label>
                      <input
                        id={`download-url-${request.id}`}
                        type="url"
                        value={draftUrls[request.id] ?? ''}
                        onChange={(event) =>
                          setDraftUrls((prev) => ({ ...prev, [request.id]: event.target.value }))
                        }
                        disabled={pendingActionId === request.id}
                        placeholder="https://github.com/…/releases/download/…"
                        className="border border-term-border bg-term-surface px-3 py-1.5 text-term-sm text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleApprove(request.id)}
                      disabled={pendingActionId === request.id}
                      className="min-h-[38px] border border-term-border px-3 py-1.5 text-term-sm text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      [ approve ]
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeny(request.id)}
                      disabled={pendingActionId === request.id}
                      className="min-h-[38px] border border-term-border px-3 py-1.5 text-term-sm text-term-muted transition-colors duration-term-instant hover:border-term-error hover:text-term-error disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      [ deny ]
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
