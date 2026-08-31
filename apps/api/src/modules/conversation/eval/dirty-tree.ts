/**
 * The one question the eval runner asks git before spending money: is
 * anything uncommitted?
 *
 * The rule is flat. Commit before you run. A results file records the commit
 * it ran at, and that record is only true if the tree matched the commit, so
 * anything uncommitted makes the run unreproducible and the run is refused.
 * `--allow-dirty` is the deliberate exception, for a control run that is not
 * meant to be reproducible in the first place.
 *
 * An earlier version tried to be clever here, classifying each changed file
 * as one the suite loads or one it does not, so that a run with only a spec
 * markdown edited was allowed through. It worked, and it cost more than it
 * saved: a hand written parser twice waved a renamed prompt file past the
 * guard, and the classification list was one more thing to keep true as the
 * repo moved. A flat rule has nothing to get wrong.
 *
 * That is a rule for STARTING a run, and it is deliberately blunter than the
 * rule for JUDGING one that already exists. Spec 0012 AC-15 still says a
 * recorded run is usable when its commit reproduces it, which can be true of
 * a run flagged dirty if what differed cannot affect a score. The two differ
 * because the remedies differ: being told to commit first costs ten seconds,
 * while disqualifying a finished run costs another paid run.
 */

/**
 * The suite rewrites its own outputs on every run: a results file, and
 * `scoreboard.md`. Counting those would mean the second run in a row always
 * refuses, so they are excluded, and they are the ONLY exclusion. `:/`
 * anchors the query at the repo root, because the runner executes with its
 * working directory in `apps/api` and a relative pathspec would silently
 * narrow the check to that one workspace.
 */
export const STATUS_ARGS: string[] = [
  'status',
  '--porcelain',
  '--untracked-files=no',
  '--',
  ':/',
  ':!/docs/evals/',
];
