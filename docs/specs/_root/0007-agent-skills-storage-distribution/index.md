# 0007. Agent skills storage and distribution

**Date**: 2026-08-22
**Status**: Superseded by [0014](../0014-agent-skill-storage/index.md)

## Summary

> **Superseded on 2026-08-31 by [0014](../0014-agent-skill-storage/index.md).** The vendoring decision below fixed a genuinely broken checkout and its CI check still stands, but it was later found to have created the failure it was meant to prevent: two copies of each authored skill, one of which had drifted to a weaker version of a safety gate. 0014 keeps the seven authored skills committed and removes the twenty third party ones, which also closes a licensing question this spec never considered. Read this as the record of what was broken in August and why five mechanisms were replaced.

Every agent skill in this repo is committed as real files, and nothing is fetched or restored to make a checkout work. That replaces five different storage mechanisms that had grown up side by side, two of which produced a broken checkout: a fresh clone got 29 working skills, 5 dangling symlinks, and 2 skills that were simply absent. Agent worktrees fare better only because the worktree bootstrap step links the gitignored directory in, a workaround that exists solely because the storage is broken; the 2 gitignored skills are missing there too. `skills-lock.json` stays, but changes job from restoring skills to recording where each one came from, and a CI check fails the build when the layout drifts again. Separately, the 7 workflow skills move to their own private repo (`claude-workflow-skills`) so portfolio, Panel and Carryover stop keeping hand copies that silently diverge.

## Decision

**Chosen option**: Option 1: Vendor everything, enforce in CI, fix this repo before extracting the shared one.

All 36 skills are stored as committed files under `.claude/skills/`. No skill is a symlink, none is gitignored, and no install step is needed to make a checkout usable. `.agents/skills/` is deleted. `skills-lock.json` is repurposed as a provenance manifest covering all 29 registry skills. A CI job fails on any drift from that layout. The 7 workflow skills are extracted to a private `claude-workflow-skills` repo afterwards, distributed by a sync script that copies real files in, with each consuming repo supplying its own specifics through a named section in its `AGENTS.md`.

**Implementation skills**: `writing-for-agents` (`mattpocock/skills`, `.claude/skills/writing-for-agents/`) · `github-actions-templates` (`wshobson/agents`, `.claude/skills/github-actions-templates/`) · `github-actions-hardening` (`wshobson/agents`, `.claude/skills/github-actions-hardening/`)

## Standard definition

**Canonical pattern**:

```text
.claude/skills/<skill-name>/SKILL.md      real file, committed, never a symlink
.claude/skills/<skill-name>/<extras>.md   real files, committed
skills-lock.json                          one entry per registry skill (provenance, not restore)
```

**Every** skill directory has a manifest entry, including the authored ones. Two kinds, distinguished by `kind`, because nothing on disk tells a registry skill from an authored one and the check needs to know:

```json
{
  "version": 2,
  "skills": {
    "aws-iam": {
      "kind": "registry",
      "source": "aws/agent-toolkit-for-aws",
      "sourceType": "github",
      "skillPath": "skills/core-skills/aws-iam/SKILL.md",
      "computedHash": "sha256 over the skill directory, sorted paths then contents"
    },
    "agent-brief": {
      "kind": "authored",
      "source": "tonychou/claude-workflow-skills",
      "syncedCommit": "the commit this copy was synced from, or null before extraction"
    }
  }
}
```

`version` moves to `2` because the semantics changed. Authored skills carry `syncedCommit` rather than a hash, which is what makes a stale or hand edited copy detectable. That is deliberate: the copies that have actually drifted so far were authored ones, so exempting them from the manifest would leave the proven failure undetected.

**Replaces** (every one of these is now wrong):

