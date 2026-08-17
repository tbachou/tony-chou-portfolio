'use client';

import { useSession } from '@/lib/auth-client';
import { TerminalWindow } from '@/components/TerminalWindow';
import { LoginForm } from '../components/LoginForm';
import { AccessRequestsDashboard } from '../components/AccessRequestsDashboard';

export default function InternalAccessRequestsPage() {
  const { data: session, isPending } = useSession();

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 sm:my-16 sm:px-0">
      <TerminalWindow path="tonychou@internal:~/access-requests$">
        {isPending ? (
          <p className="text-term-sm text-term-muted" role="status" aria-live="polite">
            BOOTING<span className="terminal-cursor" aria-hidden="true" />
          </p>
        ) : session ? (
          <AccessRequestsDashboard email={session.user.email} />
        ) : (
          <LoginForm />
        )}
      </TerminalWindow>
    </main>
  );
}
