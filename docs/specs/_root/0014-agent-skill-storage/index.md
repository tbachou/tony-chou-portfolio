# 0014. Agent skill storage: authored in the repo, vendored nowhere

**Date**: 2026-08-31
**Status**: Accepted

**Supersedes** [0007. Agent skills storage and distribution](../0007-agent-skills-storage-distribution/index.md).

## Summary

The seven workflow skills Tony wrote stay committed in this repo, and the twenty installed from public sources leave it. Third party skill content is installed once per machine into the user level skills directory instead, and the repo keeps only a list of which ones it expects. The authored skills are reached from other repos by a symlink in the home directory pointing at this one, so exactly one copy of each exists on disk and the two copies can no longer disagree. This removes roughly 1.6 MB of other people's content from a public repository, closes the question of redistributing it, and fixes a drift that had already made a safety check quietly weaker than it looked.

## Rationale

Reasoning, evidence, and the options weighed: see [rationale.md](rationale.md).

## Standard definition

**Canonical pattern**:

```text
.claude/skills/<authored-skill>/SKILL.md   real committed files, one per authored skill
skills-lock.json                           the install list: every skill, authored and registry
~/.claude/skills/<authored-skill>          a symlink into this repo, made once per machine
~/.claude/skills/<registry-skill>/          installed by npx skills, never committed anywhere
```

Two kinds of skill, two homes, decided by who wrote it:

| Kind | Lives in | Why |
|---|---|---|
| **Authored** (7): `architect`, `develop`, `check`, `audit`, `debug`, `predeploy-audit`, `agent-brief` | committed in `.claude/skills/` | Tony's own work. Version control, history, and a backup are worth having, and there is no licensing question about your own content. |
| **Registry** (20): everything installed from a public source | `~/.claude/skills/` only, per machine | Someone else's content. The repo records that it expects them and nothing more. |

The count is twenty, not the nineteen the manifest appears to hold. `react-markdown` carries **no `kind` field at all**, which is why it is easy to miscount, and it is vendored on disk from `mikkelkrogsholm/dev-skills`. An entry with no `kind` is the same failure this standard exists to prevent, arriving by omission rather than by a wrong value, which is why the enforcement below fails closed on it.

**Reaching the authored skills from other repos.** A symlink in the home directory points at this repo:

```bash
ln -s ~/source/portfolio/.claude/skills/architect ~/.claude/skills/architect
```

One copy exists on disk, so the two cannot drift. This is not the practice 0007 banned: that banned symlinks **committed into git**, which left dangling links in every fresh clone. A link in a home directory is outside git entirely and no clone ever sees it.

Be precise about what the symlink is for, because getting this wrong is how someone deletes something they needed. **Inside this repo and every one of its git worktrees, the authored skills arrive through git**, from the checkout's own `.claude/skills/`. The symlink plays no part there and is not what makes worktrees work. It exists for exactly one reason: so that OTHER repositories on the same machine, Panel and Carryover, can reach these skills without keeping a copy.

It also moves a coupling rather than removing one. 0007's committed symlinks broke fresh clones; this one breaks if the repo moves, and now two other repositories depend on this one staying where it is. That is a better trade, not a free one.

**`skills-lock.json` becomes the install list**, at `version: 3`. `computedHash` is dropped, because there is nothing on disk to hash for a registry skill and hashing an authored skill that git already versions adds nothing.

```json
{
  "version": 3,
  "skills": {
    "architect":      { "kind": "authored", "source": "tonychou/claude-workflow-skills", "syncedCommit": null },
    "aws-iam":        { "kind": "registry", "source": "aws/agent-toolkit-for-aws" },
    "react-markdown": { "kind": "registry", "source": "mikkelkrogsholm/dev-skills" }
  }
}
```

`skillPath` is dropped along with `computedHash`. It recorded where the file sat inside the source repository, which mattered when the file was being copied in and means nothing now. What a new machine actually needs is the source plus one skill name per install, and the manifest key IS that name:

```bash
npx skills add <source> --skill <manifest key> -y
```

