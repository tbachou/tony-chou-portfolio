# apps/api — NestJS API

## Overview

Public no-auth API on Render (**Starter plan, $7/month** — not the free tier, whatever older notes say; verified against the live service 2026-09-01, which is why there is no cold start spin down) powering the portfolio's AI features: the interview simulator (`/conversation`), Beta the return-to-climbing planner (`/beta`), and Grade Guesser the daily climbing-grade game (`/grade`, behind `GRADE_GAME_ENABLED`), plus a better-auth-protected internal admin (`/internal/*`, including the Grade Guesser photo pool). Every AI feature follows the same shape: a module under `src/modules/<name>`, agent prompts as markdown skill files on disk, forced tool calls for structured output, SSE streaming to the client.

## Stack

NestJS 11 (swc build) · Prisma 7 with driver adapter `@prisma/adapter-pg` (client generated into `src/generated/prisma`, gitignored territory — never edit or lint it) · Prisma Postgres (hosted) · `@anthropic-ai/sdk` · `@nestjs/throttler` · better-auth via `@thallesp/nestjs-better-auth` (global guard; public routes need `@AllowAnonymous()`) · `@aws-sdk/client-s3` + `s3-request-presigner` and `sharp` (Grade Guesser photo storage; `sharp` ships platform-specific native binaries, so a clean install on Render's linux x64 is not implied by one working locally) · Jest.

## Commands

```bash
npm run start:dev --workspace=apps/api      # dev server :3001 (Node 22+!)
npm test --workspace=apps/api               # Jest, colocated .spec.ts, all mocked
cd apps/api && npx prisma generate          # regenerate client after schema edits

# MIGRATIONS. `.env`'s DATABASE_URL points at a DEV database (since 2026-08-21);
# production is migrated by Render's preDeployCommand on deploy, not from here.
npx prisma migrate status                   # ALWAYS check which DB you are on first
npx prisma migrate dev --name <change>      # generate against dev

# NEVER hand-write migration SQL. It ships DDL that has never executed, and a
# subtle mismatch passes `migrate deploy` silently, surfacing later as drift.
# If you are not certain what .env points at, generate against a throwaway:
docker run -d --name mig -e POSTGRES_PASSWORD=x -e POSTGRES_DB=dev \
  -p 55433:5432 postgres:16-alpine
cd apps/api
export DATABASE_URL="postgresql://postgres:x@localhost:55433/dev?schema=public"
npx prisma migrate deploy                   # bring the throwaway up to date
npx prisma migrate dev --name <change>      # GENERATE the new migration here
npx prisma migrate diff --from-config-datasource \
  --to-schema ./prisma/schema.prisma --exit-code   # want "No difference detected."
docker rm -f mig; unset DATABASE_URL
```

## Conventions

- Request shapes are zod schemas in `@portfolio/shared`, not DTO classes. A controller applies one with `@Body(new ZodValidationPipe(theSchema))`; `.strict()` on the schema is what rejects unknown properties. The web app builds its payloads to the same schema, so a field cannot be tightened on one side only.
- SSE via `writeSseEvent` (conversation/sse.util.ts): open the stream only after all plain-HTTP failure checks; after that, failures are SSE `error` events.
- Per-agent structured logging: one JSON line per model call (agent, model, durationMs, tokens, outcome). SDK errors log name + status only, never raw messages.
- Tests never touch network or DB: PrismaService, AnthropicService, and skill loaders are mocked.

## Gotchas

- **The AI provider is split PER SURFACE, and `AI_PROVIDER=bedrock` does not mean "everything runs on Bedrock".** `render.yaml` sets `AI_PROVIDER=bedrock`, but that flag only governs consumers that inject the `AI_PROVIDER` token: the interview simulator (`conversation.service.ts`) and the Grade Guesser grader (`grade-analysis.service.ts`). **Beta constructor-injects the concrete `AnthropicService` and therefore runs on the direct Anthropic API in production, whatever the flag says** (`beta.service.ts`, `anthropic.module.ts`'s deliberate two-export split). Verified in production 2026-08-22: a live plan logged `provider: "anthropic"` on screener, drafter and coach while the interviewer runs on Bedrock. **The reason is model access, not code:** this AWS account cannot invoke Claude Sonnet 5 on Bedrock, and Beta's drafter is pinned to Sonnet 5, so moving Beta onto the token would silently downgrade the model that writes rehab plans. Older docs attribute Beta's direct path to "the Guardrails child"; that was the original reason and is no longer the binding one. Do not "fix" the inconsistency by putting Beta on the token until the account has Sonnet 5 on Bedrock. **Models actually served:** Bedrock surfaces run `us.anthropic.claude-sonnet-4-6` (set as `BEDROCK_MODEL_ID` in the Render dashboard for the interviewer; pinned as `GRADER_MODEL_BEDROCK` for the grader, which deliberately ignores the env var). The direct path runs `claude-sonnet-5`. The in code `DEFAULT_BEDROCK_MODEL_ID` is 4.5 and is not what production uses.
- **Dev and prod are SEPARATE databases as of 2026-08-21** (they used to share one, and much older guidance assumes that). `.env`'s `DATABASE_URL` is a dev database; production is reached only by Render's `preDeployCommand: npx prisma migrate deploy`, which runs before the code swap so a failed migration aborts the deploy rather than half-applying. **Consequences of the split:** local runs no longer consume production daily caps or counters, and `prisma migrate dev` against `.env` is no longer a production hazard. **Still true regardless:** never hand-write migration SQL (see Commands), and run `prisma migrate status` before any migration so you know which database you are on. What is NOT yet decided is seeding and whether CI does anything with the dev database — that is an open `/architect` question. An exported `DATABASE_URL` reliably beats `.env`, because `prisma.config.ts` uses `import "dotenv/config"` and dotenv does not override an already-set variable.
- **Rate-limit identity**: use `rateLimitIdentity()` (common/utils/ip-hash.util.ts) for any new per-IP feature — it collapses IPv6 to /64. `trust proxy = 1` assumes exactly Render's single proxy hop; adding a CDN in front breaks it (bump to 2). The same proxy-topology fact also lives in apps/api/src/lib/auth.ts as better-auth's `advanced.ipAddress.trustedProxies` — a CDN change must update BOTH (bump trust proxy to 2 AND add the CDN's egress ranges to trustedProxies) or better-auth silently collapses visitors into one rate bucket.
- **Beta module invariants (spec 0004, audited)**: checked red-flag symptoms block in code before any model call; the global cap is an atomic reserve/refund (`reserveGlobalSlot`); planCount increments on success only; the outcome/abuse tally columns (errorCount, redFlagCount, refusalCount, throttledCount, ipCappedCount, globalCappedCount) increment on their respective non-success events; no visitor content is ever written or logged. Do not weaken these.
- The in-memory throttle resets on every deploy; the persisted daily caps are the real limits.
- better-auth is ESM-only: Node 20 crashes at boot (ERR_REQUIRE_ESM); Jest needs the `jest.mock('@thallesp/nestjs-better-auth', ...)` stub (see app.controller.spec.ts).

## Agent skills

Installed globally, not committed here (spec 0014); `skills-lock.json` at the repo root is the list.

- `nestjs-best-practices`: `kadajett/agent-nestjs-skills`, module/DI/security patterns
- `prisma-database-setup`: `prisma/skills`, provider configuration
- `prisma-postgres`: `prisma/skills`, hosted Postgres operations
- `better-auth-best-practices`: `better-auth/skills`, auth server/client config
- `javascript-typescript-jest`: `github/awesome-copilot`, Jest testing patterns

## Related specs

[0001 backend/AI stack](../../docs/specs/_root/0001-backend-ai-stack/index.md) · [0002 conversation engine](../../docs/specs/_root/0002-conversation-engine-and-usage-dashboard) · [0004 Beta](../../docs/specs/_root/0004-beta-climbing-rehab-planner/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
