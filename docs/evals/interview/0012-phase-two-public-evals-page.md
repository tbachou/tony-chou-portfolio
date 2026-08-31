# Phase two: public evals page

Spec: [0012 child, public evals page](../../specs/_root/0012-grounded-portfolio-agent/0012-public-evals-page.md) · Published 2026-08-30 · **No eval run was made for this phase.**

**First person text quoted from any results file was written by a language model under test, not by Tony Chou.** See [README.md](README.md).

## No measurement, and why that is not an omission

The umbrella spec's AC-1 requires a full eval run before and after every phase. This phase does not take one, and that exemption is written into the umbrella rather than left as a silent gap.

The reason is mechanical. This phase changes no model facing code. No prompt moved, no skill file changed, no context was added or removed, no model or provider was swapped, and nothing in the generation path was touched. The suite measures what the conversation engine produces; a page that reads committed files at build time cannot change that output. A run here would cost real money to report the same numbers back, and a scoreboard that publishes an unchanged row as though it were evidence of something is exactly the laundering this page exists to argue against.

So the honest record is: no run, stated plainly, with the reason. That is what `measured: false` means in `published.json`, and it is why the run history table shows this phase with no scores rather than with a flat row that could be mistaken for a measurement.

**This phase's pull request carries the `skip-evals` label** (child spec AC-13). The label is what stops CI spending real budget on a capped run that cannot move the scores. Two things about it are easy to get wrong: labels are read when the event fires, so labelling an already open PR takes effect from the next push rather than retroactively, and the label must go on before the first push if it is to save anything at all.

## What changed

1. **A public page at `/projects/interview-simulator/evals`**, statically generated, that reads this directory at build time: the latest scores, the run history, the baseline history, and the per phase writeups. Every number is either computed from a committed results file or recorded in the manifest, and every one of them links back to the exact file it came from, pinned to the commit the page was built from.
2. **A publish manifest, `published.json`.** Publishing a run is now a deliberate act rather than a consequence of a file existing. It also records what each phase was measured against at the time, which `baseline.json` cannot: that file only ever holds the current baseline, so a past phase's delta and verdict are gone the moment the suite re baselines.
3. **A named check, `npm run check:evals`**, wired into CI. It runs the same loader the site build runs, so a mistyped manifest fails a named check with the offending path in the message rather than a page render deep in a build log.
4. **A stub project page at `/projects/interview-simulator`**, which the evals page now sits under. The simulator was the site's most distinctive feature and the only one with no case study route.

## The defect this phase surfaced, and the rule that nearly hid it

The accepted baseline recorded commit `0d048e0` with 22 cases. That commit contains 20. The two credential bait cases and the fixture disambiguation were still uncommitted when it ran, so checking out `0d048e0` and re running measures a different case set than the baseline reports. It could not be reproduced from the commit it names, and every delta measured against it inherited that.

The baseline is the reference every future comparison is anchored to, so this quietly propagates: an anchor nobody can return to makes every measurement against it unverifiable, however carefully the deltas are computed.

**The interesting part is how nearly the wrong rule was applied.** AC-15 originally said the fix was a fresh run on a committed tree, and it treated `meta.gitDirty` as the thing to correct. Followed literally, that would have bought a second paid run for nothing, because the flag is not the question. `gitDirty` answers "can this run be tied to a named commit?", not "are these scores right?", and the two come apart in both directions:

- The run that replaced the baseline is **also** flagged dirty, and is fine. What was uncommitted was `skills-lock.json` and one spec markdown file, neither of which is read at runtime by anything the suite executes. The only other difference from `main` was in `apps/streamflow`, which this eval never touches, and the only change to `ownership-guard.ts` since the previous baseline was a comment. Re running at `36a31ea` reproduces the result.
- The baseline it replaced was flagged dirty **and** genuinely broken, but not because the flag was set. It was broken because the uncommitted part happened to be the eval dataset itself, which the flag never showed and could not.

So AC-15 was amended to test reproducibility from the recorded commit, and to require the evidence be written down where a reader can check it, rather than to test a boolean. The scores were never in question: honesty 1.000, grounding 0.977, persona 0.955, on the same dataset hash as before, so the noise band carries over unchanged.

The rule the eval suite should keep from this: verify the outcome, do not follow the flag. A check that is cheap to satisfy mechanically is not thereby the check that matters, and paying for a run to satisfy a boolean is the most expensive way to be wrong.

## Course principles applied, and skipped

This phase applies none of the model facing lessons, because it touches no model facing code. Its discipline is a different one, and worth naming since it is the discipline the page argues for.

**Applied:**

- **Publish the measurement, do not launder it.** The page leads with the method rather than with movement, states plainly that phase one moved nothing, and shows a phase with no measurement as having no measurement. The temptation to dress up a persona bump inside the noise band, or to wait for a phase with a better number, was named in the spec and refused.
- **One source, computed rather than transcribed.** Scores are computed from the committed results file at build time and never stored in the manifest, so the most likely wrong number, a stale hand copy, cannot exist. The values that must be recorded by hand, the delta and band a phase was measured against, are checked against the baseline wherever that check is still meaningful, and the build fails on a mismatch.
- **Refuse rather than degrade.** A missing file, a malformed manifest, a dirty run, or a delta that disagrees with the baseline fails the build. A page arguing that the measurement is disciplined cannot render a hole where a number should be.

**Skipped:**

- **Every prompt and context lesson.** There is no prompt here. Applying them would mean inventing model facing work to have something to report, which is the failure mode this writeup exists to avoid.
- **Serving the record from the API.** It would let a new run appear without a deploy, at the cost of a network dependency, a caching story, and a public endpoint to rate limit, for data that changes a few times a year. Reading committed files at build time is the cheaper guarantee and the stronger one.

## What this phase does not fix

The manifest is hand edited, so publishing a phase gains a step that can be forgotten. The build catches a wrong number and a missing file; it cannot catch a phase that was never added at all. A check for a writeup with no matching manifest entry is recorded as a follow up in the spec rather than pretended away here.
