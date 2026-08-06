# 0002. Conversation engine and usage dashboard

**Date**: 2026-08-05
**Status**: In Progress

## Summary

This decides how the `/stories`, `/topics`, and `/conversation/turn` endpoints actually work, and adds a small internal page to watch usage so a public, no login AI endpoint does not run up an unwatched bill. Visitors pick a topic and watch an AI generated interviewer and an AI generated "Tony" talk it through, a few exchanges at a time, streamed in live rather than appearing all at once. Every AI generated answer is checked by code, not just asked nicely, to make sure it never claims more credit than the real, git verified story allows. A single admin login (built with the better auth library) protects a small dashboard showing daily usage and which visitors are using the most.

## Context

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a visitor, I want to pick a topic and watch an AI interviewer and an AI "Tony" discuss it, appearing progressively rather than after a long wait, so the experience feels alive.
- As a visitor, I want the AI "Tony" to never claim more credit for a story than Tony actually had, so what I am shown stays honest.
- As Tony, I want a hard ceiling on how much this public endpoint can cost per day, and to be able to see who is driving usage, so a single visitor (or a bot) cannot run up an unwatched bill.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `GET /stories` returns every seeded story (id, title, ownership, engagement, summary) with no query parameters or pagination.
- **AC-2**: `GET /topics` returns the curated topic list (id/slug, label, description), ordered by `sortOrder`.
- **AC-3**: `POST /conversation/turn` with a valid `topicId` and empty history starts a new conversation: the server generates a `conversationId`, streams one interviewer turn then one Tony turn over SSE as token level events, and the stream carries that `conversationId` back to the client.
- **AC-4**: `POST /conversation/turn` with a valid `topicId`, an existing `conversationId`, and prior history produces the next turn pair (`turnIndex` incremented), grounded to a specific Story selected from that topic's mapped stories.
- **AC-5**: Once a conversation reaches its turn pair cap (`TURN_PAIR_CAP`, 5 pairs), the server generates an explicit wrap up pair instead of a normal one, and the stream's terminal event carries `isFinal: true`.
- **AC-6**: A request for another turn pair against a `conversationId` that already reached `isFinal: true` is rejected with a distinct 409 error, not silently continued or restarted.
- **AC-7**: A `topicId` that does not match any seeded Topic is rejected with a 400 validation error before any AI call is made.
- **AC-8**: Every Tony turn's ownership framing matches its grounding Story's `ownership` tag: `SOLO` stories may use confident first person language. For `CONTRIBUTED`/`CO_LED` stories, the response must contain at least one hedge phrase (from a fixed list: "contributed to", "co-led", "helped", "worked on", "part of a team that") or closely match `requiredFraming`; a response containing an unhedged sole credit verb ("I built", "I created", "I designed the whole", "I solely") with no hedge phrase present fails this check. When the deterministic overclaim guard flags a violation, the response actually shown is the story's `requiredFraming` scripted text, not the AI's raw output.
- **AC-9**: Every generated Tony turn is checked against a "never claim" blocklist derived from KNOWLEDGE_BASE.md's "Explicitly NOT verified" section, regardless of which story is active, and fails the same way AC-8 does if it matches.
- **AC-10**: Requests exceeding the per IP throttle (5/min, 30/hour) receive 429.
- **AC-11**: Once either the daily `turnCount` backstop (`DAILY_TURN_CAP`, default 300) or daily `tokenCount` backstop (`DAILY_TOKEN_CAP`, default 150000) is exceeded, every further `/conversation/turn` call is rejected for the rest of that day, independent of per IP throttle state. Both defaults are starting guesses, tune against real Anthropic spend once live (same approach spec 0001 took for the per IP throttle numbers).
- **AC-12**: Every persisted `ConversationTurn` row records `tokenCount` (input plus output tokens for that turn) and a one way hashed IP, never the raw address.
- **AC-13**: `GET /internal/usage/summary` is reachable only with a valid better auth session for the single seeded admin account; an unauthenticated request receives 401.
- **AC-14**: `/internal/usage/summary` returns daily turn and token totals for the last 14 days, plus the top 10 hashed IPs by token count over that window.
- **AC-15**: A `history` array longer than 10 entries (2x `TURN_PAIR_CAP`), or an individual turn's `text` field longer than 4000 characters, is rejected with a 400 validation error before any AI call is made.

## Options considered

See [rationale.md](rationale.md).

## Decision

**Chosen option**: Option 1: The contract as specced (token level SSE, per topic story grounding, a two layer ownership guard, and a better auth gated usage dashboard reusing the existing Postgres database).

**Implementation skills**: `nestjs-best-practices` (`.claude/skills/nestjs-best-practices/`), `prisma-database-setup` (`.claude/skills/prisma-database-setup/`), `prisma-postgres` (`.claude/skills/prisma-postgres/`), `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`)

