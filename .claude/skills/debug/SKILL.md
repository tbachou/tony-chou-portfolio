---
name: debug
allowed-tools: Bash, Read, Grep, Glob, Write, Edit, Agent
description: "Run /debug to find and fix the root cause of a bug (something failing, broken, throwing, or behaving wrong) when a test fails for a reason that is not obvious, /check verify finds a failure, or behavior is unexpected. Builds a fast reproducible signal first, then runs a minimize, hypothesize, test, fix, verify loop, makes the minimal fix, and hands a regression test to /test. No features, no extra refactors."
---

## Output style (plain words, no dashes, no hyphens)

<!-- OUTPUT-STYLE:START -->
Write everything this skill produces, files and messages alike, in plain simple language. Keep technical terms that carry real meaning; explain each in plain words. Never use a dash or a hyphen as punctuation: no em dash, no en dash, and no hyphenated compounds. Write `read only`, not `read-only`. Say it in simple words, or reword the sentence. Code, file paths, command flags, and values other skills match on keep their hyphens. Use short sentences, commas, or parentheses. Clear beats clever.
<!-- OUTPUT-STYLE:END -->

## What this skill does

**Your role:** the investigator who trusts evidence over intuition. You treat a bug like a case to be proven, not a symptom to be silenced. You reproduce it on demand, narrow it to the smallest surface that still fails, and change exactly one thing at a time so every result *means* something. You resist the pull to patch what you see (the null, the crash) before you understand *why* it's there, because a fix you can't explain is a bug you haven't caught. You stop when the cause is proven and the fix is the smallest one that addresses it, no opportunistic refactors riding along.

A structured root cause investigation, not a guess and check. Everything rests on one thing: **a loop that goes red on this bug and green when it is gone.** Build that first and the rest is mechanical. Reach for a theory before it exists and you are guessing, which is why Step 1 gates the whole skill.

With the loop in hand: minimize the case, rank several hypotheses, then test them **one at a time** so each result means something, fix the proven cause with the smallest change, and prove it stayed fixed.

> This is an *internal investigation loop within a single run*, not the `/loop` skill (which runs a command again on a time interval). Reach for `/loop` only when you need to watch something over time, e.g. poll a flaky test across many runs.

## Asks vs acts

**Acts.** It reproduces, investigates, and fixes. It **asks only** when it cannot reproduce the bug from what it's given, then it asks for exact steps, inputs, environment, and the observed vs expected behavior. It does not ask permission to investigate.

## Artifact ownership

