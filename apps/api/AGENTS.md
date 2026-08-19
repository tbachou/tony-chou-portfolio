# apps/api — NestJS API

## Overview

Public no-auth API on Render (free tier) powering the portfolio's AI features: the interview simulator (`/conversation`) and Beta, the return-to-climbing planner (`/beta`), plus a better-auth-protected internal admin. Every AI feature follows the same shape: a module under `src/modules/<name>`, agent prompts as markdown skill files on disk, forced tool calls for structured output, SSE streaming to the client.

## Stack

NestJS 11 (swc build) · Prisma 7 with driver adapter `@prisma/adapter-pg` (client generated into `src/generated/prisma`, gitignored territory — never edit or lint it) · Prisma Postgres (hosted) · `@anthropic-ai/sdk` · `@nestjs/throttler` · better-auth via `@thallesp/nestjs-better-auth` (global guard; public routes need `@AllowAnonymous()`) · Jest.

## Commands

```bash
npm run start:dev --workspace=apps/api      # dev server :3001 (Node 22+!)
npm test --workspace=apps/api               # Jest, colocated .spec.ts, all mocked
cd apps/api && npx prisma migrate dev       # create+apply migration (reads .env via prisma.config.ts)
cd apps/api && npx prisma generate          # regenerate client after schema edits
```

## Conventions

- DTOs in `dto/` with class-validator; the global ValidationPipe (main.ts) enforces whitelist + forbidNonWhitelisted.
- SSE via `writeSseEvent` (conversation/sse.util.ts): open the stream only after all plain-HTTP failure checks; after that, failures are SSE `error` events.
- Per-agent structured logging: one JSON line per model call (agent, model, durationMs, tokens, outcome). SDK errors log name + status only, never raw messages.
- Tests never touch network or DB: PrismaService, AnthropicService, and skill loaders are mocked.

## Gotchas

- **Dev and prod share the same Prisma Postgres database.** Local pipeline runs consume production daily caps and counters. Check `BetaDailyUsageCounter` before assuming abuse.
- **Rate-limit identity**: use `rateLimitIdentity()` (common/utils/ip-hash.util.ts) for any new per-IP feature — it collapses IPv6 to /64. `trust proxy = 1` assumes exactly Render's single proxy hop; adding a CDN in front breaks it (bump to 2).
- **Beta module invariants (spec 0004, audited)**: checked red-flag symptoms block in code before any model call; the global cap is an atomic reserve/refund (`reserveGlobalSlot`); counters increment on success only; no visitor content is ever written or logged. Do not weaken these.
- The in-memory throttle resets on every deploy; the persisted daily caps are the real limits.
- better-auth is ESM-only: Node 20 crashes at boot (ERR_REQUIRE_ESM); Jest needs the `jest.mock('@thallesp/nestjs-better-auth', ...)` stub (see app.controller.spec.ts).

## Agent skills

- [nestjs-best-practices](../../.claude/skills/nestjs-best-practices/): `kadajett/agent-nestjs-skills`, module/DI/security patterns
- [prisma-database-setup](../../.claude/skills/prisma-database-setup/): `prisma/skills`, provider configuration
- [prisma-postgres](../../.claude/skills/prisma-postgres/): `prisma/skills`, hosted Postgres operations
- [better-auth-best-practices](../../.claude/skills/better-auth-best-practices/): `better-auth/skills`, auth server/client config
- [javascript-typescript-jest](../../.claude/skills/javascript-typescript-jest/): `github/awesome-copilot`, Jest testing patterns

## Related specs

[0001 backend/AI stack](../../docs/specs/_root/0001-backend-ai-stack/index.md) · [0002 conversation engine](../../docs/specs/_root/0002-conversation-engine-and-usage-dashboard) · [0004 Beta](../../docs/specs/_root/0004-beta-climbing-rehab-planner/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
