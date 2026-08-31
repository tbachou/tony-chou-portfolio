/**
 * Path handling for the worktree report, kept separate so it can be tested.
 *
 * This file used to also carry `isRegenerable`, which decided whether an
 * ignored file could be rebuilt and so could be left out of the report. It is
 * gone, along with the "safe to remove" verdict it fed. Three versions of that
 * classification each cleared something irreplaceable in a new way, and the
 * last one lost a hand typed `dist/.env` for real. The report now lists what a
 * worktree holds and lets a person decide, so there is nothing left to
 * misclassify. See the comment at the top of check-worktrees.mjs.
 */

/**
 * Pulls the path out of one `git status --porcelain` line.
 *
 * The format is `XY path`, except for a rename or a copy, where it is
 * `XY old -> new`; the new path is the one that matters, since the old one no
 * longer exists. git also quotes a path containing a space, a quote, or a non
 * ASCII byte, and escapes characters inside it.
 *
 * Returns null for a line that carries no path.
 */
export function porcelainPath(line) {
  if (typeof line !== 'string' || line.length < 4) return null;
  const status = line.slice(0, 2);
  const rest = line.slice(3);
  // Only a rename or a copy carries two paths. Splitting unconditionally would
  // corrupt an ordinary path that happens to contain " -> ".
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