- A skill committed as a git symlink into a gitignored directory. This left 5 dangling links in every fresh clone, and in every worktree that had not run the bootstrap link step.
- A skill gitignored by name in `.gitignore`, present only on the machine that installed it. This made 2 skills vanish from a clone and from every worktree, with no workaround available.
- A skill stored twice, once committed and once in `.agents/skills/`. Wasted disk, and two copies that can diverge.
- `skills-lock.json` used as a restore mechanism. Restoring depends on the network and on `npx skills` behaving, and the `--skill a,b` form fails silently.
- Hand copying workflow skills between this repo and `~/.claude/skills/`. This lost `agent-brief` from the global copy within hours of it being written.

**Enforcement**:

A script, `scripts/check-skills.mjs`, run in two places: locally before a commit, and in `.github/workflows/ci.yml` as the backstop. Local first is the point. CI here runs on push to main and on `pull_request`, and there is no PR flow, so a CI only check fires after drift has already reached every worktree.

It fails on any of:

1. A path under `.claude/` stored by git as a symlink (mode `120000`). Covers `.claude/agents/` and `.claude/commands/` too, so the same failure cannot reappear next door.
2. A path under `.claude/skills/` matched by a gitignore rule, tested with `git check-ignore`. Stated this way rather than "present but untracked" because a CI checkout has no untracked files, so the untracked form of this rule could never fire in the place it runs.
3. A directory under `.claude/skills/` with no `SKILL.md`.
4. A directory under `.claude/skills/` with no manifest entry, or a manifest entry naming a directory that does not exist.

All four are decidable from a plain checkout with no network, so the check cannot flake on a registry being unreachable.

**How a new registry skill is added** (this replaces the `npx skills add` instruction in `AGENTS.md`, which produces exactly the layout this standard forbids):

1. Install it into a scratch directory, not into the repo.
2. Copy the real files to `.claude/skills/<name>/`.
3. Add its manifest entry with `kind: "registry"` and the computed hash.
4. Commit. The check confirms all of the above.

**Rollout**: one migration change for this repo, because the current state is actively broken rather than merely inconsistent. That change is a single unit and must include, in this order:

1. Copy the real content of the 5 symlinked skills out of `.agents/skills/` into `.claude/skills/`, replacing the `120000` blobs.
2. Remove `.gitignore` lines 26 to 31 (the two named skills, the `.agents/skills/` rule, and the comment block that explained the symlink scheme).
3. Delete `.agents/` entirely.
4. In the same commit, remove the `.agents/skills` link from `write-agent-preamble.md` step 3, its explanatory paragraph, the mention in `agent-brief`'s `SKILL.md`, and the reference in the `.worktreeinclude` comment.
5. Extend `skills-lock.json` to all 36 skills, drop the stale `neon-postgres` entry, and bump `version` to `2`.
6. Land `scripts/check-skills.mjs` and wire it into CI.

Steps 3 and 4 cannot be separated. `.agents/skills` is both the only real copy of those 5 skills and the link target the worktree bootstrap depends on, so deleting it while the preamble still links it leaves every new worktree with a dangling link. That matters more than usual here, because this migration is exactly the kind of work that gets delegated to a worktree agent.

The shared repo extraction follows afterwards, once the standard holds here.

**Exceptions**: none for `.claude/skills/`. A skill that cannot be committed does not belong there. Any file type is allowed inside a skill (scripts, images, reference data), as long as it is committed and is not a symlink. The manifest rules apply to `.claude/skills/` only; the symlink rule applies to all of `.claude/`.

**Distribution of the workflow skills** (the second phase):

`claude-workflow-skills` is private, so it holds a `sync.mjs` run from a consuming repo's root against a local checkout of it. Node, because every repo here already requires Node 22, and no npm publish is involved. The script is committed to the skills repo only, never to consumers.

Its behaviour, so a builder is not inventing it:

- One way only, skills repo to consumer. It never reads changes back.
- Refuses to run when the consumer has uncommitted changes under `.claude/skills/`, so a sync can never silently bury local edits.
- Overwrites matching files, prunes files deleted upstream, and writes each skill's `syncedCommit` into the consumer's manifest.
- Authentication is the engineer's existing SSH access to the private repo, used once at clone time. CI never reaches it, because the skills are committed in each consumer.

