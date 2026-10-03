---
name: predeploy-audit
description: Pre-deploy gate for this public repo. Run it before pushing a branch, opening a PR, or merging anything user-facing or production-bound. Returns one hold-or-clear verdict from a publication scan, security and code review, and adversarial, Actions and clinical passes.
---

# Pre-deploy audit gate

In this repo a push publishes and a merge deploys, so the gate runs before either. The deliverable is one report and a verdict pinned to a commit; fixes, commits and pushes stay with the engineer.

## Step 0: scope, then the publication scan

**Scope.** Run `git fetch` quietly first, so `origin/main` is current. If arguments name paths, a feature or a PR, that is the scope. Otherwise it is the branch against main plus uncommitted work:

- review range: `git diff origin/main...HEAD` (what the branch adds since it forked) plus `git diff HEAD`
- commit list: `git log origin/main..HEAD`

Say which range you chose and the HEAD sha it covers.

**Publication scan (always, before anything else).** Apply the publication audit in root `AGENTS.md` (`## Git`, the PUBLIC bullet): its credential patterns and its list of personal and operational content. Run them over `git log -p origin/main..HEAD` plus `git diff HEAD`, never the net diff alone: a secret added in one commit and deleted in a later one nets to nothing in the diff, yet the push still publishes it.

Done when every pattern has run over every commit's patch, and every hit is listed with its verdict: placeholder or real.

## Step 1: built-in security review

Invoke the built-in `security-review` skill on the scope. It filters its own false positives, so its severities can hold the gate directly. Its instructions end by claiming the final reply for its report; inside this gate that report is an intermediate result, so collect it verbatim and carry on.

## Step 2: built-in code review

Invoke the built-in `code-review` skill at **high** effort on the same scope (pass the branch, path, or PR as its argument when the scope is not the current diff). At this effort it reports for recall: its findings carry no severity and nothing has verified them. So its correctness findings are **suspects**, and they go to Step 3 to be confirmed or cleared. Its cleanup suggestions ride along as notes.

## Step 2b: GitHub Actions hardening (conditional, but mandatory when it fires)

**Fires whenever the scope touches `.github/workflows/`.** Check the scope's file list for that prefix; if nothing matches, skip and say so in one line.

When it fires, invoke the `github-actions-hardening` skill on the changed workflow files. The built-in `security-review` is no stand-in for it: that skill reviews application code well, but the Actions threat model is a different one, and its dangerous constructs (a `pull_request_target` trigger running fork code, `${{ }}` interpolation of an attacker-controlled title straight into `run:`, a mutable `@v4` action reference, a `GITHUB_TOKEN` left at default write scope, `GITHUB_ENV` injection) look like ordinary YAML to a general reviewer. This repo is public, so every one of those is reachable by anyone who can open a pull request.

Collect its findings in its own severity scale; the gate table below maps them.

## Step 3: adversarial break-it pass (always, when the change has executable behavior)

Steps 1 and 2 read code and reason about it. This step tries to **break** it, and that difference is the point: reading finds what looks wrong, execution finds what is wrong. Skip only for changes with nothing to execute (docs, comments, pure config with no logic), and say so. When it is skipped, confirm or clear each Step 2 suspect yourself, by reading its cited lines against its failure scenario.

Compose the brief with `/agent-brief` at its read only weight, plus its preamble's step 2, **Use Node 22**. This agent runs code, its shell starts on Node 20, and on Node 20 this repo dies with `ERR_REQUIRE_ESM`, which comes back looking like a negative result. Name the strong model on the Agent call: this pass decides the gate. The brief must carry all five of these, because each one is load bearing:

