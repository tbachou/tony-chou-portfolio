# 0004. Beta, a return to climbing rehab planner: decision record

## Context

The portfolio currently showcases two desktop apps (Panel and Carryover) that require downloading an unsigned macOS build and clearing Gatekeeper. Most visitors, recruiters especially, will never do that, so the strongest work is effectively invisible. The engineer wants a third project that is instantly usable in the browser, demonstrates the same multi agent design pattern, and, unlike the other two, ties together his clinical background (occupational therapy, NDT certified, neuro rehab) with a personal domain he knows first hand (climbing).

The forces: the app calls a paid AI API from a public, unauthenticated page, so cost and abuse control are load bearing, not optional. The engineer's API key must never reach a client. The subject is health adjacent, so the design must stay clearly on the educational side of the line, with screening that refuses to generate plans over warning sign symptoms. The existing monorepo already operates a NestJS API on Render with an Anthropic client, request throttling, a persisted daily usage counter pattern, and a Vercel hosted Next.js frontend; the engineer's explicit constraint was to reuse this stack and add no new external dependencies.

Not deciding means either no live demo (the portfolio stays download gated) or an ad hoc build that improvises on exactly the dimensions (spend control, safety posture, key handling) where improvisation is costly.

## Options considered

### Option 1: New NestJS module plus a Next.js route group in the existing monorepo

Beta becomes `apps/api/src/modules/beta` and `apps/web/src/app/beta`, reusing the Anthropic client module, throttler, Prisma database, deploy pipelines, and the API key already configured on Render.

**Pros**:
- Zero new infrastructure, keys stay in one place, counters reuse a proven pattern.
- The multi agent pipeline, rate limiting, and SSE streaming all have working reference implementations one directory away.
- One repo, one deploy story, one place to maintain.

**Cons**:
- Couples Beta's availability to the portfolio API's Render free tier (cold starts, shared quota).
- The portfolio monorepo grows another concern; it is no longer purely "the interview simulator plus static pages".

### Option 2: Next.js route handlers on Vercel, no NestJS involvement

Beta lives entirely in apps/web; the pipeline runs in Vercel serverless functions.

**Pros**:
- No cross origin hop, no Render cold start in the request path.
- Single workspace change.

**Cons**:
- The API key would now live on two platforms, doubling the exposure surface.
- Vercel functions are stateless, so the persisted counters would need new storage (KV or a direct Prisma connection from serverless, a new pattern either way).
- Reuses none of the existing NestJS modules; the throttler, counter, and logging work gets rebuilt.

### Option 3: Separate repo and separate deployment, like Panel and Carryover

A standalone app with its own hosting.

**Pros**:
- Clean product identity, independent scaling and availability.

**Cons**:
- Directly violates the stated constraint (reuse the stack, no new dependencies); new hosting, new key location, new deploy pipeline, new database or none at all.
- The portfolio's case study pattern already handles "separate product, surfaced on a project page" without a separate repo.

## Rationale

Option 1 wins on the two forces that matter most: key containment and reuse. Every hard requirement (server side key, layered rate limiting, persisted counters, SSE streaming, structured logging) already has an operating implementation in apps/api, so Option 1 turns most of the risk surface into copy adjacent work. Option 2's serverless counter problem is solvable but means new state infrastructure for a feature whose entire budget model depends on counters being trustworthy; that is the wrong place to introduce a new pattern. Option 3 fails the engineer's explicit constraint.

The engineer confirmed the recommended picks at each layer during the design conversation: the name Beta, the classic three injury scope, graded stage output, fully stateless persistence (amended in review to allow the two anonymous counter tables, since the per IP daily limit cannot survive restarts in memory), hard block red flag handling, the core form fields plus goals and training context, a blocking disclaimer gate, strictly one shot generation, the NestJS module home, Haiku for screening and coaching with Sonnet for drafting, the 3 per hour and 6 per day per IP plus 40 per day global limits, staged status with streamed final output, all four page sections, top of list surfacing with a live demo link, and the honest demo budget cap message.

Decisions settled by the architect within the confirmed direction: the success only counter semantics (failed attempts burn throttle, not budget), the `GET /beta/status` endpoint so the page can pre warn a spent budget, skill prompts as markdown files mirroring the Panel and Carryover pattern, one retry with a 60 second timeout per agent call, forced tool calls for the screener and drafter so their outputs parse reliably, DTO level length caps as the injection surface control, and Open Graph metadata in Beta's own identity rather than the portfolio's.

## References

None. The engineer chose no references; the reasoning above stands on the project's own specs (0001, 0003) and the existing code in apps/api.
