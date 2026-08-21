'use client';

import { useSession } from '@/lib/auth-client';
import { TerminalWindow } from '@/components/TerminalWindow';
import { LoginForm } from '../components/LoginForm';
import { GradePhotoAdmin } from '../components/GradePhotoAdmin';

/**
 * Grade Guesser's photo pool admin (spec 0006 R3).
 *
 * Not gated on GRADE_GAME_ENABLED, unlike `/grade` itself: the pool has to be
 * fillable while the game is still hidden. The api side matches — its module is
 * registered unconditionally and sits behind the same better-auth guard.
 *
 * Wider than `/internal/usage` (4xl rather than 3xl) because rows here carry a
 * thumbnail alongside their metadata and the toggle.
 */
export default function InternalGradePhotosPage() {
  const { data: session, isPending } = useSession();

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-4xl px-4 sm:my-16 sm:px-0"
    >
      <TerminalWindow path="tonychou@internal:~/grade-photos$">
        {isPending ? (
          <p
            className="text-term-sm text-term-muted"
            role="status"
            aria-live="polite"
          >
            BOOTING<span className="terminal-cursor" aria-hidden="true" />
          </p>
        ) : session ? (
          <GradePhotoAdmin email={session.user.email} />
        ) : (
          <LoginForm
            tool="grade-photo-pool"
            description="This tool manages the photo pool Grade Guesser draws its daily problem from. Sign in with the seeded admin account to continue."
          />
        )}
      </TerminalWindow>
    </main>
  );
}
