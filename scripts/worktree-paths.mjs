/**
 * Path classification for the worktree hygiene report, kept separate from the
 * script so it can be tested.
 *
 * The stakes are asymmetric. This decides whether `check:worktrees` prints
 * `git worktree remove <path>` for a directory. Calling something regenerable
 * when it is not means the script recommends destroying the only copy of a
 * file, which is the exact harm it exists to prevent.
 */

/**
 * Ignored paths a build or an install can recreate.
 *
 * Entries ending in `/` are directory names and are matched as whole path
 * SEGMENTS, never as substrings. That distinction is the fix for a real bug:
 * a substring test cleared `test-coverage/` (it contains `coverage/`),
 * `about/` (contains `out/`), and `secrets-dist/keys.pem` (contains `dist/`),
 * so a worktree holding hand written notes in any of them was reported as
 * safe to delete.
 */
export const REGENERABLE = [
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.turbo/',
  '.cache/',
  'coverage/',
  '.DS_Store',
];

/** `src/generated/` only counts when both segments are adjacent. */
const REGENERABLE_PAIRS = [['src', 'generated']];

/**
 * True when every irreplaceable thing at this path can be rebuilt.
 *
 * A directory pattern matches only when the whole segment matches, so
 * `dist/` clears `apps/api/dist/` and `dist/` but not `secrets-dist/`. A file
 * pattern matches only the final segment.
 */
export function isRegenerable(entry) {
  if (typeof entry !== 'string' || entry.length === 0) return false;
  const segments = entry.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return false;

  for (const pattern of REGENERABLE) {
    if (pattern.endsWith('/')) {
      if (segments.includes(pattern.slice(0, -1))) return true;
    } else if (segments[segments.length - 1] === pattern) {
      return true;
    }
  }

  for (const [first, second] of REGENERABLE_PAIRS) {
    for (let i = 0; i < segments.length - 1; i += 1) {
      if (segments[i] === first && segments[i + 1] === second) return true;
    }
  }

  return false;
}

/**
 * Pulls the path out of one `git status --porcelain` line, taking the new
 * path of a rename and removing git's quoting. Returns null for a line that
 * carries no path. Mirrors `porcelainPath` in the api eval module; the two
 * are separate because this file has no build step and cannot import TypeScript.
 */
export function porcelainPath(line) {
  if (typeof line !== 'string' || line.length < 4) return null;
  const status = line.slice(0, 2);
  const rest = line.slice(3);
  const renamed = status.includes('R') || status.includes('C');
  const arrow = renamed ? rest.lastIndexOf(' -> ') : -1;
  const raw = arrow === -1 ? rest : rest.slice(arrow + 4);
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2) {
    return trimmed;
  }
  return trimmed
    .slice(1, -1)
    .replace(/\\([\\"nrt])/g, (_, ch) =>
      ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch,
    );
}
