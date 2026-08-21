'use client';

import { useId, useState } from 'react';
import { signIn } from '@/lib/auth-client';

interface LoginFormProps {
  /**
   * The tool being signed into, as it reads in the prompt line and the blurb.
   *
   * Parameterised because this form is shared by every /internal page: left
   * hardcoded, the photo pool page greeted you with the usage monitor's copy
   * and told you it tracked conversation API spend.
   */
  tool?: string;
  description?: string;
}

export function LoginForm({
  tool = 'internal-usage-monitor',
  description = 'This tool tracks live spend against the public conversation API. Sign in with the seeded admin account to continue.'
}: LoginFormProps = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const { error: signInError } = await signIn.email({ email, password });

    if (signInError) {
      setError(signInError.message ?? 'Invalid email or password.');
      setIsSubmitting(false);
    }
    // On success, useSession() in the parent page picks up the new session
    // automatically; no manual redirect/refetch needed here.
  }

  return (
    <div>
      <p className="text-term-sm text-term-muted">
        <span aria-hidden="true">$ </span>
        {tool} --auth
      </p>
      <h1 className="mt-2 text-term-xl font-bold text-term-ink terminal-glow">
        AUTHENTICATION REQUIRED
      </h1>
      <p className="mt-2 text-term-sm text-term-body">{description}</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className="text-term-sm text-term-muted">
            email:
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            aria-describedby={error ? errorId : undefined}
            className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="text-term-sm text-term-muted">
            password:
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            aria-describedby={error ? errorId : undefined}
            className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
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
          className="mt-2 self-start border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent focus-visible:border-term-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <span aria-live="polite">
              AUTHENTICATING<span className="terminal-cursor" aria-hidden="true" />
            </span>
          ) : (
            '[ SIGN IN ]'
          )}
        </button>
      </form>

      <p className="mt-10 text-term-xs text-term-muted">
        Internal tool — Tony Chou&rsquo;s portfolio backend. Not for public access.
      </p>
    </div>
  );
}
