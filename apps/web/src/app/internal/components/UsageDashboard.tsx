'use client';

import { useEffect, useState } from 'react';
import { fetchUsageSummary, UsageSummary } from '@/lib/api';
import { signOut } from '@/lib/auth-client';

interface UsageDashboardProps {
  email: string;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function UsageDashboard({ email }: UsageDashboardProps) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchUsageSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load usage data. Your session may have expired.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const windowTotals = summary?.dailyTotals.reduce(
    (acc, day) => ({ turnCount: acc.turnCount + day.turnCount, tokenCount: acc.tokenCount + day.tokenCount }),
    { turnCount: 0, tokenCount: 0 }
  );
  const mostRecentDay = summary?.dailyTotals[summary.dailyTotals.length - 1];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-term-border pb-4">
        <div>
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            internal-usage-monitor --user {email}
          </p>
          <h1 className="mt-1 text-term-xl font-bold text-term-ink terminal-glow">USAGE MONITOR</h1>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="border border-term-border px-3 py-1.5 text-term-sm text-term-muted transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent focus-visible:border-term-accent"
        >
          [ SIGN OUT ]
        </button>
      </div>

      {isLoading ? (
        <p className="mt-8 text-term-sm text-term-muted" role="status" aria-live="polite">
          LOADING USAGE DATA<span className="terminal-cursor" aria-hidden="true" />
        </p>
      ) : error ? (
        <p className="mt-8 text-term-sm text-term-error" role="alert">
          <span aria-hidden="true">!! </span>
          {error}
        </p>
      ) : summary ? (
        <>
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">14-DAY TURNS</dt>
              <dd className="mt-1 text-term-lg text-term-ink">{formatNumber(windowTotals?.turnCount ?? 0)}</dd>
            </div>
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">14-DAY TOKENS</dt>
              <dd className="mt-1 text-term-lg text-term-ink">{formatNumber(windowTotals?.tokenCount ?? 0)}</dd>
            </div>
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">
                {mostRecentDay ? `${mostRecentDay.date} TURNS` : 'LATEST DAY TURNS'}
              </dt>
              <dd className="mt-1 text-term-lg text-term-ink">{formatNumber(mostRecentDay?.turnCount ?? 0)}</dd>
            </div>
            <div className="border border-term-border p-3">
              <dt className="text-term-xs text-term-muted">
                {mostRecentDay ? `${mostRecentDay.date} TOKENS` : 'LATEST DAY TOKENS'}
              </dt>
              <dd className="mt-1 text-term-lg text-term-ink">{formatNumber(mostRecentDay?.tokenCount ?? 0)}</dd>
            </div>
          </dl>

          <section className="mt-10" aria-labelledby="daily-totals-heading">
            <h2 id="daily-totals-heading" className="text-term-base font-bold text-term-ink">
              DAILY TOTALS (LAST 14 DAYS)
            </h2>
            {summary.dailyTotals.length === 0 ? (
              <p className="mt-3 text-term-sm text-term-muted">NO USAGE RECORDED YET.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-term-sm">
                  <thead>
                    <tr className="border-b border-term-border text-term-muted">
                      <th scope="col" className="py-2 text-left font-normal">
                        DATE
                      </th>
                      <th scope="col" className="py-2 text-right font-normal">
                        TURNS
                      </th>
                      <th scope="col" className="py-2 text-right font-normal">
                        TOKENS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...summary.dailyTotals].reverse().map((day) => (
                      <tr key={day.date} className="border-b border-term-border">
                        <td className="py-2 text-term-body">
                          <time dateTime={day.date}>{day.date}</time>
                        </td>
                        <td className="py-2 text-right text-term-body">{formatNumber(day.turnCount)}</td>
                        <td className="py-2 text-right text-term-body">{formatNumber(day.tokenCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-10" aria-labelledby="top-sources-heading">
            <h2 id="top-sources-heading" className="text-term-base font-bold text-term-ink">
              TOP SOURCES (BY TOKEN USAGE)
            </h2>
            {summary.topSources.length === 0 ? (
              <p className="mt-3 text-term-sm text-term-muted">NO SOURCES RECORDED YET.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-term-sm">
                  <thead>
                    <tr className="border-b border-term-border text-term-muted">
                      <th scope="col" className="py-2 text-left font-normal">
                        RANK
                      </th>
                      <th scope="col" className="py-2 text-left font-normal">
                        HASHED IP
                      </th>
                      <th scope="col" className="py-2 text-right font-normal">
                        TOKENS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topSources.map((source, index) => (
                      <tr key={source.hashedIp} className="border-b border-term-border">
                        <td className="py-2 text-term-body">{index + 1}</td>
                        <td className="py-2 text-term-body">
                          <code title={source.hashedIp}>{truncateHash(source.hashedIp)}</code>
                        </td>
                        <td className="py-2 text-right text-term-body">{formatNumber(source.tokenCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
