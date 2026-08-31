# Tony Chou portfolio (interactive portfolio monorepo)

## Stack

- **Language / Runtime**: TypeScript, Node >= 22 (hard requirement: Node 20 dies with ERR_REQUIRE_ESM via better-auth)
- **Monorepo**: npm workspaces — `apps/web` (Next.js 15, React 19, Tailwind, React Three Fiber), `apps/api` (NestJS 11, Prisma 7 on Prisma Postgres, Anthropic SDK), `packages/shared` (zod request schemas + shared types; builds to `dist/`)
- **Package manager**: npm
- Mirrors the architecture specs: [0001](docs/specs/_root/0001-backend-ai-stack/index.md) (backend/AI stack) and [0003](docs/specs/_root/0003-frontend-deployment-platform.md) (frontend/deploy)

## Build approach

<TBD, set by /scope> (specs 0002 and 0004 defaulted to Tracer Bullet and noted the assumption; no scope header exists yet)

## Commands

```bash
npm install                                  # install (root, Node 22+)
npm run dev:api                              # NestJS on :3001 (or .claude/launch.json "api")
npm run dev:web                              # Next.js on :3000 (or launch.json "web")
npm run lint                                 # ESLint flat config, whole repo
npx tsc --noEmit -p apps/api/tsconfig.json   # typecheck api (same for apps/web)
npm test --workspace=apps/api                # Jest (all mocked, no DB/network)
npm run check:evals                          # validate docs/evals/interview/published.json
cd apps/api && npx prisma migrate dev        # schema change (see apps/api gotchas first)
```

## Git

- integration: on
- commit: per milestone, only after typecheck + lint + tests pass; several small logical commits over one broad one
- push/deploy: only on an explicit ask — a push to main deploys web (Vercel) and api (Render, which runs `prisma migrate deploy`)
- main is protected by a ruleset (since 2026-08-30): no force push, no deletion, a PR is required (zero approvals, so you merge your own), and the `verify` check must pass. A repo admin can bypass, so a direct push to main is possible but is a deliberate act, not the default path. Work on a branch and open a PR.
- gate: run `/predeploy-audit` before any push that ships user-facing changes
- **never run the eval suite from a worktree you have not just looked at.** On 2026-08-31 a run was started by accident in a merged worktree that still held uncommitted files: it cost real budget and produced a result no commit could reproduce. `git branch --merged origin/main | grep '^+'` lists the branches that are finished AND still held by a worktree; `git -C <path> status --porcelain --ignored=matching` says what one of them holds, including the ignored files a plain status hides. The runner's own preflight refuses a run whose commit could not reproduce it, but it cannot tell you that you are in the wrong directory. General worktree hygiene is not a repo rule and lives in the user level `CLAUDE.md`.
- **this repo is PUBLIC (since 2026-08-29), so every push is publication.** Audit every commit, push, and PR before the action: read the staged diff rather than trusting `git add -A`; check for real credential patterns (`sk-ant-`, `AKIA`, `BETTER_AUTH_SECRET=`, `postgres://`, any `.env` that is not `.env.example`) and confirm each hit is a placeholder; and check for personal or operational content that is not product work (job search state, client or employer detail beyond the verified story corpus, generated model text in `docs/evals/`). For a PR, audit the whole branch against `origin/main`, since merging publishes every commit on it. Deleting later does not unpublish: clones, forks, and caches keep it. When something must be in git but not in public history, use a local branch with no upstream plus a copy outside the repo, and never `git push --all` or `--mirror`.

## Specs

`docs/specs/_root/NNNN-<slug>/` (index.md + rationale.md, verify.md when saved). CI runs typecheck, lint, and tests on every push (`.github/workflows/ci.yml`).

**There is no `docs/scope/` in this repo, deliberately.** Specs are the whole tracking surface: a feature's state is its spec's `**Status**:` line (`Proposed` → `In Progress` → `Accepted`), its tasks are the spec's `## Build plan`, and its acceptance criteria are `## Requirements`. Scope would hold feature status too, and the same fact in two files is how the two come to disagree; this repo has been bitten by that shape of drift more than once. So workflow skills should not offer to create a scope, ask about linking a feature to one, or treat a missing scope row as a gap: say in one line that this repo tracks features in specs, and move on. Nothing needs ticking. If an at a glance view of every feature is ever wanted, generate it from the spec `Status` lines rather than maintaining a second copy by hand.

## Rules

- Always Node 22+ (`nvm use 22`) before any npm/npx command.
- Validate at HTTP boundaries with the zod schemas in `packages/shared/contracts.ts`, applied per route via `ZodValidationPipe`. Every contract object is `.strict()`, which is what enforces the old pipe's forbidNonWhitelisted. There is no global pipe: a route that takes input and names no schema validates nothing.
- AI agent prompts live as markdown skill files on disk beside their module (`apps/api/src/modules/*/skills/`), never inline in code.
- Design tokens live in CSS custom properties; art direction lives in `apps/web/design.md`. Never hardcode a color.
- Never persist planner-typed content: for Beta the api writes anonymous counters only (hard rule, spec 0004 AC-6). Feedback messages are the deliberate exception — spec 0005 persists them and forwards them to AWS — but no visitor-typed content is ever LOGGED, anywhere (spec 0005 AC-I7).
- Tests are colocated `.spec.ts`, fully mocked; lint + typecheck + tests gate every commit.

## Agent skills

- [architect](.claude/skills/architect/) · [develop](.claude/skills/develop/) · [check](.claude/skills/check/) · [audit](.claude/skills/audit/) · [debug](.claude/skills/debug/) · [predeploy-audit](.claude/skills/predeploy-audit/): local workflow suite (spec → build → verify → gate), no registry source
- [agent-brief](.claude/skills/agent-brief/): local, composes a subagent's prompt. Carries the environment facts an agent cannot discover (its shell is Node 20, a fresh worktree has no `node_modules` or generated Prisma client, its base may be stale) plus the revert and confirm bar
- [github-actions-templates](.claude/skills/github-actions-templates/) + [github-actions-hardening](.claude/skills/github-actions-hardening/): `wshobson/agents`, CI workflow patterns
- [writing-for-agents](.claude/skills/writing-for-agents/) + [codebase-design](.claude/skills/codebase-design/): `mattpocock/skills`, agent document writing (pointers, information hierarchy, pruning) and deep module design
- Stack-specific skills are listed in each workspace's AGENTS.md. Registry installs go through `npx skills`, always hand-picked: `npx skills add <owner>/<repo> --skill <name> -y`. Two traps, both silent. A bare `add <owner>/<repo>` installs EVERY skill in a multi-skill repo (the 2026-08-18 cleanup hand-picked 19 and pruned ~800), and `--skill a,b` installs NOTHING while printing the available list as though it worked, so pass one `--skill` per run and verify each landed.

MCP servers: render (render-oss/render-mcp-server, recommended — deploy status/logs for the api), none connected.

## Context files

- [apps/web/AGENTS.md](apps/web/AGENTS.md): Next.js site — terminal theme, Beta identity, SSE clients
- [apps/api/AGENTS.md](apps/api/AGENTS.md): NestJS API — modules, agent pipelines, rate limits, DB gotchas
- [packages/shared/AGENTS.md](packages/shared/AGENTS.md): the request contracts both sides validate against, and the shared types

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
