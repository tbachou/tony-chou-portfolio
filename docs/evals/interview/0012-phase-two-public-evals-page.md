# Phase two: public evals page

Spec: [0012 child, public evals page](../../specs/_root/0012-grounded-portfolio-agent/0012-public-evals-page.md) · Published 2026-08-30 · **No eval run was made for this phase.**

**First person text quoted from any results file was written by a language model under test, not by Tony Chou.** See [README.md](README.md).

## No measurement, and why that is not an omission

The umbrella spec's AC-1 requires a full eval run before and after every phase. This phase does not take one, and that exemption is written into the umbrella rather than left as a silent gap.

The reason is mechanical. This phase changes no model facing code. No prompt moved, no skill file changed, no context was added or removed, no model or provider was swapped, and nothing in the generation path was touched. The suite measures what the conversation engine produces; a page that reads committed files at build time cannot change that output. A run here would cost real money to report the same numbers back, and a scoreboard that publishes an unchanged row as though it were evidence of something is exactly the laundering this page exists to argue against.

So the honest record is: no run, stated plainly, with the reason. That is what `measured: false` means in `published.json`, and it is why the run history table shows this phase with no scores rather than with a flat row that could be mistaken for a measurement.

## What changed

1. **A public page at `/projects/interview-simulator/evals`**, statically generated, that reads this directory at build time: the latest scores, the run history, the baseline history, and the per phase writeups. Every number is either computed from a committed results file or recorded in the manifest, and every one of them links back to the exact file it came from, pinned to the commit the page was built from.
2. **A publish manifest, `published.json`.** Publishing a run is now a deliberate act rather than a consequence of a file existing. It also records what each phase was measured against at the time, which `baseline.json` cannot: that file only ever holds the current baseline, so a past phase's delta and verdict are gone the moment the suite re baselines.
3. **A named check, `npm run check:evals`**, wired into CI. It runs the same loader the site build runs, so a mistyped manifest fails a named check with the offending path in the message rather than a page render deep in a build log.
4. **A stub project page at `/projects/interview-simulator`**, which the evals page now sits under. The simulator was the site's most distinctive feature and the only one with no case study route.

## The defect this phase surfaced

The accepted baseline was measured from a working tree with uncommitted changes: `meta.gitDirty` is `true` at commit `0d048e0`. Nothing about that run is known to be wrong, but nothing about it can be reproduced either, because the tree it ran against was never committed and no longer exists.

That matters more than it looks. The baseline is the reference every future delta is measured against, so an unreproducible baseline quietly makes every future comparison unreproducible with it. The page's own rule is what surfaced this: it refuses to publish a run with `gitDirty` true, and the rule cannot honestly bind everything except the one file it compares against.

The fix is a re baseline on a committed tree, recorded in the baseline history with that reason. It is a re baseline, not a phase measurement: it establishes a clean reference point, it does not measure a change.

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
