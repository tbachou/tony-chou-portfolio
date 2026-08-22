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

## Step 1b: Isolate by collision, not by whether it writes

Isolation is not free. A worktree starts with tracked files only, so it needs the preamble's link step before it can do anything, and it leaves build output behind when it goes. Pay that only when two agents would actually fight.

- **Read only, or one writer at a time**: main tree, no isolation.
- **Several writers whose file scopes you can state and that do not overlap**: main tree, no isolation. They get the real dependencies, env, Prisma client and skills with no setup at all.
- **Writers that would touch the same file**: `isolation: "worktree"` for each, and the preamble's link step.

In this repo the genuinely shared files are few, and they are what to check a scope against:

| File | Why it collides |
|---|---|
| `apps/api/prisma/schema.prisma` | every model change lands here |
| `apps/api/src/app.module.ts` | every new module registers here |
| `package-lock.json` | any dependency change rewrites it |
| the four `AGENTS.md` files | any convention change edits one |

Everything above those in edit frequency is feature local (`beta.service.ts`, `terminal.css`, `BetaPlanner.tsx`), which is the shape that parallelizes safely. One agent per module does not collide. Two agents both registering a module do.

**A worktree isolates tracked files and nothing else.** `node_modules`, the generated Prisma client and `.git/info/exclude` are shared by link, and the dev database is shared outright. So a dependency change, a migration, or anything that writes to the dev database cannot be made safe by isolating it. Those run in the main tree, one at a time.

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
| "the file I was asked to fix does not exist" | seeded from a stale base | `worktree.baseRef` is `head` in `.claude/settings.json`; if this recurs, check it is still set |
| a missing `.env`, `DATABASE_URL` or AWS credential | worktree carries tracked files only | `.worktreeinclude` at the repo root; add the path to it |
| `Cannot find module '../../generated/prisma/client'` | fresh worktree, nothing linked yet | the preamble's link step |
| a dependency appeared in the engineer's main checkout | an agent ran `npm install` through the shared link | the preamble forbids it; dependency changes are the engineer's |
| an `ERR_REQUIRE_ESM` or a Node version error | the agent shell is Node 20 | the preamble's PATH prefix |
| the suite went green and the bug survived | the test never exercised the invariant | the preamble's revert and confirm |
| two agents fought over one file | worktree isolation silently failed | verify `git worktree list` before trusting it |