1. **Frame it as breaking, not reviewing.** "Hunt for, and empirically confirm, inputs where this misbehaves." A review brief returns opinions; a break brief returns strings that fail.
2. **Demand empirical proof, not inspection.** The agent must actually run the code (a throwaway test file, a `tsx`/REPL script) and paste real captured output. State plainly: *reason from captured output, never from the regex, type, or signature alone.* Give it the scratchpad path for scratch files, require deletion afterwards, and require `git status --short` to be clean at exit.
3. **Seed specific attacks, then open it up.** Name the parameters worth attacking (a window size, a boundary, an ordering, a cap) and 3 to 6 concrete candidate inputs, then say "plus your own." Seeds anchor the search; the open end is where the surprises come from.
4. **Ask for negative results.** "If a suspicion did not reproduce, say so explicitly." This is what stops a padded report, and a confirmed non-issue is worth knowing.
5. **Name the suspects.** Every Step 2 correctness finding, by `file:line` and failure scenario, plus your own prime suspect if some part smells wrong. The agent confirms or clears each one by name.

Per confirmed issue: severity, the exact input, actual vs expected, `file:line`, and the minimal fix.

**When the change makes a check, guard, validation, or limit MORE permissive, this step is mandatory and the brief says so.** Loosening a constraint is where a reading-based review is weakest: the new code looks correct because it does what it says, and nobody enumerates what it now lets through. Ask directly for inputs the old code caught and the new code does not.

## Step 4: clinical safety auditor (conditional)

Only when the scope touches health-adjacent surfaces (agent prompt skill files, clinical copy, the Beta module, anything advising humans about their bodies); skip for pure infrastructure changes and say so. Brief it with `/agent-brief` at the read only weight and name the strong model, which agent-brief reserves for exactly this. It audits as a skeptical clinician plus safety engineer: what concerning presentations slip through hard-block rules; whether free text can talk a screening agent out of a structured warning sign, and whether structured red flags are blocked in code before any model call; whether prescribed exercises and dosing in prompt rules are defensible; overpromising language in UI or agent copy; disclaimer adequacy and missing stop conditions; population blind spots (age, pregnancy, medications, comorbidities); what a user sees when generation fails mid-stream. Findings split into MUST-FIX (real harm pathway) and SHOULD-CONSIDER (defensibility), each with a harm scenario, file:line evidence, and a minimal fix.

Steps 2b, 3 and 4 are independent, so start them in one message once Step 2 has returned its suspects.

## The gate

Merge all findings into one summary, ranked most severe first, MUST-FIX items on top.

| Source | Holds the push | Rides along as a note |
|---|---|---|
| Step 0 publication scan | any real credential; any personal or operational content | hits confirmed as placeholders |
| Step 1 security-review | HIGH | MEDIUM, LOW |
| Step 2 code-review | a suspect confirmed at HIGH (by Step 3, or by you when Step 3 was skipped) | suspects left unconfirmed, labelled as such; cleanup |
| Step 2b Actions hardening | CRITICAL, HIGH | MEDIUM, LOW, INFO |
| Step 3 adversarial | HIGH with a confirmed failing input | lower severities; negative results |
| Step 4 clinical | MUST-FIX | SHOULD-CONSIDER |

Anything in the middle column: **hold**, and list exactly what blocks it. Otherwise: **clear**, with the follow-ups worth scheduling. Pin the verdict to the sha it covers ("clear at `abc1234`"); a commit added after that sha is unaudited until a re-run covers it.

**A publication hold is fixed in history, not in a new commit.** The commit that carries the hit leaves the branch before any push, because a later commit that deletes it still publishes it. A credential that was already pushed gets rotated.

**Where two auditors agree independently, weight it.** Convergence from passes that did not see each other's output is the strongest signal the gate produces, and it usually marks the finding worth acting on before merge.

**A confirmed failing input becomes a test before the fix lands.** The strings the adversarial pass found are the specification: land them as cases first, then fix until they pass. Otherwise the same bypass returns the next time someone touches the file.

## After fixes: a scoped re-run

Fixes happen outside this skill (the engineer decides; `/develop` or a direct edit applies them). Then re-run on the fix range, `<the sha the verdict covered>..HEAD`, because the fix is where a rushed correction tends to introduce the next defect:

- always: Step 0, Step 2, and Step 3 when the fix is executable
- the pass that raised each fixed finding, to confirm it is gone
- Step 1 when a security finding was fixed or the fix touches auth, input handling, secrets, or a public endpoint; Step 2b and Step 4 when the fix touches their surfaces

The new verdict is pinned to the new HEAD.
