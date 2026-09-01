# 0014 rationale: agent skill storage

## Context

Spec 0007 decided in August 2026 that every agent skill in this repo is committed as real files. It was a good decision for the problem in front of it. Five storage mechanisms had grown up side by side and two of them produced a broken checkout: a fresh clone got 29 working skills, 5 dangling symlinks, and 2 skills that were simply absent. Vendoring fixed that, and the CI check it introduced has held ever since.

The question reopened on 2026-08-31 during an unrelated build. Installing one skill, `upstash/skills`, added 504 KB across 78 files covering eleven Upstash products, of which the build used one. The resulting pull request was 78 files of someone else's content against 16 authored ones. 0007 had weighed its decision at roughly 425 KB for all skills combined, so a single install exceeded the basis the entire standard was costed against. The tree stood at 2.1 MB across 27 skills.

Three facts turned that from a sizing complaint into a question about the mechanism.

**The documentation points elsewhere.** Anthropic's plugin documentation compares approaches directly: standalone `.claude/` configuration is described as being for "personal workflows, project-specific customizations, quick experiments", while plugins are for "sharing with teammates, distributing to community, versioned releases, reusable across projects". The guidance says to start standalone "then convert to a plugin when you're ready to share". Vendoring is framed as a stepping stone, not the destination.

**The copies had already drifted, in the direction that hides failure.** The repo's copy of the `predeploy-audit` skill is 34 lines. The copy at `~/.claude/skills/` is 56 and contains an adversarial break it pass that the repo's copy does not mention at all. On the day this spec was written, that gate was run against this repo, a system reminder pointed at the repo's directory scoped copy, and the run deviated from it deliberately because it was visibly the older one. That adversarial pass found three real defects that day, including one that would have destroyed data. Vendoring did not prevent drift here; it created a second copy that could drift, and the copy that lost was the one committed.

**Nothing here needs skills at build time.** CI runs typechecks, lint and tests. It does not run Claude Code, so it never reads a skill. The only reason CI touches `.claude/skills/` is the layout check that vendoring made necessary.

## Options considered

### Option 1: Keep vendoring, add a size or scope rule

Leave 0007's mechanism intact and add a rule so no single install can add half a megabyte again: cap by size, or require that only the used parts of a multi product skill are committed.

**Pros**:
- Smallest change. The fresh clone guarantee, the CI check and the manifest all survive untouched.
- Directly targets the event that prompted the review.

**Cons**:
- Optimises a mechanism the documentation treats as a stepping stone.
- Trimming a multi product skill produces a hand maintained fork: `upstash`'s `SKILL.md` is a router pointing at eleven directories, so removing ten leaves it referencing files that do not exist.
- Leaves the licensing question untouched. A public repository would still be redistributing other projects' content with no attribution and no licence file.
- Does nothing about the drift, which is the failure that actually cost something.

### Option 2: Move third party skills to plugin marketplaces

Use the mechanism the documentation points at: add a marketplace, enable the plugin in a committed `.claude/settings.json`, and let the files live in the user level plugin cache.

**Pros**:
- The designed path for exactly this, and the skill files never enter the repository.
- Upstream fixes arrive automatically.
- `.claude/settings.json` is already committed here and already carries `permissions` and `worktree`, so plugin references would sit naturally beside them.

**Cons**:
- **Only six of the ten source repositories can serve as marketplaces.** Checked directly: `aws/agent-toolkit-for-aws`, `better-auth/skills`, `hashicorp/agent-skills`, `josiahsiegel/claude-plugin-marketplace`, `mattpocock/skills` and `wshobson/agents` carry `.claude-plugin/marketplace.json`; `github/awesome-copilot`, `kadajett/agent-nestjs-skills`, `prisma/skills` and `vercel-labs/agent-skills` do not, and show no sign of adding one. Those four hold `vercel-react-best-practices` at 416 KB and `nestjs-best-practices` at 236 KB, so 652 KB, the bulk of the problem, could not move.
- Since Claude Code v2.1.195, a plugin enabled only in a committed project `settings.json` does not load until each person installs it. Committing configuration is not enough, so the mechanism does not deliver the automatic availability it appears to.
- Introduces a second distribution system alongside `npx skills`, which would still be needed for the four that cannot move.

