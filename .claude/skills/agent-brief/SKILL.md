---
name: agent-brief
allowed-tools: Bash, Read, Grep, Glob
description: "Compose a subagent's prompt before spawning it. Use when delegating work to an Agent, spawning a scout, builder, reviewer or auditor, or when a spawned agent came back with 'the file does not exist', a missing node_modules, a Node 20 error, or a green suite that proved nothing."
---

## Output style (plain words, no dashes, no hyphens)

<!-- OUTPUT-STYLE:START -->
Write everything this skill produces, files and messages alike, in plain simple language. Keep technical terms that carry real meaning; explain each in plain words. Never use a dash or a hyphen as punctuation: no em dash, no en dash, and no hyphenated compounds. Write `read only`, not `read-only`. Say it in simple words, or reword the sentence. Code, file paths, command flags, and values other skills match on keep their hyphens. Use short sentences, commas, or parentheses. Clear beats clever.
<!-- OUTPUT-STYLE:END -->

## What this skill does

Turns a task into a brief a subagent can actually execute here. It exists because the same handful of failures repeat, every one of them caused by something the agent could not have known and the orchestrator forgot to say. Those facts belong in the brief automatically, not in whoever is orchestrating remembering to paste them.

**This is a composition step, not a workflow.** It produces the prompt. Spawning stays with the caller.

## Step 1: Size the brief to the work, not to the risk

A deletion task once got a full verification protocol (fresh worktree, install, browser checks, screenshots) and ran ten minutes for four minutes of editing while the engineer waited and asked twice. Heavy verification is right for logic on a clinical surface and wrong for removing a component.

Pick the weight first:

- **Read only** (scout, finder, researcher, auditor): no preflight, no git, no verification bar. Just the question and the return shape.
- **Write** (builder, fixer, refactorer): everything in [`write-agent-preamble.md`](write-agent-preamble.md), inlined into the prompt verbatim.

## Step 2: Pick the model explicitly

Never let a subagent inherit the session model. State it on the Agent call.

- `haiku` for mechanical work with a checkable answer.
- `sonnet` for scouts, finders, researchers, builders and doc fixers. This is the default.
- The session's strong model **only** for: clinical safety audits, final gate verdicts, and any judgment whose wrong answer ships to production unreviewed.

## Step 3: Write the task so completion is checkable

State the finish line as something the agent can test, not something it can feel. "Every modified model accounted for" forces the work that "produce a change list" does not.

Name the return shape. A scout returns a compact map of paths and `file:line` pointers, never file contents. A builder reports what it changed and what proved it.

Point at the convention rather than describing it. When several agents build sibling features in one batch, name the existing pattern in each brief: one agent reinvented prompt and parse while the repo four files away already used forced tool calls, and shipped a broken classifier.

## Step 4: Fix the scope before you spawn

Do **not** widen an agent's scope by message mid run. It makes completion time unpredictable for the person waiting, which is the whole reason the work was delegated.

If the scope was wrong, let it finish or stop it, then spawn again with the corrected brief.

## Step 5: Assemble

```
<the task, with its checkable finish line>
<the return shape>
<the conventions to follow, by name and path>

[write agents only: the whole of write-agent-preamble.md, verbatim]
```

Report the brief you composed and the model you chose, then hand it to the caller to spawn.

## When an agent comes back wrong

Match the symptom before re assigning blame:

| Symptom | Cause | Fix |
|---|---|---|
| "the file I was asked to fix does not exist" | seeded from a stale base | the preamble's base check |
| `Cannot find module '../../generated/prisma/client'` | fresh worktree, no install, no generated client | the preamble's install step |
| an `ERR_REQUIRE_ESM` or a Node version error | the agent shell is Node 20 | the preamble's PATH prefix |
| the suite went green and the bug survived | the test never exercised the invariant | the preamble's revert and confirm |
| two agents fought over one file | worktree isolation silently failed | verify `git worktree list` before trusting it |
