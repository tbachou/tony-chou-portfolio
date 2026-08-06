# Rationale: 0002, Conversation engine and usage dashboard

## Context

> Premise note: this spec bundles two things that started as one commissioned question ("design the /stories and /conversation/turn contract") and grew, mid conversation, into two build efforts: the public conversation engine, and a new internal usage dashboard with its own auth. They are kept in one spec, not split into an umbrella, because they share one Prisma schema and migration (ConversationTurn and DailyUsageCounter exist only because the conversation engine writes them, the dashboard only reads them) and because the dashboard has no reason to exist independently of the engine it observes. Anyone reading this later should know the scope grew during design, not that it was planned this size from the start.

Spec 0001 already decided the base stack (NestJS, Prisma, Prisma Postgres, Render, Anthropic SDK direct with native streaming, `@nestjs/throttler`) and explicitly left four things undecided as follow up, calling one of them a correctness bug, not a tone issue, if skipped: the request and response contract for `/stories` and `/conversation/turn`, the server sent events (SSE) stream shape, the `/stories` seeding script's handling of KNOWLEDGE_BASE.md's finer ownership tags, and how the "never overclaim ownership" rule is mechanically enforced rather than just prompted and hoped for. This spec settles all four.

`apps/api` currently has only Prisma's starter `Author`/`Post` models; none of the real schema exists yet. `apps/web/src/lib/api.ts` already defines the pre streaming contract (`fetchStories()`, `fetchNextTurn(history, topicId?)` returning a plain `ConversationTurn[]`), which this spec supersedes on the `/conversation/turn` side (moving to SSE) while keeping `/stories`' plain fetch shape.

During the data model discussion, the engineer raised a real gap: `@nestjs/throttler`'s per IP request count (spec 0001's plan) does not catch a different abuse pattern, few requests that are each abnormally large (an inflated `history` payload, or a response coaxed to run long), and asked whether tracking token counts could help identify a source `@nestjs/throttler` cannot catch on its own. That reasoning is sound and is what pulled per turn `tokenCount` and a hashed IP into the data model, and from there, a way to actually look at that data (the dashboard) rather than let it sit unqueried in Postgres.

Two forces shaped this decision, matching the framing already established in spec 0001: staying resume and interview prep relevant (a deliberate learning project, not a funded product), and staying cheap and low ops (solo, no revenue). The engineer's choice of better auth for the dashboard's single admin login, over this session's recommended lighter weight shared secret token, follows the same pattern already accepted in spec 0001 for NestJS and Prisma themselves: a deliberately heavier, more resume relevant tool chosen for real practice, even where the dashboard's actual functional need (gate one page from one person) would be satisfied by something much smaller.

## Options considered

### Option 1: The contract as specced (chosen)

One turn pair per `/conversation/turn` call, topic scoped conversations that reset per topic, a small curated topic list distinct from the raw story bank, a hard turn pair cap with an explicit wrap up turn, token level SSE streaming, and a two layer ownership enforcement mechanism (constrained grounding to one story at a time, plus a deterministic post generation guard that falls back to a scripted answer rather than trusting a second AI attempt). The usage dashboard reuses the same Postgres database, gated by better auth.

**Pros**:
- Directly answers all four follow up items spec 0001 left open, including the one it called a correctness bug.
- The ownership guard is mechanical (a blocklist check and a scripted fallback), not just an instruction the model might ignore, which is what PROJECT_BRIEF.md's own bar for this required.
- Token level SSE streaming actually delivers on spec 0001's stated reason for choosing native streaming in the first place (progressive, not dead air).
- Reuses the existing Postgres database and Prisma setup for the dashboard; no new database, no new hosting account.

**Cons**:
- The most surface area of any option here: four new entities, two new endpoints beyond the original two, a new auth library, and a new internal page, where the original ask was a contract for two existing endpoints.
- better auth's NestJS integration is community maintained, not official (see References), a real dependency risk on a stack this session otherwise kept to officially supported pieces.

### Option 2: Minimal contract, no dashboard, no tokenCount

Keep `/stories` and `/conversation/turn` close to their current shape (one call returns a full turn pair as plain JSON, no SSE), skip per turn `tokenCount` and `hashedIp`, and leave usage visibility to whatever Render's own request logs show.

**Pros**:
- Smallest possible surface; ships fastest; no new auth library, no new page, no dashboard to maintain.
- Matches the two endpoints spec 0001 actually named as the app's functional need.

**Cons**:
- Drops native streaming's actual payoff (spec 0001 chose it specifically so a visitor watches the answer appear, not to just fetch faster); a plain JSON response makes that choice pointless.
- Leaves the "few large requests" abuse pattern the engineer specifically raised uncaught; Render's own logs are not queryable for this without real work either.
- Still leaves the ownership enforcement question unresolved, which is the one item spec 0001 called correctness, not style.

