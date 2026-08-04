# 0001. Backend, data, and AI stack for the interview simulator API

**Date**: 2026-08-03
**Status**: Accepted

## Summary

This decides how the not yet built backend (apps/api) gets built: NestJS as the framework, Prisma as the ORM and, now, as the database host too (Prisma Postgres, not Neon), storing conversation transcripts and a rate limit counter as well as static story data. Render hosts it through its native Node buildpack, not Docker. Anthropic's Claude is called directly through its own SDK, streamed natively, for the AI interview conversation. Rate limiting starts simple (in memory, single instance, plus a persisted daily backstop) since this is a public endpoint hitting a paid AI API. This spec covers backend, data, and AI choices only; the frontend (Next.js, React, React Three Fiber) was scaffolded in an earlier session and stays as is.

## Decision

**Chosen option**: Option 1: NestJS, Prisma, Prisma Postgres, Render, Anthropic SDK (the practice stack)

Build apps/api as a NestJS service using Prisma against Prisma's own hosted Postgres database, deployed on Render through its native Node buildpack, calling Anthropic's Claude directly through the official SDK for the /conversation/turn endpoint, with in memory rate limiting (@nestjs/throttler) as the starting point.

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`)

## Rationale

Reasoning and options: see rationale.md.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (Node.js) | Matches apps/web, one language across the whole monorepo, and this is the stack the engineer is deliberately practicing. |
| Framework | NestJS | Deliberate learning choice from PROJECT_BRIEF.md; real structure (modules, dependency injection, guards) worth a resume line, even though two endpoints alone would not require it (basis: PROJECT_BRIEF.md, existing stated learning goal). |
| ORM | Prisma | Chosen by the engineer over TypeORM for its stronger current tooling and schema workflow (basis: Prisma or TypeORM in 2026). |
| Primary DB | Postgres, hosted on Prisma Postgres (free tier), not Neon | Reconsidered from Neon during spec review: Prisma Postgres runs on Prisma's own infrastructure (Unikraft Cloud unikernels, not Neon under the hood), giving genuinely no cold start even at scale to zero, unlike Neon, plus built in connection pooling and query caching with a single connection string, no separate pooled/direct URL split to manage. One vendor for ORM and database instead of two. The real cost is Neon's database branching feature (clone the whole database like a git branch), which Prisma Postgres does not have, and betting on a newer product (GA since July 2026, one documented and patched incident in April 2026). Also stores conversation transcripts and the daily rate limit counter below, so it has a real write path beyond static story data, not just setup practice (basis: SQLite vs PostgreSQL for serverless apps; Prisma Postgres vs Neon comparison; cross check finding on the Premise note). |
| Shared types | packages/shared gets a small hand written types.ts (Story, ConversationTurn), referenced via TS path aliases, no build step | The shapes already exist in apps/web/src/lib/api.ts; Prisma is about to generate a third, unlinked version of the same shapes, so linking them now is cheap and avoids drift (basis: cross check finding; supersedes PROJECT_BRIEF.md's "defer until shapes stabilize" plan). |
| Auth | None | The app is a public, no auth showcase by design; nothing to protect behind a login (basis: PROJECT_BRIEF.md). |
| Hosting | Render (free web service tier) | Currently the only major platform with a genuinely permanent free tier and native NestJS detection (basis: Render platforms with a real free tier, 2026). |
| AI integration | Anthropic SDK, called directly, streamed via the SDK's own native streaming support (`client.messages.stream()`, server sent events), no Vercel AI SDK layer, a current Claude model (name it at build time, Claude Sonnet as of this session), prompt caching on the knowledge base block | The provider SDK streams natively; the Vercel AI SDK's real value add is frontend hooks and multi provider abstraction, not the ability to stream, so skipping it does not mean skipping streaming (basis: OpenAI SDK vs Vercel AI SDK comparison; engineer correction during spec review). Streaming turns the earlier dead wait into progressive output, the visitor sees the interviewer's question and Tony's answer appear as they generate. Prompt caching matters because the same knowledge base text is resent on every call, the largest cost lever available. |
| Rate limiting | @nestjs/throttler, in memory, a starting point of 5 requests per minute and 30 per hour per IP, plus a daily global turn counter persisted in Postgres as a hard backstop | Correct only with `trust proxy` set (Render sits behind a proxy, so every caller can otherwise look like one IP) and only while apps/api stays a single instance, true on Render's free tier. The persisted counter is the real ceiling, since a per IP request count alone does not cap a token bill (basis: Rate limiting NestJS with Redis; cross check finding). Arcjet (a hosted bot detection and rate limiting tool) was evaluated as an addition on 2026-08-03 and not adopted: its real bot detection needs browser side telemetry this API only endpoint cannot supply, it is a new hosted dependency with an unpublished free tier limit, and it does not natively support CommonJS, which this project deliberately kept (see rationale.md). |
| Observability | Structured console logs (Nest's built in JSON logger), including per turn token counts, latency, model, and throttle hit events | Enough to see if the rate limit is being hit or costs spike at this traffic scale; the Anthropic console's own spend cap is the real financial backstop, not the logs alone (basis: cross check finding). |
| Monorepo build | Plain npm workspaces, no extra orchestration tool | Reconsidered and dropped Turborepo: its real value (a dependency aware task graph and caching between packages/shared and apps/api) only shows up once packages/shared holds real code and a build actually takes long enough to matter, neither true today. Right sized for a 2 app repo with no build time problem yet; revisit once that changes (basis: engineer's own stack complexity check during spec review). |
| Nest compiler | SWC, via `nest build --builder swc` | A drop in, much faster compiler for the Nest CLI; same output as the default tsc, meaningfully faster builds and dev watch loop, effectively free to adopt. |
| Deploy method | Render's native Node buildpack, no Dockerfile | Reconsidered from Docker during spec review, dropped for the same reason as Turborepo above: real setup and debugging cost, on a stack that already has enough new pieces (NestJS, Prisma Postgres, streaming) to learn at once. Render's buildpack does the same job (build command, start command) with nothing to write or debug. |

**Configuration required**:
- `ANTHROPIC_API_KEY`: Claude API key, set in Render's environment group, never committed
- `DATABASE_URL`: Prisma Postgres connection string (a single `prisma+postgres://` style URL, pooling and caching handled by Prisma Postgres itself, no separate direct URL needed for migrations)
- `CORS_ORIGIN`: the deployed Next.js origin, plus localhost during dev
- `PORT`: Render injects this; main.ts must bind to it and to 0.0.0.0 or health checks never pass
- `NEXT_PUBLIC_API_URL` (apps/web side): points at the deployed apps/api origin, per environment