## Rationale

See [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

- **Story**: `id` (cuid, PK), `title` (String), `ownership` (enum `SOLO` / `CONTRIBUTED` / `CO_LED`, mapped to `api.ts`'s lowercase `solo`/`contributed`/`co-led` at the API boundary), `engagement` (String), `summary` (String), `requiredFraming` (String, nullable, the scripted hedged phrase for non `SOLO` stories, reused as the AC-8 fallback), `topics` (many to many with Topic).
- **Topic**: `id` (cuid, PK), `slug` (String, unique, this is the `topicId` used over the wire), `label` (String), `description` (String), `sortOrder` (Int), `stories` (many to many with Story).
- **ConversationTurn**: `id` (cuid, PK), `conversationId` (String, correlates turns within one topic conversation), `topicId` (FK to Topic), `turnIndex` (Int), `role` (enum `INTERVIEWER` / `TONY`), `text` (String), `tokenCount` (Int, input plus output tokens for that turn), `hashedIp` (String, one way hash, not the raw IP), `createdAt` (DateTime, default now). Unique constraint on `(conversationId, turnIndex, role)`: a concurrent duplicate write for the same slot fails at the database level instead of silently double writing.
- **DailyUsageCounter**: `date` (Date, PK, one row per day), `turnCount` (Int, running total, the AC-11 backstop), `tokenCount` (Int, running total, the AC-11 backstop).
- **better auth's own tables** (`User`, `Session`, `Account`, `Verification`): generated by better auth's Prisma adapter and CLI (`npx auth@latest generate`), standard schema, not hand designed here. Sign up stays closed; the one admin `User` row is seeded directly, not created through a sign up flow.

**State transitions**:

A topic conversation (identified by `conversationId`): `not started` -> (first `POST /conversation/turn` with a valid `topicId`, empty history) -> `active, turnIndex 0` -> (each further call) -> `active, turnIndex N` -> (turnIndex reaches the cap) -> `concluded (isFinal: true)`. Any call against a `concluded` `conversationId` is rejected (AC-6), it does not transition back to `active`.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/stories` | GET | none | `Story[]` | public | none beyond a generic 500 |
| `/topics` | GET | none | `{ id, slug, label, description }[]`, ordered by `sortOrder` | public | none beyond a generic 500 |
| `/conversation/turn` | POST | `topicId: string` (req), `conversationId?: string`, `history: ConversationTurn[]` (req, max 10 entries) | SSE stream: `turn_start` (role), `token` (text delta) x N, `turn_end` (`conversationId`, `turnIndex`, `isFinal`), or `turn_error` (message) if the Anthropic call fails after the stream has already opened | public | 400 invalid `topicId`/oversized payload (before any stream opens), 409 conversation already concluded or a concurrent duplicate write (before any stream opens), 429 rate limited (before any stream opens) |
| `/internal/usage/summary` | GET | none | `{ dailyTotals: {date, turnCount, tokenCount}[], topSources: {hashedIp, tokenCount}[] }` | better auth session (single admin) | 401 unauthenticated |
| `/api/auth/*` | GET/POST | better auth's own routes (sign in, session) | better auth's own shapes | public (sign up disabled) | better auth's own error shapes |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `POST /conversation/turn`, first call | `conversationId` | generated by the server (`crypto.randomUUID()`), not a client input |
| `POST /conversation/turn`, any call | which Story grounds this turn pair | derived: the topic's mapped stories, indexed by `turnIndex` modulo the number of stories under that topic (deterministic round robin), so a multi pair conversation surfaces different stories rather than repeating one |
| `POST /conversation/turn`, any call | `isFinal` | derived: `turnIndex + 1 >= the topic conversation's turn pair cap` |
| `POST /conversation/turn`, any call | `tokenCount` persisted on the `ConversationTurn` row | the Anthropic SDK's response `usage` field (input plus output tokens) for that turn's call |
| `POST /conversation/turn`, any call | `hashedIp` persisted on the `ConversationTurn` row | a one way hash (e.g. HMAC SHA256 with a server side salt env var) of the request's IP, resolved via Nest's `trust proxy` setting per spec 0001 |
| Tony turn generation | the `requiredFraming` text used when the guard fires | the grounding Story's own `requiredFraming` field, set at seed time |
| `GET /internal/usage/summary` | `dailyTotals` | `DailyUsageCounter` rows for the last 14 days |
| `GET /internal/usage/summary` | `topSources` | `ConversationTurn` rows in the last 14 days, grouped by `hashedIp`, summed `tokenCount`, top 10 |

**Key invariants**:
- A `conversationId` only ever moves forward: `turnIndex` strictly increases, and no turn is generated after `isFinal: true` (AC-6). The `(conversationId, turnIndex, role)` unique constraint enforces this under concurrent requests; the losing write fails and the request returns 409.
- A Tony turn's shown text never contradicts its grounding Story's `ownership` tag (AC-8); the deterministic guard is the enforcement point, not the prompt alone.
- `DailyUsageCounter` totals are a running counter incremented on every persisted `ConversationTurn`, not recomputed by aggregation on each check, so the AC-11 backstop check stays a single fast read.
- `hashedIp` is never reversible to the original IP from data alone (a one way hash with a server side salt, not encryption).
- Every seeded Topic maps to at least 2 Stories, validated by the seed script; the round robin story selection (turnIndex modulo story count) requires at least 2 to actually rotate rather than repeat or divide by zero.
- A `turn_error` (an Anthropic failure after the SSE stream has already opened) persists no `ConversationTurn` row and does not advance `turnIndex`; the client can retry the same call unchanged.

**Security model**:
- `/stories`, `/topics`, `/conversation/turn` stay public, no auth, matching spec 0001's stated design (a public showcase app).
- `/internal/usage/summary` and any other internal route requires a better auth session belonging to the single seeded admin `User`. Sign up is disabled; no other account can ever be created through the app itself.
- No compliance scope applies (no payments, no health data, no PII beyond a hashed, salted IP kept only for abuse pattern detection).

**Configuration required**:
- `INTERNAL_ADMIN_EMAIL`, `INTERNAL_ADMIN_PASSWORD`: used once by the seed script to create the single admin `User`, never read at request time.
- `BETTER_AUTH_SECRET`: better auth's session signing secret.
- `IP_HASH_SALT`: the server side salt used to hash request IPs before persisting `hashedIp`.
- `TURN_PAIR_CAP`: max turn pairs per topic conversation before the wrap up turn, default 5.
- `DAILY_TURN_CAP`: the AC-11 daily turn count backstop, default 300.
- `DAILY_TOKEN_CAP`: the AC-11 daily token count backstop, default 150000.
- (Carried over from spec 0001, unchanged: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `CORS_ORIGIN`, `PORT`, `NEXT_PUBLIC_API_URL`.)

**Critical test scenarios**:
- Happy path: a visitor picks a topic, `TURN_PAIR_CAP` (5) turn pairs stream in with visible token by token progress, the fifth pair is the wrap up with `isFinal: true`, verifies **AC-3**, **AC-4**, **AC-5**.
- Failure case: a `CONTRIBUTED` story's AI generated answer contains "I built this" with no hedge phrase present, the guard fires, the response actually shown is the story's `requiredFraming` text instead, verifies **AC-8**.
- Failure case: the daily `tokenCount` backstop (`DAILY_TOKEN_CAP`) is already exceeded, a new, otherwise valid `/conversation/turn` call is rejected before any Anthropic call is made, verifies **AC-11**.
- Failure case: the Anthropic call fails after the SSE stream has already opened (a `turn_start` event was sent), the client receives a `turn_error` event, no `ConversationTurn` row is persisted, and `turnIndex` does not advance, verifies **AC-4**.
- Failure case: two concurrent requests target the same `conversationId` and `turnIndex`, the second write fails the `(conversationId, turnIndex, role)` unique constraint and the request receives 409, verifies **AC-6**.
- Auth/permission: an unauthenticated request to `/internal/usage/summary` receives 401 and no usage data, verifies **AC-13**.

## Build plan

1. Replace the Prisma starter schema (`Author`/`Post`) with `Story`, `Topic`, `ConversationTurn`, `DailyUsageCounter`, and their migration, satisfies **AC-1**, **AC-2**, **AC-11**, **AC-12**.
2. Hand author the seed data (transcribing KNOWLEDGE_BASE.md's 21 stories into structured `Story` rows, folding ownership qualifiers like ", PARTIAL" into `engagement`/`summary` text, writing `requiredFraming` for every non `SOLO` story, and defining the curated `Topic` list with `sortOrder`), plus the seed script, which must fail loudly if any Topic maps to fewer than 2 Stories, satisfies **AC-1**, **AC-2**.
3. Build `GET /stories` and `GET /topics` against the seeded data, a thin slice with no AI call yet, satisfies **AC-1**, **AC-2**.
4. Build the thin end to end conversation slice: `POST /conversation/turn` producing one real, token streamed turn pair via the Anthropic SDK, grounded to one Story (round robin selected by `turnIndex` modulo the topic's mapped story count), persisted as `ConversationTurn` rows (with the `(conversationId, turnIndex, role)` unique constraint) carrying `tokenCount` and `hashedIp`, plus the `turn_error` SSE event for a mid stream Anthropic failure, no cap or guard logic yet, proves the whole path works, satisfies **AC-3**, part of **AC-4**, **AC-12**.
5. Add the turn pair cap (`TURN_PAIR_CAP`, default 5), the wrap up turn, `isFinal` signaling, and rejection (409) of turns requested past conclusion or a concurrent duplicate write, satisfies **AC-4**, **AC-5**, **AC-6**.
6. Add request validation (`topicId` allowlist, `history` capped at 10 entries, per turn `text` capped at 4000 characters), satisfies **AC-7**, **AC-15**.
7. Add the ownership enforcement layer: inject `requiredFraming` into the prompt for non `SOLO` stories, the deterministic overclaim guard (the hedge phrase list plus the unhedged sole credit verb list), the never claim blocklist, and the scripted fallback path, satisfies **AC-8**, **AC-9**.
8. Add rate limiting: `@nestjs/throttler` per IP, plus the `DailyUsageCounter` dual metric (`DAILY_TURN_CAP`, default 300; `DAILY_TOKEN_CAP`, default 150000) hard backstop, satisfies **AC-10**, **AC-11**.
9. Wire up better auth (Prisma adapter, `@thallesp/nestjs-better-auth`, closed sign up, the seeded single admin `User`), a prerequisite for the dashboard, no AC of its own, gates **AC-13**.
10. Build `GET /internal/usage/summary`, aggregating `DailyUsageCounter` and grouped `ConversationTurn` data, satisfies **AC-13**, **AC-14**.
11. Build the `apps/web` `/internal/usage` page (better auth client, a login form, a daily totals view, a top sources table), satisfies **AC-13**, **AC-14**.
12. Update `apps/web/src/lib/api.ts`'s `fetchNextTurn` to consume the SSE stream instead of a plain fetch, and update `ConversationPanel.tsx`/`page.tsx` for the topic picker, click to advance pacing, and the wrap up state, completes the frontend side of **AC-3** through **AC-9**.

## Consequences

**Positive**:
- Closes every item spec 0001 left open as follow up, including the one it called a correctness bug.
- The ownership guard is mechanical and testable (a blocklist check plus a scripted fallback), not a prompt instruction the model could quietly ignore.
- Token level SSE streaming delivers the progressive, "watch it appear" experience spec 0001 chose native streaming for in the first place.
- The usage dashboard reuses the existing Postgres database; no new database, no new hosting account.
- Real, hands on practice with a second production style library (better auth) alongside NestJS and Prisma, a genuine addition to the resume narrative this whole project is built around.

**Negative / tradeoffs**:
- better auth's NestJS integration is community maintained (`@thallesp/nestjs-better-auth`), not an official better auth package, a real dependency risk this session otherwise avoided by sticking to officially supported pieces (see rationale.md's Option 1 cons).
- This spec's surface grew well past the four items it was originally commissioned to settle; four new Prisma entities, two new endpoints, one new auth library, and one new internal page, for what started as "design the contract for two endpoints." Accepted deliberately (see the Premise note in rationale.md), not an oversight.
- The deterministic overclaim guard is a blocklist, not a full language understanding check; it will catch obvious overclaim phrasing but is not guaranteed to catch every subtle way a model could overstate ownership. The `requiredFraming` fallback is the real backstop, not the blocklist's coverage alone.
- A single admin `User` with no password reset flow (out of scope here) means a lost admin password requires a manual database fix, not a self service recovery.

**Neutral**:
- `packages/shared/types.ts` needs `ConversationTurn`'s wire shape updated for the new SSE event model (`turn_start`/`token`/`turn_end`), a breaking change from the current plain `ConversationTurn[]` return shape, but nothing else in the repo currently depends on the old shape besides `apps/web/src/lib/api.ts` itself.
- Introduces the project's first authenticated surface; everything else in the app stays intentionally public and no login, per spec 0001's original design.

## Follow-up

- [ ] Connect the better auth MCP server (documentation search and setup assistance) in your own MCP settings; found and offered this session, connecting is a step only you can do. See rationale.md's References for the docs link.
- [ ] `better-auth-best-practices` conventions are not yet in any `AGENTS.md` (none exists yet in this repo); once `/audit` creates a root `AGENTS.md`, this belongs in its `## Agent skills` section, alongside `nestjs-best-practices`, `prisma-database-setup`, and `prisma-postgres` from spec 0001.
- [ ] A password reset flow for the single admin account is out of scope here; if the seeded credentials are ever lost, recovery is a manual database update, not a self service flow. Revisit only if this stops being acceptable.
- [ ] The 14 day window and top 10 row count on `/internal/usage/summary` are starting guesses; tune them once you are actually checking the dashboard against real traffic.
- [ ] The deterministic overclaim guard's blocklist (both the ownership hedge check and the never claim list) should be revisited and expanded if a real overclaim or a false positive is ever observed once this is live; it is a starting set, not exhaustive.