### Option 3: Authored skills stay committed, registry skills leave, all by one route (chosen)

Split by authorship. The seven skills Tony wrote stay in the repo. The twenty from public sources are installed once per machine into `~/.claude/skills/` and the repo records only that it expects them. Global copies of the authored skills become symlinks into the repo.

**Pros**:
- Removes third party content from a public repository entirely, which closes the licensing question rather than sizing it.
- Works for all ten sources, because `npx skills` does not care whether a repo is a marketplace.
- Makes drift impossible for the authored skills rather than merely discouraged: the symlink means one copy exists.
- Keeps version control, history and a backup for the content that is actually Tony's, which is also the content this portfolio has a reason to show.
- The worktree problem disappears by construction. `~/.claude/skills/` is user level, so every worktree on a machine sees the same skills with no per worktree step.

**Cons**:
- A fresh machine needs an install pass before the twenty work. This is the guarantee 0007 bought and this spec gives up, and it is a real loss.
- Registry content is no longer pinned. An upstream edit changes agent behaviour on the next install, invisibly, and skills are instructions agents follow.
- The home directory symlinks couple this machine's global skills to this repo's path.
- The authored skills still have one home, so they are backed up only as well as this repo is.

### Option 3a: the same split, but marketplaces where they exist

Option 3, except the registry skills do not all take one route. The six sources that publish `.claude-plugin/marketplace.json` are installed as plugins through Claude Code's own mechanism; the four that do not are installed with `npx skills` into the user level directory.

**Pros**:
- Puts the larger share on the path the documentation actually recommends, rather than rejecting that path entirely because a minority of sources cannot take it.
- Plugin installs carry a version, so the six gain the pinning that a bare `npx skills` install does not give. Skills are instructions agents follow, and the drift recorded below is what happens when nobody can tell which version is in play.
- Nothing else about the standard changes: the authored skills, the symlink, the manifest and the enforcement are identical either way.

**Cons**:
- Two mechanisms for one category, so the standard has to say which route each skill takes and a person has to look before installing. The manifest can carry that, but it is a field that can be wrong.
- The four that cannot move include the two largest, so the size win is unchanged by the split. The benefit is version pinning and following the documented path, not bytes.
- A marketplace install needs the workspace trust gate and, since v2.1.195, an explicit per person install. That is the same one time per machine cost as `npx skills`, so it is not worse, but it is a second setup path to describe.

Rejected, but not for the reason the first draft gave. That draft ruled marketplaces out wholesale on the 652 KB that cannot move, which is an argument against making them the ONLY route and not an argument against a split. Weighed properly, the split still loses, on what the pinning is actually worth: it would cover six of twenty, and the four it cannot cover include the two largest and the ones most likely to change under you. Half a fleet pinned is not a guarantee anybody can rely on, because the question "is the agent behaving differently because a skill changed?" still has no answer. Against that partial benefit sits a real cost: two install mechanisms for one category, a per entry route field that can be wrong, and a second setup path to describe on every new machine. One route for all twenty is the simpler rule and gives up little that was real.

### Option 4: Nothing in the repo at all

Install everything, authored included, at user level. The repo records a list.

**Pros**:
- Smallest possible repository, and one uniform rule with no per kind branching.
- No copy of anything can drift, anywhere.

**Cons**:
- The seven authored skills are roughly 480 KB of Tony's own writing with real history. Their only home would be an unversioned directory on one machine.
- `agent-brief` exists **only** in this repo today, at neither user level nor in any other repo on the machine. Adopting this without care would delete it outright.
- Loses the thing a portfolio repository has most reason to keep: the tooling its owner wrote.

## Rationale

Option 3 is chosen because the two kinds of skill have genuinely different answers, and 0007's own manifest already separated them with `kind`. What is Tony's belongs under version control; what is someone else's does not belong in a public repository at all.

