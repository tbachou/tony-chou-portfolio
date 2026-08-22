# 0007. Agent skills storage and distribution: rationale

## Context

> ⚠️ Premise note: This spec standardises how skills are stored, but the cost that actually scales is how many there are. All 36 skill descriptions load into context on every session, roughly 17 KB or about 4,300 tokens, before any work begins, and the drift surface this spec exists to fix is also proportional to skill count. Every skill family here maps to a live dependency, so nothing is plainly dead, but 10 threejs skills for one desk intro, and 76 files of `vercel-react-best-practices`, are worth a deliberate keep or drop decision. The right framing is two moves, not one: standardise storage now, which is what this spec does, and run a separate usage review to decide what earns its place. Storing 36 skills one way is strictly better than storing them five ways, but it does not make them cheaper to carry.

This repo accumulated 36 agent skills over roughly three weeks: 7 workflow skills written here, and 29 installed from public registries. They arrived through different tooling at different times, and nobody chose a storage mechanism, so five grew up side by side.

The problem is not untidiness. Two of the five produce a checkout that does not work. Five skills are committed as git symlinks pointing into `.agents/skills/`, which is gitignored, so the symlinks resolve to nothing anywhere except the machine that installed them. Two more are gitignored by name, so they are absent entirely. A fresh clone of the working branch yields 29 working skills, 5 dangling links, and 2 missing directories.

That matters more than it first appears, because a git worktree is also a fresh checkout of tracked files. The convention in this project routes isolated agents into worktrees. Worktrees are currently better off than a clone, but only because the bootstrap step in `write-agent-preamble.md` links the gitignored `.agents/skills` directory in from the main checkout, which makes the 5 symlinks resolve. That link is a workaround for this exact defect, and it does not help the 2 gitignored skills, which are absent from a worktree as well. Before that bootstrap step existed, worktrees carried the full breakage.

The forces in play. Skills are instructions agents follow, so their content is closer to executable configuration than to documentation, and an upstream change to one silently changes agent behaviour here. Agent worktrees are created frequently and must work immediately, offline, with no install step. The engineer is one person working across three repos (portfolio, Panel and Carryover), so the maintenance budget is small and anything requiring discipline to stay correct will drift. And drift has already been demonstrated at speed: `agent-brief` was written on 2026-08-21 and was missing from the hand kept `~/.claude/skills/` copy the same evening.

Not deciding leaves the repo in a state where a clone is broken, agent worktrees are quietly degraded, and the inconsistency has begun leaking into the specs themselves.

## Options considered

### Option 1: Vendor everything, enforce in CI

Commit every skill as real files. Delete `.agents/skills/` and the `.gitignore` special cases. Keep `skills-lock.json` but change its job from restoring skills to recording provenance. Add a CI check that fails when the layout drifts.

**Pros**:
- A clone and a worktree both work immediately, with no network and no install step.
- Content is pinned, so upstream cannot change agent behaviour here without a visible commit.
- Removes an entire failure class rather than documenting a rule about it.
- Matches what 24 of the 29 registry skills already do, so most of the repo needs no change.

**Cons**:
- Adds roughly 425 KB of files this repo did not author but now carries.
- Upstream fixes never arrive on their own; someone has to go looking.
- Keeps a manifest file whose name still says "lock" while it no longer locks anything.

### Option 2: Lock and restore everything

Gitignore every skill payload, keep `skills-lock.json` as the single source, restore with `npx skills` on clone and in every worktree.

**Pros**:
- Smallest possible git footprint; the repo carries a manifest rather than other people's content.
- Upstream updates are a re-install away, so staying current is cheap.
- One mechanism, uniformly applied, with no vendored copies to diverge.

**Cons**:
- Every clone and every agent worktree needs a network install before it can work, which is the opposite of what worktree bootstrapping needs.
- Restore is the fragile part: `npx skills add <repo> --skill a,b` installs nothing while printing the available list as though it succeeded, and a bare add pulls every skill in a multi-skill repo.
- The workflow skills have no registry upstream, so they would need a second mechanism regardless, leaving two again.

### Option 3: Hybrid, formalised by a written rule

Keep both mechanisms, vendor what has been modified or is depended on, lock the rest, and write the rule down in `AGENTS.md`.

**Pros**:
- Least immediate work; most of the repo already sits in one of the two states.
- Keeps the git footprint down for large upstream skills while pinning the ones that matter.
- Flexible as the mix of skills changes.

**Cons**:
- This is essentially the current state, and the current state is what broke. The absent ingredient was never flexibility, it was a rule plus something to enforce it.
- Two mechanisms means two failure modes and a judgement call on every new skill.
- A written convention is precisely what failed here: `AGENTS.md` already described the sources, and the layout drifted anyway.

### Option 4: Minimal repair, one line guard, no manifest

Fix the broken state with about three git operations (materialise the 5 symlinks, delete the 2 gitignore lines, remove `.agents/skills`), guard the symlink class with a single command such as `git ls-files -s .claude/skills | grep 120000`, and delete `skills-lock.json` rather than extending it.

**Pros**:
- Almost all of the benefit for a fraction of the work. The clone breakage is genuinely repaired.
- The one line guard catches the failure that actually happened, with nothing to maintain.
- No manifest means no reconstructing 19 upstream sources by hand, which is the single largest chunk of effort in the chosen option.

**Cons**:
- Throws away the record of where 29 vendored skills came from, so upstream updates become impossible to do deliberately and the on demand diff workflow cannot exist.
- Leaves the gitignore-by-name failure unguarded, which is the mechanism that removed 2 skills, distinct from the symlink mechanism.
- No detector for the authored skill drift that has already occurred.

## Rationale