**Deploy pipeline** (Render, native Node buildpack, npm workspaces monorepo, no Docker, no Turborepo):
- Build command: `npm ci && npm run build --workspace=apps/api`, with `prisma generate` and the SWC compiled Nest build as part of that workspace's own build script
- Pre deploy command: `prisma migrate deploy` run against `DATABASE_URL`
- Start command: `node apps/api/dist/main.js`
- Root directory stays the repo root, not apps/api, so the workspace install resolves

## Consequences

**Positive**:
- Reinforces exactly the skills the engineer set out to practice (NestJS, a hosted relational database, a rate limited public API) and gives real, resume worthy system design experience to speak to in interviews.
- Render and Prisma Postgres's free tiers cost nothing at this app's expected traffic.
- Prisma Postgres genuinely removes cold starts on the database side (Render's own cold start on its free tier still applies), and removes the pooled/direct URL split entirely, one less thing to configure or get wrong.
- Prisma, and NestJS have official or well used Agent Skills and MCP servers now installed or offered, so future AI assisted development on this backend will be faster and more accurate.
- Streaming removes the dead spinner wait: a visitor sees the interviewer's question and Tony's answer appear progressively, which matters directly for the recruiter facing first impression this app is built around.

**Negative / tradeoffs**:
- Prisma Postgres is a younger product than Neon (general availability since July 2026, one documented and patched incident in April 2026) and does not have Neon's database branching feature; accepted for the one vendor simplicity and the genuine cold start fix, but worth naming as a real bet on a newer product.
- This is meaningfully more operational surface (a separate service, a hosted database, cross origin configuration, two platforms' worth of environment variables) than the app's actual functional need, two endpoints, would require on its own. Accepted deliberately for the learning and resume goal, not a mistake, but worth naming plainly.
- Render's free tier still spins down after about 15 minutes idle; the first request after idle will be slow, a real cost on a demo a recruiter might click into cold. Prisma Postgres's own cold start is no longer part of this problem, but Render's still is. apps/web needs an explicit "waking up" loading state for this, not a spinner that looks broken.
- In memory rate limiting resets on every cold start or redeploy, which happens often on a free tier that spins down. The persisted daily counter above is what actually holds a floor under total spend; the per IP throttle alone does not survive a cold start.
- Streaming means /conversation/turn is a server sent events response, not a single JSON array. This is a real change to apps/web/src/lib/api.ts's current `fetchNextTurn`, which expects one plain fetch returning `ConversationTurn[]`; the exact stream shape (how the interviewer/Tony turn boundary is signaled over the wire) is feature level design work, see Follow up.

**Neutral**:
- This supersedes PROJECT_BRIEF.md's original framing of "currently learning NestJS, TypeORM": the engineer chose Prisma instead during this session. The brief should be updated to match, see Follow up.
- packages/shared gets a small hand written types.ts now (Story, ConversationTurn), rather than waiting as PROJECT_BRIEF.md originally planned, since Prisma is about to generate a third, unlinked version of the same shapes.

## Follow-up

- [ ] Connect the Render and Prisma MCP servers (Prisma's official MCP covers Prisma Postgres management, migrations, and schema introspection directly), and optionally the NestJS MCP Server Module, in your own MCP settings. They were found and selected during this session, but connecting an MCP server is a step only you can do.
- [ ] Update PROJECT_BRIEF.md's "currently learning NestJS, TypeORM" line to reflect Prisma, since this spec chose it over TypeORM.
- [ ] Run /audit once apps/api has real code, to generate AGENTS.md capturing this stack and the three installed skills (`nestjs-best-practices`, `prisma-database-setup`, `prisma-postgres`) at root level; none of that context exists yet.
- [ ] Once the /conversation/turn endpoint ships against Claude, add Anthropic/Claude to KNOWLEDGE_BASE.md's skills list, mirroring the existing OpenAI API line, since it becomes a real fact about what was built.
- [ ] The rate limit numbers here (5/min, 30/hour per IP, plus the daily counter) are a starting guess; tune them against real Anthropic spend once the app is live, and add Redis backed limiting only if Render is ever scaled beyond a single instance.
- [ ] Remember CORS: apps/api must allow the deployed Next.js origin plus localhost during dev.
- [ ] Add a health check endpoint (Render polls it; also a named rule in the installed `nestjs-best-practices` skill).
- [ ] `nestjs-best-practices`, `prisma-database-setup`, and `prisma-postgres` conventions are not yet in any AGENTS.md, none exists yet; once /audit creates root AGENTS.md, these three belong in its `## Agent skills` section since they affect every file in apps/api.
- [ ] Before /conversation/turn is built, run /architect (FEATURE mode) on how the "never overclaim ownership tags" rule is actually enforced in the prompt or the response. PROJECT_BRIEF.md calls an overclaim a correctness bug, not a tone issue, and this stack spec deliberately leaves that mechanism undecided; a decision only stack spec should not contain it, but it must not be skipped either.
- [ ] Before /conversation/turn and /stories are built, also design as a feature spec: the request and response contract and validation (history length caps, topicId validation, distinct error shapes for rate limited vs upstream failure vs timeout), the server sent events stream shape (how the interviewer turn and Tony's turn boundary is signaled over the wire, and how apps/web/src/lib/api.ts's `fetchNextTurn` changes from a plain fetch to a stream consumer), and the /stories seeding script, including how KNOWLEDGE_BASE.md's finer ownership tags (e.g. `[CONTRIBUTED, PARTIAL]`, `[SOLO within Mailchimp]`) collapse into api.ts's solo/contributed/co-led enum.
- [ ] Revisit bot and abuse protection tooling (Arcjet or similar) only if real abuse shows up in production spend or logs, or if a browser facing surface is added elsewhere in the app (a public form, not just this API) where browser side bot telemetry would actually help. See rationale.md for the full evaluation.
