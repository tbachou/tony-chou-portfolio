---
name: predeploy-audit
description: Run /predeploy-audit before pushing to main. Chains the built-in security-review and code-review skills over the pending changes, adds an adversarial break-it pass and a clinical safety auditor, and merges everything into one hold-or-clear verdict. Critical or High findings, any adversarial HIGH, or any clinical MUST-FIX mean hold the push.
---

# Pre-deploy audit gate

The gate chains two built-in skills plus two adversarial auditors, then merges their findings into a single verdict. This skill never edits code, never commits, and never pushes; the deliverable is the combined report and a hold or clear verdict.

## Scope resolution

1. If arguments name paths or a feature, that is the scope.
2. Otherwise the pending changes: `git log origin/main..HEAD --name-only` for unpushed work; if nothing is unpushed, the most recent feature commits (say which range you chose).

## Step 1 — built-in security review

Invoke the built-in `security-review` skill (via the Skill tool). It reviews the pending changes on the current branch for security issues. Collect its findings verbatim.

## Step 2 — built-in code review

Invoke the built-in `code-review` skill at **high** effort on the same target (pass the branch, path, or PR as its argument when the scope is not the current diff). Collect its findings; the correctness findings feed the gate, and its cleanup suggestions ride along as non-blocking notes.

## Step 3 — adversarial break-it pass (always, when the change has executable behavior)

Steps 1 and 2 read code and reason about it. This step tries to **break** it, and that difference is the point: reading finds what looks wrong, execution finds what is wrong. Skip only for changes with nothing to execute (docs, comments, pure config with no logic); say so when skipping.

Spawn a read-only `general-purpose` agent briefed to attack the change, not to review it. The brief must carry all five of these, because each one is load bearing:

1. **Frame it as breaking, not reviewing.** "Hunt for, and empirically confirm, inputs where this misbehaves." A review brief returns opinions; a break brief returns strings that fail.
2. **Demand empirical proof, not inspection.** The agent must actually run the code — a throwaway test file, a `tsx`/REPL script — and paste real captured output. State plainly: *do not reason from the regex/type/signature alone.* Give it the scratchpad path for scratch files, require deletion afterwards, and require `git status --short` to be clean at exit.
3. **Seed specific attacks, then open it up.** Name the parameters worth attacking (a window size, a boundary, an ordering, a cap) and 3 to 6 concrete candidate inputs, then say "plus your own." Seeds anchor the search; the open end is where the surprises come from.
4. **Ask for negative results.** "If a suspicion did not reproduce, say so explicitly." This is what stops a padded report, and a confirmed non-issue is worth knowing.
5. **Name your own prime suspect.** If some part smells wrong, say which and why. Pointing the agent at it is cheap and it is often right.

Per confirmed issue: severity, the exact input, actual vs expected, `file:line`, and the minimal fix.

**When the change makes a check, guard, validation, or limit MORE permissive, this step is mandatory and the brief says so.** Loosening a constraint is where a reading-based review is weakest: the new code looks correct because it does what it says, and nobody enumerates what it now lets through. Ask directly for inputs the old code caught and the new code does not.

## Step 4 — clinical safety auditor (conditional)

Only when the scope touches health-adjacent surfaces (agent prompt skill files, clinical copy, the Beta module, anything advising humans about their bodies); skip for pure infrastructure changes and say so. Spawn a read-only `general-purpose` agent briefed to audit as a skeptical clinician plus safety engineer: what concerning presentations slip through hard-block rules; whether free text can talk a screening agent out of a structured warning sign, and whether structured red flags are blocked in code before any model call; whether prescribed exercises and dosing in prompt rules are defensible; overpromising language in UI or agent copy; disclaimer adequacy and missing stop conditions; population blind spots (age, pregnancy, medications, comorbidities); what a user sees when generation fails mid-stream. Findings split into MUST-FIX (real harm pathway) and SHOULD-CONSIDER (defensibility), each with a harm scenario, file:line evidence, and a minimal fix.

Steps 3 and 4 are independent and both read-only, so run them concurrently in one message.

## The gate

Merge all findings into one summary, ranked most severe first, MUST-FIX items on top. Verdict rules:

- Any Critical or High finding from either built-in review, any adversarial HIGH with a confirmed failing input, or any clinical MUST-FIX: **hold the deploy**, list exactly what blocks it.
- Only Medium and below: **clear to deploy**, list the follow-ups worth scheduling.

**Where two auditors agree independently, weight it.** Convergence from passes that did not see each other's output is the strongest signal the gate produces, and it usually marks the finding worth acting on before merge.

**A confirmed failing input becomes a test before the fix lands.** The strings the adversarial pass found are the specification: land them as cases first, then fix until they pass. Otherwise the same bypass returns the next time someone touches the file.

Fixes happen outside this skill (the engineer decides; `/develop` or a direct edit applies them). Re-run the gate after fixes land — including on the fix itself, which is where a rushed correction tends to introduce the next defect.
