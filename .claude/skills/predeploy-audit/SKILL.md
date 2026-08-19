---
name: predeploy-audit
description: Run /predeploy-audit before pushing to main. Spawns two parallel read-only adversarial auditors — a security auditor (abuse, cost, privacy, injection) and a clinical safety auditor (medical harm pathways in health-adjacent features) — over the pending changes or a named area, and reports ranked findings without editing anything. The deploy gate: Critical or High findings mean hold the push.
---

# Pre-deploy audit gate

Two adversarial auditors run in parallel as read only subagents and report findings. This skill never edits code, never commits, and never pushes; the deliverable is the combined report and a hold or clear verdict.

## Scope resolution

1. If arguments name paths or a feature, audit those.
2. Otherwise: `git log origin/main..HEAD --name-only` for unpushed work; if nothing is unpushed, use the diff of the last push (`git diff HEAD~N` for the most recent feature commits) and say which range you chose.
3. Always include, regardless of diff: any file the changed code imports for auth, rate limiting, IP handling, or database writes.

## The auditors

Spawn BOTH as parallel `general-purpose` agents, read only (no edits, no commits, no destructive commands, never hit production, never trigger paid AI pipeline runs).

**Auditor 1 — security.** Brief it to attack like an abuser of a public, unauthenticated endpoint fronting a paid API. Angles it must cover, adapted to the scope, plus its own: rate limit integrity behind the deployment proxy (trust proxy and header spoofing, identity rotation against in-memory and persisted caps); cost abuse paths that reach the paid API without counting, including races at cap boundaries and cheap-call loops at scale; the privacy invariant (prove no code path writes or logs user-submitted content — check every logger call and every DB write reachable from the scope; check client-side storage too); input validation completeness at the boundary and anything reaching a prompt uncapped; stream or response framing injection via user content; LLM-proxy freeloading (turning a scoped agent into a general one) and its blast radius in tokens; secrets handling, error message leakage, CORS posture; client-side rendering of model output (no innerHTML paths, safe link attributes).

**Auditor 2 — clinical safety.** Only when the scope touches health-adjacent surfaces (agent prompts, clinical copy, the Beta module, anything advising humans about their bodies); skip it for pure infrastructure changes and say so. Brief it to audit as a skeptical clinician plus safety engineer: what concerning presentations slip through the hard-block rules; whether free text can talk a screening agent out of a structured warning sign, and whether structured red flags should be blocked in code before any model call; whether prescribed exercises and dosing in the prompt rules are defensible; overpromising language anywhere in UI or agent copy; disclaimer adequacy and missing stop conditions; population blind spots (age, pregnancy, medications, comorbidities) the copy should name; what a user sees when generation fails mid-stream. Findings split into MUST-FIX (real harm pathway) and SHOULD-CONSIDER (defensibility).

Both auditors deliver: findings ordered by severity with a concrete scenario, file:line evidence, and a specific minimal fix each; one line acknowledgments where a layer is solid; a three sentence verdict.

## The gate

Synthesize both reports into one summary for the engineer: findings merged and ranked, MUST-FIX items first. Verdict rules:

- Any Critical or High security finding, or any clinical MUST-FIX: **hold the deploy**, list exactly what blocks it.
- Only Medium and below: **clear to deploy**, list the follow-ups worth scheduling.

Fixes happen outside this skill (the engineer decides; `/develop` or a direct edit applies them). Re-run the gate after fixes land.