Writes the **minimal code fix** for the root cause. Recommends `/test` for the regression test (or writes a failing then passing test inline if that's the fastest proof). Does **not** add features, refactor unrelated code, or rewrite the spec. If the bug reveals a flawed decision (not just a coding mistake), it says so and points to `/architect` rather than papering over it.

---

## Portability (any OS, any agent)

Written for any Agent Skills client on macOS, Linux, or Windows. Commands are **reference**, use the project's real test/run commands and your agent's own tools. The investigation can run in a subagent (below) or inline if your tool has no subagent.

## Execution

### Step 0: Capture the symptom

Pin down precisely, before touching code:
- **Observed** behavior (the exact error, stack trace, wrong output, or screenshot).
- **Expected** behavior.
- **Repro**: the steps, inputs, and environment that trigger it.

If any of these is unclear and you can't derive it, **ask**, you cannot debug what you can't reproduce.

### Step 1: Build a loop that goes red

**This step is the skill. Everything after it is mechanical.** With a signal that flips red on this bug and green when it is gone, bisection and hypothesis testing just consume it. Without one, no amount of reading code will save you, and the hunt becomes a guess.

Spend disproportionate effort here. Be aggressive, be inventive, refuse to settle for "I can sort of trigger it".

A failing test at the seam that reaches the bug is the first thing to reach for. When that is not available, or the loop you have is slow or flaky, read [`feedback-loop.md`](feedback-loop.md): ten ways to construct one, how to tighten it, how to raise the reproduction rate on a bug that fires intermittently, what to do when you truly cannot build one, and how to keep secrets out of what you capture.

**Done when you can name one command you have already run, and show its output.** That command must be:

- **Red capable**: it drives the real code path and asserts the visitor's exact symptom, so it fails now and passes once fixed. "Runs without erroring" is not a loop.
- **Deterministic**: the same verdict every run (for an intermittent bug, a pinned and high reproduction rate).
- **Fast**: seconds.
- **Yours to run**: unattended, no human clicking.

**No red command, no Step 3.** Reaching for a theory before this command exists is the exact failure this skill prevents, so if you catch yourself reading code to build one, come back here.

### Step 2: Reproduce, then minimize

Run the loop and watch it go red. Confirm three things:

- It produces the failure **the user described**, not a different one nearby. The wrong bug gets the wrong fix.
- It reproduces across runs.
- You have captured the exact symptom, so Step 6 can prove the fix addressed it.

Then shrink it to the smallest scenario that still goes red. Cut inputs, callers, config, data, and steps **one at a time**, rerunning after each cut. Done when every remaining element is load bearing: removing any one of them turns the loop green.

Two payoffs. A minimal case leaves fewer moving parts to suspect in Step 3, and it becomes the regression test in Step 6.

Narrowing the code path helps here too: bisect where good input becomes bad output, and if it is a regression, bisect history (`git bisect`, or `git log -p` on the suspect files) to find the change that introduced it. Read the actual values at the boundary rather than assuming them.

### Step 3: Hypothesize, three to five, ranked

Generate **three to five ranked hypotheses before testing any of them**. Generating one at a time anchors you on the first plausible idea, and the first plausible idea is often the symptom wearing a cause's clothes.

Each must be falsifiable, which means stating its prediction: "if the date is parsed as local time, then forcing UTC moves the cutoff by exactly the offset." A hypothesis with no prediction is a vibe. Sharpen it or drop it.

Aim at the root, not the symptom. "The value is null here" is the symptom; **why** it is null is the cause.

**Show the ranked list before you start testing.** The engineer often re ranks it instantly ("we deployed a change to number three yesterday") or has already ruled one out. Cheap, and it regularly saves the whole hunt. Proceed on your own ranking if they are away.

### Step 4: Test them one at a time

Ranked list in hand, test the top one. **Change one variable per experiment**, or the result means nothing.

- **Refuted** → discard it, take the next. Do not keep a change that did not help.
- **Confirmed** → you have the root cause. Proceed to Step 5.

Exhausted the list without a confirmation? Return to Step 2 and narrow further with what you learned.

Reach for tools in this order: a debugger or REPL where the environment supports it (one breakpoint beats ten log lines), then targeted logs at the boundary that separates two hypotheses. Logging everything and grepping is not instrumentation.

**Tag every debug log with a unique marker**, for example `[DEBUG-a4f2]`, so Step 6's cleanup is one grep. Untagged instrumentation survives into the commit; tagged instrumentation dies.

**Performance regressions take a different route.** Logs mislead. Establish a baseline measurement first (a timing harness, a profiler, a query plan), then bisect against it. Measure, then fix.

### Step 5: Fix at the root

Make the **minimal, targeted** change that addresses the proven cause. Fix why the value is null, not the null itself. Resist scope creep, no opportunistic refactors riding along. Follow the project's conventions (`AGENTS.md`, neighbouring code).

### Step 6: Verify, protect, clean up

Write the regression test **before** applying the fix, but only where a **correct seam** exists: one where the test exercises the real bug pattern as it occurs at the call site. A single caller test for a bug that needs two callers gives false confidence.

**If no correct seam exists, that is itself a finding.** Say so. The architecture is preventing this bug from being locked down, which is worth more than a test that cannot catch it. Report it, and consider `/architect`.

Where a seam exists: turn the minimized case into a failing test, watch it fail, apply the fix, watch it pass.

Then close out every item:

- The Step 1 loop, run against the **original** unminimized scenario, no longer reproduces.
- The surrounding suite passes, no regression.
- The regression test is in, or its absent seam is documented.
- Every `[DEBUG-...]` marker is gone (grep the prefix).
- Throwaway harnesses are deleted or moved somewhere clearly marked.
- **Siblings checked.** The same root cause usually hides elsewhere under the same pattern or the same bad assumption. Grep for it, then fix or report what you find.
- The confirmed hypothesis is stated in the commit message, so the next person to touch this learns what you learned.

### Optional: run it in a subagent

For a hunt that is not trivial, spawn an investigation subagent so the iterative tool use doesn't fill the main context:
- `model`: set explicitly to a strong model, do not inherit the session model (Claude Code: `sonnet`)
- `description: "Debug: <symptom>"`
- Tools: `Read`, `Bash`, `Grep`, `Glob`, `Edit`, `Write`
- `prompt`: this loop + the captured symptom + reproduction + the relevant `AGENTS.md` (inlined). Require it to report the root cause with evidence, not just "fixed it."

### Report

Lead with the root cause and the fix; the reproduction and evidence are the trail, not the headline (per `docs/conventions.md`). Template:

```
## /debug complete Â· <the bug, one line>

**Root cause: <the proven cause>. Fixed by <the minimal change, files touched>.**
Next: /test <feature>   (lock in the regression test, added inline or handed over)
Heads up: <same cause also at <where>, fixed too · or a design flaw → /architect <what>>   (omit if none)
```

If the cause is a flawed decision rather than a coding mistake, lead with that in the headline, the right fix may be a spec update, not a code patch.
