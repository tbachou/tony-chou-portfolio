'use client';

import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from '@/lib/auth-client';

const loginSchema = z.object({
  email: z.email('Enter the email address on the admin account.'),
  password: z.string().min(1, 'Enter your password.')
});

type LoginValues = z.infer<typeof loginSchema>;

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
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  });

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();

  // `root` rather than a field: better-auth answers "invalid email or
  // password" without saying which, and pinning that to one input would
  // tell an attacker which half was wrong.
  const formError = errors.root?.message;

  async function onSubmit(values: LoginValues) {
    const { error: signInError } = await signIn.email(values);

    if (signInError) {
      setError('root', {
        message: signInError.message ?? 'Invalid email or password.'
      });
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

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-8 flex flex-col gap-5"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className="text-term-sm text-term-muted">
            email:
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="username"
            disabled={isSubmitting}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={
              [errors.email ? emailErrorId : null, formError ? errorId : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
            className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none placeholder:text-term-muted disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="you@example.com"
            {...register('email')}
          />
          {errors.email ? (
            <p id={emailErrorId} className="text-term-sm text-term-error">
              <span aria-hidden="true">!! </span>
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="text-term-sm text-term-muted">
            password:
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            disabled={isSubmitting}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              [
                errors.password ? passwordErrorId : null,
                formError ? errorId : null
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            className="border border-term-border bg-term-surface px-3 py-2 text-term-base text-term-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
            {...register('password')}
          />
          {errors.password ? (
            <p id={passwordErrorId} className="text-term-sm text-term-error">
              <span aria-hidden="true">!! </span>
              {errors.password.message}
            </p>
          ) : null}
        </div>

        {formError ? (
          <p id={errorId} role="alert" className="text-term-sm text-term-error">
            <span aria-hidden="true">!! </span>
            {formError}
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