One `--skill` per invocation, never a comma separated list and never a bare `add <source>`. Both traps are recorded in the root `AGENTS.md`: a bare add installs every skill in a multi skill repository, and `--skill a,b` installs nothing while printing the available list as though it worked. Two entries here already share one source (`wshobson/agents`), so this is not hypothetical.

**Replaces** (each is now wrong):

- Vendoring a registry skill's files into `.claude/skills/`. It puts another project's content into a public repository with no attribution and no licence file carried across, and it grew the tree to 2.1 MB.
- Copying an authored skill so that both the repo and `~/.claude/skills/` hold one. Two copies drift, and one already had.
- `computedHash` in the manifest as a provenance record. It was never compared against upstream automatically, so it documented a number nobody checked.

**Enforcement**:

`scripts/check-skills.mjs`, still run locally and in CI. Two of its rules change, and the change is not cosmetic: as written today the script would fail **permanently** after this migration, because its entry side check fails on any manifest entry with no matching directory, which is precisely the state every registry entry is meant to be in.

The five rules after this standard:

1. No path under `.claude/` stored by git as a symlink (mode `120000`). Unchanged.
2. No path under `.claude/skills/` matched by a gitignore rule. Unchanged.
3. Every directory under `.claude/skills/` has a `SKILL.md`. Unchanged.
4. Every directory under `.claude/skills/` has a manifest entry (unchanged), and **every manifest entry whose `kind` is `authored` or `vendored` has a directory**. This is the half that must change: it no longer fires for `kind: "registry"`, whose entries deliberately have no directory.
5. A manifest entry with `kind: "registry"` must **not** have a directory under `.claude/skills/`. This catches the regression that prompted this spec: running `npx skills add` inside the repo puts the files back, and this fails the build when it does.

**`kind` must be present and one of `authored`, `registry`, `vendored`.** A missing or unrecognised value is a failure, not a skip. Rule 5 is a test on a value, so an entry with no `kind` would otherwise satisfy it while holding vendored third party content, which is exactly the state `react-markdown` is in today.

All five stay decidable from a plain checkout with no network, so the check cannot flake and works on a fork pull request.

**Rollout**: a single migration change. Two steps can destroy something irreplaceable if taken in the wrong order or on an assumption, so both are stated as procedures rather than intentions.

1. **`agent-brief` stays repo only.** It exists nowhere else on the machine, and whether it should also exist globally is genuinely undecided (see Follow-up). The default is therefore to do nothing with it, stated explicitly so that "do nothing" is a decision rather than an omission. Nothing about it is deleted by this rollout.
2. **Reconcile each authored skill before touching it**, rather than assuming the repo copy is current. For each of the seven:

   ```bash
   diff -r ~/.claude/skills/<name> .claude/skills/<name>
   ```

   Identical, or no global copy: proceed. **Different: the global copy may be the newer one**, and it was for `predeploy-audit`, whose repo copy is 34 lines against a global 56 that carries the adversarial pass. Move the newer content into the repo and commit it BEFORE step 3 replaces the global copy with a link, or the link overwrites the good version with the stale one.
3. Replace each reconciled global copy with a symlink into this repo:

   ```bash
   rm -rf ~/.claude/skills/<name> && ln -s "$PWD/.claude/skills/<name>" ~/.claude/skills/<name>
   ```

4. **Install each registry skill globally, verify it landed, and only then delete the committed copy.** Per skill, in this order, because deleting first reintroduces the silently absent failure 0007 recorded:

   ```bash
   npx skills add <source> --skill <name> -y
   test -f ~/.claude/skills/<name>/SKILL.md || echo "NOT INSTALLED: <name>"
   git rm -r .claude/skills/<name>
   ```

   Twenty skills, `react-markdown` included.
5. Rewrite `skills-lock.json` to the shape above: drop `computedHash` and `skillPath`, give `react-markdown` its missing `kind`, bump `version` to `3`.
6. Update `scripts/check-skills.mjs`: branch rule 4's entry side on `kind`, add rule 5, and fail on a missing or unrecognised `kind`.

