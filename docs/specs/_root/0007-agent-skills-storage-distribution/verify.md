# Verify: agent skills storage and distribution · spec 0007 · updated 2026-08-22

_Steps derived from spec 0007's Standard definition and Rollout. `/check verify` runs these; `/test` locks the durable ones._

The failure this spec fixes is silent in the working checkout. Every rule below
has to be checked somewhere OTHER than the main tree, because the main tree is
the one place the broken layout always looked fine.

## Commands

- [ ] `npm run check:skills` → passes, reporting 36 skills → enforcement
- [ ] `git ls-files -s .claude | awk '$1=="120000"'` → no output (no committed symlinks anywhere under `.claude/`) → rule 1
- [ ] `git check-ignore --no-index -q .claude/skills/<any>` → exit 1 for every skill (nothing gitignored). **Must use `--no-index`**: without it git refuses to report a tracked path as ignored, and every skill is tracked, so the check silently passes on a broken repo → rule 2
- [ ] `python3 -c "import json;d=json.load(open('skills-lock.json'));print(d['version'],len(d['skills']))"` → `2 36` → manifest
- [ ] `test ! -e .agents && echo gone` → `gone` → rollout step 3

## Fresh clone (the actual defect)

- [ ] `git clone --branch <branch> . /tmp/clonetest` then, with **no `npm install` and no network**:
  - [ ] `ls /tmp/clonetest/.claude/skills | wc -l` → `36`
  - [ ] `find /tmp/clonetest/.claude/skills -type l | wc -l` → `0` (was 5 dangling before this migration)
  - [ ] every directory has a `SKILL.md` → `0` missing (was 2 missing before)
  - [ ] `node /tmp/clonetest/scripts/check-skills.mjs` → passes
- [ ] Spot check the 7 previously broken skills carry real content, not empty files: `aws-iam`, `aws-serverless`, `codebase-design`, `terraform-style-guide`, `writing-for-agents` (were symlinks), `better-auth-best-practices`, `vercel-react-best-practices` (were gitignored)

## Fresh worktree (the delegation path)

- [ ] `git worktree add --detach /tmp/wt HEAD`, then **without running any bootstrap link step**:
  - [ ] 36 skill dirs, 0 symlinks, 0 missing `SKILL.md`
  - [ ] `node scripts/check-skills.mjs` passes from inside the worktree
- [ ] `write-agent-preamble.md` step 3 contains no `.agents` link, and its exclude loop no longer lists `/.agents` → rollout step 4

## The check must fail when it should

Each rule verified by reintroducing its failure, then restoring:

- [ ] commit a symlink under `.claude/skills/` → rule 1 fires
- [ ] add a `.claude/skills/<name>` line to `.gitignore` → rule 2 fires (this is the one that was dead before `--no-index`)
- [ ] remove a skill's `SKILL.md` → rule 3 fires
- [ ] delete a manifest entry, and separately add one naming no directory → rule 4 fires both ways

## Acceptance-criteria coverage

- Rule 1 (no committed symlinks under `.claude/`) … covered by the `git ls-files -s` step and the fail test
- Rule 2 (nothing under `.claude/skills/` gitignored) … covered by the `--no-index` step and the fail test
- Rule 3 (every skill dir has `SKILL.md`) … covered by the clone, worktree and fail tests
- Rule 4 (manifest and directories agree both ways) … covered by the manifest step and both fail tests
- Rollout steps 1 to 4 (materialise, unignore, delete `.agents`, unlink the bootstrap) … covered by the clone and worktree sections
- Rollout step 5 (manifest at version 2, all 36, no `neon-postgres`) … covered by the manifest step
- Rollout step 6 (check lands and is wired into CI) … covered by `npm run check:skills` plus the CI job

## Not covered here

- The second phase (extracting the 7 workflow skills to a private `claude-workflow-skills` repo, and its `sync.mjs`) is not built. It needs a repo that does not exist yet.
- `computedHash` is never compared against upstream, by design: the check makes no network calls. It is provenance for a human, not freshness.
- `skillPath` is `null` for the 19 registry skills that never had a manifest entry. Not recoverable from disk, and deliberately not guessed.
