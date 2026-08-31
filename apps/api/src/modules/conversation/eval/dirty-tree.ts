/**
 * Decides whether an uncommitted change could have altered what the eval
 * suite measures.
 *
 * This exists because the eval runner spends real money, and the obvious
 * check is the wrong one. `git status` being non empty (the `gitDirty` flag)
 * answers "can this run be tied to a named commit?", not "are these scores
 * right?". Treating the flag itself as the defect once cost a paid run that
 * proved nothing, and it would have cost a second one: the replacement run
 * was also flagged dirty, and was fine, because what differed was a skill
 * manifest and a markdown file. See spec 0012 phase two, AC-15.
 *
 * So the question this module answers is narrower and more useful: of the
 * files that differ, does the suite load any of them?
 */

/**
 * Paths the suite never loads, so a difference in one cannot change a score.
 *
 * `docs/evals/` is here because every run rewrites its own outputs (results,
 * scoreboard, baseline), which would otherwise make every run after the first
 * look dirty. The rest are surfaces the eval does not execute: the site, the
 * forecasting app, CI config, agent skill manifests, and prose.
 *
 * The list is deliberately an allow list of the harmless rather than a deny
 * list of the dangerous. Anything not named here counts as material, so a new
 * area nobody thought about fails safe and stops the run instead of silently
 * being waved through.
 */
export const INERT_PREFIXES = [
  'docs/',
  '.claude/',
  '.agents/',
  '.github/',
  'apps/web/',
  'apps/streamflow/',
  'infra/',
  'skills-lock.json',
  'README.md',
];

/**
 * Pulls the path that matters out of one `git status --porcelain` line.
 *
 * The format is `XY path`, except for a rename or a copy, where it is
 * `XY old -> new`. Slicing off the first three characters and stopping there
 * leaves the whole `old -> new` string, which then gets prefix matched as if
 * it were a path. That is not a cosmetic bug: `git mv docs/notes.md
 * apps/api/src/modules/conversation/skills/interviewer.md` produces a string
 * starting with `docs/`, so a changed interviewer prompt was classified inert
 * and a paid run went ahead against it.
 *
 * The new path is the one that matters. The old path no longer exists, so it
 * cannot be read by anything; what the suite might now load is whatever sits
 * at the destination.
 *
 * Returns null for a line too short to carry a path.
 */
export function porcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  const rest = line.slice(3);
  // Only a rename or a copy carries two paths. Splitting unconditionally
  // would corrupt an ordinary path that happens to contain " -> ".
  const renamed = status.includes('R') || status.includes('C');
  const arrow = renamed ? rest.lastIndexOf(' -> ') : -1;
  const raw = arrow === -1 ? rest : rest.slice(arrow + 4);
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : unquote(trimmed);
}

/**
 * git quotes a path containing a space, a quote, or a non ASCII byte, and
 * escapes characters inside it. An unstripped quote makes the path fail every
 * prefix test, which errs toward material and so is safe, but it also reports
 * a confusing path to whoever is reading the refusal.
 */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  return value
    .slice(1, -1)
    .replace(/\\([\\"nrt])/g, (_, ch: string) =>
      ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch,
    );
}

/** True when a path is one the eval suite never reads. */
export function isInert(filePath: string): boolean {
  return INERT_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? filePath.startsWith(prefix) : filePath === prefix,
  );
}

/**
 * Splits `git status` paths into the ones that cannot affect a run and the
 * ones that can. A run should be refused when `material` is non empty.
 */
export function classifyDirtyFiles(files: readonly string[]): {
  inert: string[];
  material: string[];
} {
  const inert: string[] = [];
  const material: string[] = [];
  for (const file of files) {
    if (isInert(file)) inert.push(file);
    else material.push(file);
  }
  return { inert, material };
}