The deciding evidence against Option 1 is the drift, not the size. Size is an argument about tidiness and reasonable people can disagree about half a megabyte. A safety gate that was quietly 22 lines shorter than the one being followed is not a tidiness problem, and vendoring is what created the second copy that could be shorter. Option 3 removes the second copy rather than adding a rule that a person has to remember.

Option 2 fails as a WHOLE answer rather than as an idea: 652 KB of the problem lives in repositories that cannot serve as marketplaces, so marketplaces alone could not solve the case that prompted the review. That is an argument against making it the only route, not against using it at all, and the first draft of this spec drew the wrong conclusion from it. Option 3a weighs the split that argument actually allows, and it loses on its own merits rather than on that fact: the pinning it buys covers six of twenty and misses the two largest, which is not enough to pay for a second install mechanism. A future skill whose upstream publishes a marketplace could still reasonably use one, recorded as an exception.

Option 4 was tempting and is rejected on one concrete fact: `agent-brief` exists nowhere but this repo. A standard whose adoption deletes something irreplaceable is the wrong standard, and the more general point holds too, that a portfolio should keep the tools its owner wrote.

The fresh machine cost is accepted knowingly. It is once per machine rather than once per worktree, because the user level skills directory is shared by every project and every worktree on that machine. The engineer here works on one machine, and CI never reads a skill.

## The drift, recorded

Measured on 2026-08-31, comparing `~/.claude/skills/` against `.claude/skills/` in this repo:

| Skill | Global | Repo | State |
|---|---|---|---|
| `architect` | present | present | identical |
| `develop` | present | present | identical |
| `check` | present | present | identical |
| `audit` | present | present | identical |
| `debug` | present | present | identical |
| `predeploy-audit` | 56 lines | **34 lines** | **differ** |
| `agent-brief` | **absent** | present | repo only |

The `predeploy-audit` difference is not cosmetic. The repo's copy contains no mention of the adversarial break it pass; the global copy describes it and marks it mandatory when a check becomes more permissive. Run on 2026-08-31, that pass found a rename that let a changed prompt file past a guard on paid runs, a guard that failed open when git errored, and a path classifier that recommended deleting a directory holding the only copy of a hand written file.

`agent-brief` being repo only is the mirror image, and is the reason the rollout in the standard puts it first.

## Registry skill sources, checked

Whether each source repository can serve as a Claude Code plugin marketplace, checked on 2026-08-31 for `.claude-plugin/marketplace.json` on the default branch:

| Source | Marketplace | Skills |
|---|---|---|
| `aws/agent-toolkit-for-aws` | yes | `aws-iam`, `aws-serverless` |
| `better-auth/skills` | yes | `better-auth-best-practices` |
| `hashicorp/agent-skills` | yes | `terraform-style-guide` |
| `josiahsiegel/claude-plugin-marketplace` | yes | 6 tailwindcss skills |
| `mattpocock/skills` | yes | `codebase-design`, `writing-for-agents` |
| `wshobson/agents` | yes | `github-actions-hardening`, `github-actions-templates` |
| `github/awesome-copilot` | **no** | `javascript-typescript-jest` |
| `kadajett/agent-nestjs-skills` | **no** | `nestjs-best-practices` (236 KB) |
| `prisma/skills` | **no** | `prisma-database-setup`, `prisma-postgres` |
| `vercel-labs/agent-skills` | **no** | `vercel-react-best-practices` (416 KB) |

Recorded so nobody repeats the check, and because it is the fact that ruled out Option 2.

## References

**Project sources**:
- Spec 0007 and its rationale, for the broken checkout this replaced and the five mechanisms it removed.
- `skills-lock.json`, whose `kind` field already made the authored and registry distinction this standard acts on.

**Practices and standards**:
- One copy of a thing, rather than two kept equal by discipline.
- Do not redistribute another project's content from a public repository without checking its licence.

**Links** (verified during this design run):
- https://code.claude.com/docs/en/plugins.md
- https://code.claude.com/docs/en/discover-plugins.md
- https://code.claude.com/docs/en/plugin-marketplaces.md
- https://code.claude.com/docs/en/plugins-reference.md
