# Write agent preamble

Inline this **verbatim** into the prompt of any subagent that modifies files. Read only agents skip it entirely.

Every line here exists because it failed at least once in this repo, and none of it is discoverable by the agent on its own.

---

## Preflight, before you change anything

Run these first and report that you did. If any step fails, stop and say so rather than working around it.

**1. Confirm where you are, and report the commit you started from.** Your worktree may not be isolated even when it was requested.

```bash
pwd && git worktree list && git status --short && git log --oneline -1
```

Your base is already correct: `worktree.baseRef` is set to `head` in `.claude/settings.json`, so your worktree branches from the engineer's current HEAD rather than from the remote default branch. Do not fetch or merge to "catch up". If the commit you land on is not the one the task describes, stop and report that instead of moving your own base.

**2. Use Node 22.** Your shell comes up on Node v20.17.0, and this repo dies on Node 20 with `ERR_REQUIRE_ESM`. Sourcing nvm is refused in your sandbox, so prefix the PATH instead:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
node --version   # expect v22.x
```

**3. If this is a fresh worktree, it has no dependencies and no generated Prisma client.**

```bash
npm install
cd apps/api && DATABASE_URL="postgresql://x:x@localhost:5432/x" npx prisma generate
```

The dummy connection string is fine. Generation reads the schema and never connects.

Env files you do **not** need to create: `apps/api/.env`, `apps/web/.env.local` and `infra/terraform.tfvars` are copied into every worktree by `.worktreeinclude`. If one is missing, say so rather than writing your own.

---

## The verification bar

**A green suite is no evidence.** In one session, four tests in one module claimed invariants their bodies never exercised. The clearest: a numeric fidelity test used the value `9`, which sat outside the range the regression had opened, so it passed under the broken code and certified nothing.

**So revert and confirm, on every fix.** After the suite goes green: put the bug back deliberately, run the suite, watch a named test fail, restore the fix, run it again. **Report which test caught it, by name.** A fix with no named test behind it is unproven.

**If the pass count is identical before and after a deliberate revert, suspect the suite did not run.** A malformed import once silently skipped an entire spec file and the surviving suites looked like a clean pass.

**Live smoke test any new external integration.** A fully green suite once proved nothing because the mocks encoded the implementation's own false assumption about a response shape. When you write both the code and its mocks, the mock can only confirm the code. One real call against the real service is worth the whole suite at an integration boundary.

**Re-run the gate after a round of fixes.** Fixes to interlocking rules reliably introduce smaller versions of the bug they fix. In one session: a fix reached one of two call sites; a second stopped a false positive by opening a hole that admitted every digit 1 to 5; a third resolved a code and copy mismatch and created a copy and prompt one. Run the gate again against the new code, scoped to reviewing the fixes rather than re deriving the findings.

**Root cause, do not patch the symptom.** Reproduce it first. If you cannot explain why the fix works, you have not found the bug.

---

## Conventions that are not yours to change

- Follow the nearest `AGENTS.md` and the code beside what you are editing.
- **Prefer schema enforced structured output over prompt and parse** for any model call whose result is consumed programmatically. Forced tool use returns a deserialized object and deletes the parse failure category. This repo already does it; do not reinvent parsing.
- Commit locally **only** when the work is verified, typecheck at minimum. Prefer several small logical commits over one broad one.
- **Never push, never deploy.** Not even if it looks finished. That is the engineer's explicit call, every time.
- Do not widen your own scope. If you find something real that is out of scope, report it and leave it.

---

## What to report back

1. The commit you started from, and that the worktree check passed.
2. What you changed, by path.
3. What proved it: the gate you ran, and the named test that failed on the deliberate revert.
4. Anything you found and deliberately did not do.
