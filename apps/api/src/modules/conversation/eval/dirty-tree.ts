/**
 * Decides whether an uncommitted change could have altered what the eval
 * suite measures, by asking git rather than by parsing git.
 *
 * Why this exists at all: the eval runner spends real money, and the obvious
 * check is the wrong one. `git status` being non empty (the `gitDirty` flag)
 * answers "can this run be tied to a named commit?", not "are these scores
 * right?". Treating the flag as the defect cost a paid run for nothing, and
 * would have cost a second: the replacement run was also flagged dirty and
 * was fine, because what differed was a skill manifest and a markdown file.
 * See spec 0012 phase two, AC-15.
 *
 * Why it is shaped like this: the first version answered the narrower
 * question by parsing `git status --porcelain` output and prefix matching the
 * result. That parser was the bug. A rename prints `R  old -> new`, so the
 * whole string got matched as a path, and `git mv docs/notes.md
 * apps/api/src/modules/conversation/skills/interviewer.md` classified a
 * changed prompt as harmless. Quoting, case, and path boundaries were three
 * more ways to get it wrong.
 *
 * The list of harmless areas is a git pathspec, so git can do the matching.
 * It has never been wrong about renames, quoting, or case, and there is no
 * parser left to have a bug in.
 */

/**
 * Areas the eval suite never loads, as pathspec exclusions.
 *
 * `docs/evals/` is inside `docs/` and would be covered anyway; it is named
 * separately in ALL_STATUS_ARGS because the suite rewrites its own outputs on
 * every run and they should not even be listed.
 *
 * Each entry uses git's `top` magic (the leading `/`), which anchors it to
 * the repo root instead of the current directory. That is load bearing: the
 * runner executes with its working directory in `apps/api`, and a relative
 * pathspec silently scoped the whole check to that one workspace. Verified:
 * a dirty `packages/shared/contracts.ts`, which the suite does load, went
 * unseen with a relative spec and is caught with this one.
 *
 * This is an allow list of the harmless, not a deny list of the dangerous. An
 * area nobody has thought about is material by default, so a new source tree
 * stops a run until someone decides it is safe. A false refusal costs a
 * commit; a false approval costs money and a result nobody can reproduce.
 */
export const INERT_PATHSPECS = [
  ':!/docs/',
  ':!/.claude/',
  ':!/.agents/',
  ':!/.github/',
  ':!/apps/web/',
  ':!/apps/streamflow/',
  ':!/infra/',
  ':!/skills-lock.json',
  ':!/README.md',
] as const;

const BASE_STATUS_ARGS = ['status', '--porcelain', '--untracked-files=no'] as const;

/** Everything that differs from the commit, minus the suite's own outputs. */
export const ALL_STATUS_ARGS: string[] = [
  ...BASE_STATUS_ARGS,
  '--',
  ':/',
  ':!/docs/evals/',
];

/**
 * Only what differs AND is loaded by the suite. Empty output means the run is
 * reproducible from its commit, whatever `git status` says overall.
 */
export const MATERIAL_STATUS_ARGS: string[] = [
  ...BASE_STATUS_ARGS,
  '--',
  ':/',
  ':!/docs/evals/',
  ...INERT_PATHSPECS,
];
