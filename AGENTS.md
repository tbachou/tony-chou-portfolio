# Tony Chou portfolio (interactive portfolio monorepo)

## Stack

- **Language / Runtime**: TypeScript, Node >= 22 (hard requirement: Node 20 dies with ERR_REQUIRE_ESM via better-auth)
- **Monorepo**: npm workspaces — `apps/web` (Next.js 15, React 19, Tailwind, React Three Fiber), `apps/api` (NestJS 11, Prisma 7 on Prisma Postgres, Anthropic SDK), `packages/shared` (hand-written shared types)
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
cd apps/api && npx prisma migrate dev        # schema change (see apps/api gotchas first)
```

## Git

- integration: on
- commit: per milestone, only after typecheck + lint + tests pass; several small logical commits over one broad one
- push/deploy: only on an explicit ask — a push to main deploys web (Vercel) and api (Render, which runs `prisma migrate deploy`)
- gate: run `/predeploy-audit` before any push that ships user-facing changes

## Specs

`docs/specs/_root/NNNN-<slug>/` (index.md + rationale.md, verify.md when saved). CI runs typecheck, lint, and tests on every push (`.github/workflows/ci.yml`).

## Rules

- Always Node 22+ (`nvm use 22`) before any npm/npx command.
- Validate at HTTP boundaries with class-validator DTOs; the global ValidationPipe runs whitelist + forbidNonWhitelisted.
- AI agent prompts live as markdown skill files on disk beside their module (`apps/api/src/modules/*/skills/`), never inline in code.
- Design tokens live in CSS custom properties; art direction lives in `apps/web/design.md`. Never hardcode a color.
- Never persist planner-typed content: for Beta the api writes anonymous counters only (hard rule, spec 0004 AC-6). Feedback messages are the deliberate exception — spec 0005 persists them and forwards them to AWS — but no visitor-typed content is ever LOGGED, anywhere (spec 0005 AC-I7).
- Tests are colocated `.spec.ts`, fully mocked; lint + typecheck + tests gate every commit.

## Agent skills

- [architect](.claude/skills/architect/) · [develop](.claude/skills/develop/) · [check](.claude/skills/check/) · [audit](.claude/skills/audit/) · [debug](.claude/skills/debug/) · [predeploy-audit](.claude/skills/predeploy-audit/): local workflow suite (spec → build → verify → gate), no registry source
- [github-actions-templates](.claude/skills/github-actions-templates/) + [github-actions-hardening](.claude/skills/github-actions-hardening/): `wshobson/agents`, CI workflow patterns
- [writing-for-agents](.claude/skills/writing-for-agents/) + [codebase-design](.claude/skills/codebase-design/): `mattpocock/skills`, agent document writing (pointers, information hierarchy, pruning) and deep module design
- Stack-specific skills are listed in each workspace's AGENTS.md. Registry installs go through `npx skills`, always hand-picked: `npx skills add <owner>/<repo> --skill <name> -y`. Two traps, both silent. A bare `add <owner>/<repo>` installs EVERY skill in a multi-skill repo (the 2026-08-18 cleanup hand-picked 19 and pruned ~800), and `--skill a,b` installs NOTHING while printing the available list as though it worked, so pass one `--skill` per run and verify each landed.

MCP servers: render (render-oss/render-mcp-server, recommended — deploy status/logs for the api), none connected.

## Context files

- [apps/web/AGENTS.md](apps/web/AGENTS.md): Next.js site — terminal theme, Beta identity, SSE clients
- [apps/api/AGENTS.md](apps/api/AGENTS.md): NestJS API — modules, agent pipelines, rate limits, DB gotchas
- [packages/shared/AGENTS.md](packages/shared/AGENTS.md): hand-written shared types, no build step

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
