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
