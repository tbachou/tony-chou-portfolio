/**
 * localStorage that cannot throw.
 *
 * Every access to `localStorage` can throw, not just fail: Safari in private
 * mode, blocked cookies, a full quota, and an embedded context all raise
 * rather than return null. Six call sites each wrapped their own access in a
 * bare `catch {}` to survive that, which a repo sweep flagged — the swallow is
 * right, six copies of it are not.
 *
 * Deliberately narrow. Two call sites keep their own try/catch because they
 * are not only about storage: `useGradeProgress` parses and validates JSON
 * inside its catch, and BetaPlanner's clipboard write is a different API
 * entirely. Widening this helper to swallow those would hide real parse
 * failures behind a storage-shaped name.
 */

/**
 * The stored string, or null when there is nothing to read — including when
 * reading itself was refused. Callers cannot distinguish "absent" from
 * "unavailable", and none of them needs to: every one falls back to a default.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Store a value, or don't. Returns whether it persisted, which every current
 * caller ignores — a preference that does not survive a reload is still worth
 * applying for this visit.
 */
export function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
