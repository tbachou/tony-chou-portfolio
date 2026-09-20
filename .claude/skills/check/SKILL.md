---
name: check
allowed-tools: Bash, Read, Grep, Glob, Write, Agent
argument-hint: "[feature or scope]"
description: "Run /check before merge to prove a change actually works: it drives the real app and confirms behavior against the spec (every acceptance criterion met, every specced surface built). Runtime proof, not a code read. Typically right after /develop. Never edits your code. For a code review of the diff, use the built-in /code-review instead."
---

## Output style (plain words, no dashes, no hyphens)

<!-- OUTPUT-STYLE:START -->
Write everything this skill produces, files and messages alike, in plain simple language. Keep technical terms that carry real meaning; explain each in plain words. Never use a dash or a hyphen as punctuation: no em dash, no en dash, and no hyphenated compounds. Write `read only`, not `read-only`. Say it in simple words, or reword the sentence. Code, file paths, command flags, and values other skills match on keep their hyphens. Use short sentences, commas, or parentheses. Clear beats clever.
<!-- OUTPUT-STYLE:END -->

## What this skill does

`/check` is runtime proof before merge: run the real app and watch the change behave. It proves the feature actually works and conforms to its spec (every acceptance criterion met, every specced surface built), which green tests never reveal. Read only on code, owns no durable files, runs on the main thread. Typically after `/develop`.

Failures route to `/debug` (a bug) or `/develop` (a surface that was never built). This skill never edits your code.

## What this skill is NOT

**It does not review code.** For a senior read of the diff, use the **built-in `/code-review`** skill, which is the better tool for that job: it takes an effort level (`/code-review high`), can post findings as inline PR comments (`--comment`), can apply them (`--fix`), and has a deep multi-agent cloud mode (`/code-review ultra`) that the user can trigger. `/predeploy-audit` already chains it at high effort as part of the deploy gate.

This skill used to carry a second `review` mode that spawned a contrasting-model reviewer. That was retired: the built-in skill does the same job better, and keeping both meant two paths to one outcome with only one of them maintained. If someone types `/check review`, say the review mode is gone and point at `/code-review` (or `/predeploy-audit` for the full pre-push gate), then offer to run the runtime check instead.

## Execution

Read `modes/verify.md` and follow it fully. Pass any argument (a feature name, a scope) through as the target.

If the argument is bare `/check` with nothing after it, target the current change set and say what you scoped to.

## Portability (any OS, any agent)

Any Agent Skills client on macOS, Linux, or Windows. `git` is the only required CLI and behaves the same everywhere; other shell snippets are POSIX reference, not literal scripts, so use your agent's own cross platform file, process, and browser tools and apply branching logic yourself. `modes/verify.md` adds its own notes on browser and HTTP driving. No subagent support falls back to running the work inline.

Bundled files live in this skill's folder: `modes/verify.md`.
