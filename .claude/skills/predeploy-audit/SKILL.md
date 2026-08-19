---
name: predeploy-audit
description: Run /predeploy-audit before pushing to main. Chains the built-in security-review and code-review skills over the pending changes, adds a clinical safety auditor when the change touches health-adjacent surfaces, and merges everything into one hold-or-clear verdict. Critical or High findings, or any clinical MUST-FIX, mean hold the push.
---

# Pre-deploy audit gate

The gate chains two built-in skills plus one custom auditor, then merges their findings into a single verdict. This skill never edits code, never commits, and never pushes; the deliverable is the combined report and a hold or clear verdict.

## Scope resolution

1. If arguments name paths or a feature, that is the scope.
2. Otherwise the pending changes: `git log origin/main..HEAD --name-only` for unpushed work; if nothing is unpushed, the most recent feature commits (say which range you chose).

## Step 1 — built-in security review

Invoke the built-in `security-review` skill (via the Skill tool). It reviews the pending changes on the current branch for security issues. Collect its findings verbatim.

## Step 2 — built-in code review

Invoke the built-in `code-review` skill at **high** effort on the same target (pass the branch, path, or PR as its argument when the scope is not the current diff). Collect its findings; the correctness findings feed the gate, and its cleanup suggestions ride along as non-blocking notes.

## Step 3 — clinical safety auditor (conditional)

Only when the scope touches health-adjacent surfaces (agent prompt skill files, clinical copy, the Beta module, anything advising humans about their bodies); skip for pure infrastructure changes and say so. Spawn a read-only `general-purpose` agent briefed to audit as a skeptical clinician plus safety engineer: what concerning presentations slip through hard-block rules; whether free text can talk a screening agent out of a structured warning sign, and whether structured red flags are blocked in code before any model call; whether prescribed exercises and dosing in prompt rules are defensible; overpromising language in UI or agent copy; disclaimer adequacy and missing stop conditions; population blind spots (age, pregnancy, medications, comorbidities); what a user sees when generation fails mid-stream. Findings split into MUST-FIX (real harm pathway) and SHOULD-CONSIDER (defensibility), each with a harm scenario, file:line evidence, and a minimal fix.

## The gate

Merge all findings into one summary, ranked most severe first, MUST-FIX items on top. Verdict rules:

- Any Critical or High finding from either built-in review, or any clinical MUST-FIX: **hold the deploy**, list exactly what blocks it.
- Only Medium and below: **clear to deploy**, list the follow-ups worth scheduling.

Fixes happen outside this skill (the engineer decides; `/develop` or a direct edit applies them). Re-run the gate after fixes land.