The deciding force is that a git worktree is a fresh checkout, created often. Any mechanism that needs a network install before a checkout is usable pays that cost on every agent spawn and fails outright when the install is flaky. Option 2 optimises for a git footprint that was never the constraint, and pays for it in the place this repo is most sensitive. Option 1 makes the checkout the complete artifact, which is what both a clone and a worktree need.

The worktree bootstrap makes this concrete rather than theoretical. It currently links the gitignored `.agents/skills` directory into every worktree purely so that 5 committed symlinks resolve. That line exists only because the storage is broken; once every skill is a committed file, the link can be deleted and the bootstrap gets shorter. A standard that removes a workaround is worth more than one that documents it.

The second force is that skills are instructions, not documentation. A vendored copy pins what agents are told to do, and an upstream change becomes a commit someone reads rather than a silent behaviour shift. That argues for vendoring even where the git footprint argument is neutral.

Option 3 was rejected on evidence rather than principle. The repo already ran a hybrid, `AGENTS.md` already named the upstream sources, and the layout still fragmented into five mechanisms with two of them broken, unnoticed, for days. Adding a written rule to a situation that already had one, without adding enforcement, would repeat the experiment. This is why the CI check is part of the decision rather than a follow-up: the failure was invisible, not merely unprevented, and the cheapest fix for an invisible failure is to make it loud.

The workflow skills are extracted second rather than first because the standard should prove itself in one repo before two greenfield repos adopt it, and because portfolio is actively broken now while Panel and Carryover simply have nothing. Fixing the broken thing first is worth more than proving distribution early. The per repo overlay attaches through each repo's `AGENTS.md` rather than a new file type, because a standing convention in this project already says repo specific facts live in `AGENTS.md`, and inventing a parallel location for the same class of fact would create a second thing to keep in sync.

Option 4 is the strongest challenge to the chosen option and deserves a direct answer. Its core claim is correct: the repair itself is small, and the manifest is not automatically verifiable, because a check that makes no network calls can never compare a hash to upstream. So the manifest is not a lock file in any meaningful sense, and this spec says so plainly in Consequences rather than pretending otherwise. It is kept for two reasons the one line guard cannot supply. First, provenance for 29 files of instructions that agents follow and this repo did not write is worth recording somewhere machine readable, and prose in `AGENTS.md` was already incomplete, which is part of how the drift went unnoticed. Second, a per skill entry is what lets the check require an entry for every directory, which is what makes the gitignore-by-name failure detectable at all. The one line symlink guard catches one of the two mechanisms that broke; requiring a manifest entry catches the other. Reconstructing 19 sources by hand is real work, and it is accepted knowingly rather than waved past.

Private visibility for `claude-workflow-skills` is the reversible choice. Nothing in the skills is secret, but they carry workspace paths, a pinned Node version, and references to Beta's clinical surfaces and production gates. Private to public is a decision that can be made later after a scrub; public to private does not unpublish.

---

## Evidence: the inventory that produced this decision

Gathered 2026-08-21 and 2026-08-22 by inspecting the repo and by cloning branch `feat/grade-photo-bucket` into a temporary directory to see what a fresh checkout actually receives.

### The five mechanisms

| Mechanism | Skills | Fresh clone gets | In the lock |
|---|---|---|---|
| Workflow skills, committed real dirs | 7 | works | no |
| Registry, committed real dirs plus a duplicate ignored copy in `.agents/skills/` | 19 | works | no |
| Registry, committed real dirs only (the 2026-08-03 batch) | 3 | works | yes |
| Registry, committed as a git symlink into gitignored `.agents/skills/` | 5 | **dangling link** | yes |
| Registry, gitignored by name at `.gitignore:30-31` | 2 | **absent** | yes |

The 5 symlinked: `aws-iam`, `aws-serverless`, `codebase-design`, `terraform-style-guide`, `writing-for-agents`. The 2 gitignored: `better-auth-best-practices`, `vercel-react-best-practices`.

### What the clone test showed

A clone of the branch produced 29 usable skills of 36. The 5 symlinks were dangling; the 2 gitignored directories did not exist. Git stores those 5 as mode `120000` blobs, so the breakage travels with the repository rather than being local.

### On the lock file

`skills-lock.json` holds 11 entries. Those are exactly the 7 skills that do not survive a clone, plus the 3 vendored from the 2026-08-03 batch, plus `neon-postgres`, which is installed nowhere and is stale. The 19 skills absent from the lock are absent because they are committed and need no restoring. So the lock was never incomplete for the job it was doing; the repo simply ran two strategies with no rule for which applied. This is why the file is repurposed rather than deleted or completed.

### On duplication

All 21 pairs of `.agents/skills/<name>` and `.claude/skills/<name>` were byte identical at the time of inspection, as were the 6 workflow skills duplicated into `~/.claude/skills/`. The content had not yet diverged. The drift that had already occurred was an omission rather than an edit: `agent-brief`, written on 2026-08-21, existed only in the repo.

### On what is still in use

Every skill family maps to something live: `three`, `@react-three/fiber`, `@react-three/drei` and `@react-three/postprocessing` are dependencies of `apps/web`; `tailwindcss` and `jest` are installed; `infra/` holds 10 `.tf` files; the AWS skills back the S3 and IAM work in spec 0006. Pruning was therefore not treated as part of this decision, and is recorded as a follow-up instead.

### On portability

`write-agent-preamble.md` carries portfolio specifics that will not transfer to Panel or Carryover: `apps/api` and `apps/web` paths, the generated Prisma client location, a pinned Node 22 nvm path, the `.worktreeinclude` filenames, and the four shared files an agent scope is checked against. Its main checkout detection was made dynamic on 2026-08-21 (`git worktree list --porcelain`), which is the pattern the rest of the overlay should follow: derive what can be derived, and read the rest from the repo's own `AGENTS.md`.
