# Building a feedback loop that goes red

Reference for Step 1, reached when the obvious loop (a failing test) is not available or not tight enough. Adapted 2026-08-21 from `mattpocock/skills` `diagnosing-bugs` (MIT).

## Ten ways to build one, in rough order of preference

1. **Failing test** at whatever seam reaches the bug: unit, integration, end to end.
2. **Curl or HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing output against a known good snapshot.
4. **Headless browser script** (Playwright, Puppeteer) driving the UI and asserting on the DOM, the console, or the network.
5. **Replay a captured trace.** Save a real request, payload, or event log to disk and replay it through the code path in isolation.
6. **Throwaway harness.** Spin up the smallest subset of the system that reaches the bug in one function call.
7. **Property or fuzz loop.** For "sometimes wrong output", run a thousand generated inputs and watch for the failure mode.
8. **Bisection harness.** If it appeared between two known states (a commit, a dataset, a version), automate "boot at state X, check, repeat" so `git bisect run` can drive it.
9. **Differential loop.** Run one input through two versions or two configs and diff the outputs.
10. **Human in the loop script.** Last resort, when a person must click. Script the prompts so the loop stays structured and the captured output still comes back to you.

## Tighten it

Treat the loop as a product, not scaffolding. Once you have one, make it tight:

- **Faster.** Cache setup, skip unrelated init, narrow the scope.
- **Sharper.** Assert the exact symptom, not "it did not crash".
- **More deterministic.** Pin the clock, seed the random source, isolate the filesystem, freeze the network.

A loop that takes thirty seconds and flakes is barely better than none. A two second deterministic one is the difference between a hunt and a procedure.

## Bugs that do not reproduce every time

The goal is a higher reproduction rate, not a clean single case. Loop the trigger a hundred times, run them in parallel, add load, narrow the timing window, inject sleeps. A bug that fires half the time is debuggable. One that fires one time in a hundred is not, so keep raising the rate until it is.

## When you genuinely cannot build one

Say so plainly and list what you tried. Then ask for exactly one of:

- access to an environment where it reproduces,
- a captured artifact (a HAR file, a log dump, a core dump, a screen recording with timestamps),
- permission to add temporary instrumentation to the environment where it happens.

Ask rather than guess. A fix aimed at a bug you never saw fail is a guess wearing a diff.

## Secrets

This step produces commands, output, and captured artifacts, and those carry credentials. Replace every secret with `<REDACTED>` before showing anything. Build loops against environment variables so the credential stays in the environment rather than in the transcript. Captured traces carry auth headers: quote only the lines that carry the signal.