Steps 4 and 6 must land together. Between them the manifest describes registry entries with no directories, which the current check rejects, so a commit that does one without the other leaves CI red.

**Exceptions**: a registry skill whose upstream is unavailable, unmaintained, or which needs a local modification may be vendored, with the reason recorded in its manifest entry. That is an escape hatch for a real dead end, not a preference; the entry is `kind: "vendored"` so rule 5 does not fire and so the exception is visible rather than silent.

## Consequences

**Positive**:

- Roughly 1.6 MB of third party content leaves a public repository, and with it the question of redistributing another project's files without attribution or a licence.
- The authored skills cannot drift, because the symlink means one copy exists rather than two that must be kept equal.
- The manifest stops claiming a guarantee it never provided. `computedHash` was never compared to upstream, so calling it provenance oversold it.
- A pull request that adds a skill is now readable. The change that prompted this was 78 vendor files against 16 authored ones.
- Upstream fixes to a registry skill arrive on the next install rather than never.

**Negative / tradeoffs**:

- **A fresh machine no longer works immediately.** 0007's central win was that a fresh clone and a fresh worktree needed no install and no network. That still holds for the authored skills, which stay committed, and is given up for the registry twenty. The install is once per machine rather than once per worktree, because `~/.claude/skills/` is user level, which is why this is affordable.
- Registry skill content is no longer pinned. An upstream edit changes how an agent behaves the next time it is installed, and nothing here would show that in a diff. The manifest records the source, not the content.
- The home directory symlinks tie this machine's global skills to this repo staying at a known path. Moving or deleting the repo breaks them, and Panel and Carryover would depend on it too.
- The authored skills still have exactly one home, this repo, so they are backed up only as well as this repo is. Extracting them to their own repo remains worth doing and is not done here.

**Neutral**:

- This does not change what skills cost per session. Every installed skill's description loads whether the files sit in the repo or in the home directory, so the context cost is a function of how many are installed, not where they live.
- `skills-lock.json` keeps its filename while changing purpose again, so `version` moves to `3`.
- CI is unaffected in substance. It never needed a skill: it runs typechecks, lint and tests, and the only reason it touches skills at all is the layout check.

## Follow-up

- [ ] Extract the seven authored skills to their own repository, so this portfolio is not the only backup of tooling used by three repos. 0007 planned this as `claude-workflow-skills`; it remains undone and this spec does not do it.
- [ ] Decide whether `agent-brief` should exist globally at all. It is currently the one authored skill with no global copy, which may be deliberate.
- [ ] Check the licences of the twenty registry skills before any future vendoring exception is taken. None were checked when they were originally committed.
- [ ] The `## Agent skills` sections in the root and workspace `AGENTS.md` files describe skills as installed in `.claude/skills/`. `/sync` should reconcile them with this standard.

## References

**Project sources**:
- [0007. Agent skills storage and distribution](../0007-agent-skills-storage-distribution/index.md), the standard this replaces, and its record of the five mechanisms that produced a broken checkout.
- `skills-lock.json`, which already separates `kind: "authored"` from `kind: "registry"` and so already carried the distinction this standard acts on.
- `scripts/check-skills.mjs`, the existing enforcement.

**Practices and standards**:
- Do not redistribute another project's content from a public repository without deliberately checking its licence.
- One copy of a thing, rather than two kept equal by discipline. The drift recorded in `rationale.md` is the cost of the second copy.

**Links** (verified during this design run):
- Plugins compared with standalone `.claude/` configuration, the table naming standalone as for personal and project customisation and plugins as for sharing with teammates: https://code.claude.com/docs/en/plugins.md
- Plugin installation behaviour, including that a plugin enabled only in a committed `.claude/settings.json` does not load until each team member installs it: https://code.claude.com/docs/en/discover-plugins.md
- Marketplace distribution and private repository authentication: https://code.claude.com/docs/en/plugin-marketplaces.md
- Plugin cache location, `~/.claude/plugins/cache/`, which is user level and therefore shared across worktrees: https://code.claude.com/docs/en/plugins-reference.md