### Option 3: Full contract and tokenCount, but no dedicated dashboard (use Prisma's own Console/Studio instead)

Same conversation engine design as Option 1 (SSE, ownership guard, tokenCount, hashed IP), but skip the custom internal page and auth library entirely; view the data by browsing the tables directly in Prisma Postgres's own hosted console.

**Pros**:
- Zero new code and zero new vendor or auth library for visibility; the data already lives in a database you can already browse.
- Removes the one real dependency risk in Option 1 (better auth's non official NestJS integration) entirely.

**Cons**:
- No aggregation (daily totals, top sources by token count) without hand writing SQL each time you check; a raw table browser is not a dashboard.
- Was offered as the recommended pick in this session and the engineer explicitly chose a custom page instead, for the auth practice value, matching the project's established pattern of picking the more resume relevant tool over the objectively smaller one (see Context).

## Rationale

Option 1 was chosen because it is the only option that closes every open item spec 0001 flagged, including the one item spec 0001 explicitly named as a correctness bug rather than a style concern (basis: spec 0001's own Follow up section). Option 2 was set aside because it undoes spec 0001's own stated reason for choosing native streaming, and leaves unresolved the exact question that follow up section said must not be skipped. Option 3 was the honestly smaller and lower risk option, and was the recommended pick during the design conversation; it was set aside on the engineer's explicit choice, made with the tradeoff (a real but community maintained dependency, more setup than the dashboard's actual functional need) stated plainly, not hidden. That choice fits the same pattern spec 0001's own rationale already accepted for NestJS and Prisma themselves: real auth practice with the stack the engineer is using, deliberately over the objectively right sized answer, for resume and learning value (basis: PROJECT_BRIEF.md's own framing, carried over from spec 0001).

Within Option 1, grounding each Tony turn to exactly one selected Story record, rather than handing the model the full free text knowledge base every time, was the engineer's own design direction during this session; it directly reduces the surface a model has to go wrong on (nothing to blend claims from a different story), and reuses KNOWLEDGE_BASE.md's own existing pattern (story 11's pre written "scripted honest answer") as the `requiredFraming` fallback text rather than inventing a new mechanism. Falling back to that scripted text, instead of a second AI attempt, when the deterministic guard fires was the engineer's explicit choice over a regenerate and hope approach, and is the more defensible one given PROJECT_BRIEF.md's own framing of an overclaim as a correctness bug: a guaranteed correct canned answer beats a second unsupervised attempt that could fail the same check again, at the cost of that one turn reading slightly less freshly phrased.

## References

**Project sources** (verifiable, in this repo):
- `docs/specs/_root/0001-backend-ai-stack/index.md`, the accepted base stack and the four item Follow up this spec closes
- `PROJECT_BRIEF.md`, "visitor watches or steers, does not type their own answers", which bounds the whole request surface to no free text visitor input
- `KNOWLEDGE_BASE.md`, the ownership tagged story bank, its "Explicitly NOT verified / do not claim" section (the never claim blocklist's source), and story 11's scripted honest answer pattern (the `requiredFraming` mechanism's source)
- `apps/web/src/lib/api.ts`, the pre streaming `ConversationTurn`/`Story` shapes and `fetchNextTurn` signature this spec supersedes on the conversation side
- Installed community skill: `better-auth-best-practices`, installed this session

**Practices & standards**:
- Token bucket style per IP rate limiting plus a persisted hard backstop for a public endpoint in front of a paid, metered API (continued from spec 0001)
- NestJS's built in Server Sent Events support (the `@Sse()` decorator returning an RxJS `Observable` of `MessageEvent`), the framework's standard approach for token level SSE streaming
- One way hashing (not storing raw values) for any identifier kept only for abuse pattern detection, not for contacting or identifying a real person

**Links** (web verified during this session's tool discovery and landscape check):
- Anthropic Messages API streaming, `client.messages.stream()` and prompt caching via `cache_control: { type: "ephemeral" }`: https://platform.claude.com/docs/en/build-with-claude/streaming
- better auth's Prisma adapter and schema generation CLI: https://better-auth.com/docs/adapters/prisma
- better auth's NestJS integration (community maintained, via `@thallesp/nestjs-better-auth`, not an official better auth package): https://better-auth.com/docs/integrations/nestjs
- better auth's official MCP server (documentation search and setup assistance): https://better-auth.com/docs/ai-resources/mcp
- better auth Agent Skills registry: https://skills.sh/better-auth/skills/