Each consuming repo supplies its own specifics through a `## Agent worktree facts` section in its root `AGENTS.md`, as a flat key and value list so a script or skill can read it rather than parse prose. Required keys: the paths to link into a worktree, the generated client path if any, the Node version, the files carried by `.worktreeinclude`, and the shared files a parallel agent's scope is checked against. A generic skill that finds the section missing stops and says so rather than guessing.

All 7 skills move. `agent-brief` and `predeploy-audit` carry portfolio specifics today, and those specifics are exactly what the overlay section is for, so they move with their repo bound facts relocated rather than staying behind.

## Consequences

**Positive**:

- A fresh clone and a fresh agent worktree both get all 36 skills working, with no install and no network.
- Skill content is pinned. An upstream edit cannot silently change how agents here behave, which matters because skills are instructions agents follow.
- The `.agents/skills` link in the agent worktree bootstrap becomes unnecessary, so `write-agent-preamble.md` loses a step.
- Provenance becomes machine checkable rather than prose in `AGENTS.md` that was already incomplete.
- Two of the five mechanisms disappear entirely, along with the `.gitignore` special cases that encoded them.

**Negative / tradeoffs**:

- Roughly 425 KB of new files enter git, most of it `vercel-react-best-practices` at 76 files. Small in absolute terms, but it is content this repo did not author and now maintains.
- Upstream updates become a deliberate act. Nothing arrives automatically, so a genuinely useful upstream fix can sit unnoticed indefinitely.
- The sync script is new surface to maintain, and it exists only because `npx skills` produces the symlink layout this standard forbids.
- Deleting the `~/.claude/skills/` copies means the workflow skills are unavailable outside the three repos that vendor them.

- The manifest buys less than its name suggests. Because the check makes no network calls, `computedHash` is never compared against upstream automatically. It is provenance for a human, plus the input to the deliberate on demand diff. Calling it a lock file oversells it; it is a documentation file that happens to be JSON and happens to be machine checkable for presence, not for freshness.
- Enforcing locally as well as in CI means a check that can be skipped. A local gate is only as good as the habit, and the CI backstop still fires after the fact.

**Neutral**:

- This does not reduce what skills cost per session. All 36 descriptions load into context on every run, roughly 17 KB or about 4,300 tokens, and that number scales with skill count regardless of how the files are stored. See the premise note in `rationale.md`.
- `skills-lock.json` keeps its filename while changing purpose and schema (`version` 2), so anything reading it as a restore manifest needs to be told otherwise.
- Deleting `~/.claude/skills/` is a manual step outside any repo, so it cannot be scripted or checked from inside one. It belongs to the extraction phase and stays the engineer's to do.

## Follow-up

- [ ] Run a keep or drop pass on the 36 skills. Every family maps to a live dependency, so nothing is obviously dead, but 10 threejs skills for one desk intro and 76 files of `vercel-react-best-practices` deserve a deliberate decision. This is a separate review, not part of this migration.
- [ ] Reconcile the skill paths cited in existing specs. Spec 0002 cites `.agents/skills/better-auth-best-practices/` while 0006 cites `.claude/skills/better-auth-best-practices/` for the same skill, so the inconsistency has already leaked into the record.
- [ ] Reconstruct `source` and `skillPath` for the 19 registry skills that have no manifest entry. Those values are not recoverable from disk; root `AGENTS.md` and the workspace `AGENTS.md` files name most of the upstreams, and anything still unknown is recorded as `source: "unknown"` rather than guessed.
- [ ] Consider whether `predeploy-audit`'s clinical gate references need scrubbing before `claude-workflow-skills` could ever be made public. Not blocking while it stays private.

Dropped from this list because the rollout now covers them: the stale `neon-postgres` entry (CI rule 4 would fail on it the moment the check lands, so it goes in the migration), and the `.agents/skills` link in `write-agent-preamble.md` (it must be removed in the same commit that deletes the directory).

## Rationale

Reasoning, the options weighed, and the full inventory evidence: see [rationale.md](rationale.md).
