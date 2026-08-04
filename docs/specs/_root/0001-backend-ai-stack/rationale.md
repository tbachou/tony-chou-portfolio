# Rationale: 0001, Backend, data, and AI stack for the interview simulator API

## Context

apps/api has not been started (0 source files). PROJECT_BRIEF.md already names NestJS and TypeORM as a deliberate choice, made mainly for learning value and resume framing, not because the app's two endpoints (GET /stories, POST /conversation/turn) need that much structure on their own. The engineer confirmed during this session that they were not fully confident that choice was locked in, and asked to reconsider the backend, data, and AI layers specifically. The frontend, apps/web on Next.js and React Three Fiber, was scaffolded in an earlier session and stayed out of scope here.

Two forces shaped this decision equally: staying resume and interview prep relevant (the engineer explicitly wants this project to reinforce system design understanding, not just produce a working demo), and staying cheap and low ops, since this is a solo, no revenue, no auth portfolio piece, not a funded product. POST /conversation/turn is public and calls a paid LLM API, so rate limiting is a hard requirement, not a nice to have; that shaped both the framework pick (NestJS ships an official throttler) and the hosting pick (a single instance free tier keeps in memory throttling correct).

No AGENTS.md or docs/ existed before this spec, so there was no prior recorded project context beyond PROJECT_BRIEF.md and KNOWLEDGE_BASE.md, which this spec treats as informal, pre workflow context rather than authoritative project context.

> ⚠️ Premise note: A NestJS service with a hosted Postgres database and an ORM is real operational weight for an app whose actual job is one read only list endpoint and one LLM proxy endpoint; a serverless function (Next.js API routes, or a single small service) would satisfy the functional requirement with far less to run and pay for. This is a known pattern worth flagging: building more system than the product needs. Here it is a deliberate, stated tradeoff, not an oversight. Both PROJECT_BRIEF.md and the engineer's own words in this session, "the whole purpose is to showcase what I have learned and can do, reinforce my understanding for system design, so I can prep for technical interview," name the learning and resume value as the actual goal, which the simpler serverless option would not deliver. The engineer may still want to reconsider this later if the extra hosting, cold starts, and moving parts stop feeling worth it; Option 2 below is what that would look like.
>
> This note originally justified NestJS's weight but not Postgres's: 21 hand authored, read only, never mutated story rows do not, on their own, need a relational database, and a stricter reading would have this app run on no database at all (a typed constant or JSON file in apps/api), which beats even Option 3 below on its own ephemeral filesystem critique. An independent cross check of this spec raised exactly that gap. The resolution kept Postgres, but on the condition that it earns the line: it now also persists conversation transcripts and the daily rate limit counter (see Proposed stack), giving it a genuine write path, real query patterns, and an actual system design story to speak to in an interview, rather than standing in only for setup practice.

## Options considered

### Option 1: NestJS, Prisma, Prisma Postgres, Render, Anthropic SDK (the practice stack, chosen)

A dedicated NestJS service with Prisma against a hosted Postgres database, deployed on Render, calling Claude directly for the AI conversation, throttled in memory. The database was Neon at first pick, then reconsidered to Prisma Postgres later in the review, see Rationale below.

**Pros**:
- Delivers the specific, named learning and resume goals (NestJS, a real relational database, a rate limited public API) intact.
- Render, Prisma, and NestJS each have an official or well used Agent Skill and an MCP server, found and mostly installed this session, which will make building it faster and more accurate.
- Free at this app's expected traffic (Render and Prisma Postgres free tiers).

**Cons**:
- The most moving parts of any option here: a separate deployed service, a hosted database, cross origin setup, cold starts.
- More could go wrong operationally (the free tier spin down, the single instance rate limit assumption) than a simpler option would risk.

### Option 2: Next.js API routes only, Prisma, Neon Postgres, Vercel (the minimal stack)

Skip the separate NestJS service. Both endpoints become Next.js route handlers, deployed alongside the frontend on Vercel, same Prisma and Neon Postgres underneath.

**Pros**:
- One deployment target instead of two; no cross origin configuration; no separate hosting account or cold start behavior to explain.
- Genuinely right sized for the two endpoints this app actually needs.

**Cons**:
- Drops the NestJS practice and the "built a real backend service" resume line entirely, the main reason this option was set aside.
- Serverless functions have their own real limits (execution time, no persistent connections without a pooling proxy) that a small, always on NestJS service does not have to think about yet.

### Option 3: NestJS, Prisma, SQLite, Render (the zero external database stack)

Same NestJS and Prisma choice, but SQLite as a local file instead of a hosted Postgres database.

**Pros**:
- Zero database account or connection string to manage; works identically local and deployed if the host's filesystem persists.
- One less external service in the stack.

**Cons**:
- Many hosts, Render's free tier included, use an ephemeral filesystem: the SQLite file can be wiped on redeploy or restart, silently losing the story data. Working around that (a persistent disk, or a service like Turso) reintroduces the same "manage a database service" cost this option was meant to avoid.
- Postgres is the more broadly resume relevant database skill; SQLite in production is a weaker line to bring up in an interview.

## Rationale

Option 1 was chosen because it is the only option that keeps the engineer's stated goal, a project that demonstrates and reinforces real backend system design, fully intact (basis: PROJECT_BRIEF.md's own framing, and the engineer's explicit "reinforce my understanding for system design" answer during this session). Option 2 is the technically right sized choice for the functional requirement alone, and was raised directly in the Premise note; it was set aside because right sizing was never the actual goal here, learning and resume signal was. Option 3 was set aside narrowly: it keeps NestJS and Prisma but trades a small setup cost (a Neon account) for a real risk (silent data loss on an ephemeral host), a bad trade for the size of the saving.

Within Option 1, Prisma over TypeORM was the engineer's own call during the stack walk, overriding PROJECT_BRIEF.md's original TypeORM framing; Prisma currently has more active development and tooling polish, and TypeORM's learning value was a means to a resume line, not an end in itself, so the override does not work against the goal (basis: Prisma or TypeORM in 2026). Anthropic's Claude over OpenAI was also the engineer's own call, overriding this session's recommendation of OpenAI, which was based on OpenAI already being a named skill in KNOWLEDGE_BASE.md; Claude is an equally strong fit for the strict, ownership tag grounded persona this app needs, and using it is itself a new, real fact worth adding to the resume once shipped, see Follow up in index.md.

During the confirmation review, the engineer added streaming (the Anthropic SDK streams natively, so this did not require the Vercel AI SDK after all, a correction to the original AI integration reasoning), then added Docker on Render and Turborepo on top of the already accepted stack, each individually justified the same way every other pick in this spec was: a deliberate skill practice choice. Stacked together, that pattern stopped being self correcting: every choice defended on its own terms compounds into more total system than a 2 endpoint app needs, which is itself the Premise note's concern, now showing up at the tooling layer, not just the framework layer. The engineer asked directly whether the system had gotten too complicated for the sake of learning. The honest answer was yes, specifically at Turborepo: its value depends on packages/shared holding real code and a build actually being slow, neither true yet. Turborepo was cut on that basis.

The database host was then reconsidered separately: Neon versus Prisma's own Prisma Postgres, a real, current, generally available product built on Prisma's own infrastructure, not Neon under the hood. Prisma Postgres removes the database's own cold start entirely and the pooled/direct URL split, at the cost of Neon's database branching feature and being the newer product of the two. The engineer picked Prisma Postgres, one vendor for ORM and database instead of two, and in the same message also cut Docker, which had been kept through the first complexity pass on the grounds that container skills are broadly transferable. On reflection that reasoning still held on its own terms, but with NestJS, Prisma, Prisma Postgres, and streaming already new in this stack, Docker was one more new piece the engineer judged not worth adding at the same time, the same complexity discipline applied a second time rather than a one off exception. The final stack is NestJS, Prisma, Prisma Postgres, and Render's native buildpack: every remaining piece maps to either the stated learning goal or a real functional requirement (streaming, rate limiting), and nothing is carried for its own sake.

## Reconsidered: Arcjet for bot detection and abuse prevention (2026-08-03)

After the initial build, the engineer asked whether the already decided rate limiting plan was enough to stop the public /conversation/turn endpoint from being abused, and specifically whether Arcjet (a hosted bot detection and rate limiting tool) would help, wanting to make sure the answer was a good tradeoff and not just more system for its own sake, the same discipline that cut Docker and Turborepo earlier in this spec.

**What Arcjet would add.** A dedicated `@arcjet/nest` package gives basic, fully server side bot signals (user agent pattern matching, IP reputation, reverse DNS) with a small amount of integration code. Its stronger detection, called Advanced Bot Signals, catches automation that mimics a real browser session, but that detection depends on a WebAssembly telemetry collector running in the browser tab.

**Why it was not adopted.** Three reasons, checked against current Arcjet documentation and pricing:
- The endpoint this would protect is a pure backend API, not a browser rendered page. A scripted abuser calls it directly and never runs the browser telemetry collector, so Advanced Bot Signals, Arcjet's actual differentiator, does not see that traffic at all. Only the basic, easily spoofed user agent and IP checks would apply, a weak improvement over what is already planned.
- Arcjet is a hosted, SaaS dependent service: it needs its own account and API key, and the SDK calls out to Arcjet's servers for each decision. That is a new runtime dependency and a new vendor account on a project that already, on its own terms earlier in this spec, cut Docker and Turborepo specifically to avoid adding pieces that were not clearly earning their cost.
- Its free tier request limits are not published; the docs say it is "generous for side projects" without a number, which is not something to build a cost sensitive, solo, no revenue project's abuse plan around without contacting sales first. Separately, Arcjet's current package is ESM only and does not natively support CommonJS, which this project's apps/api deliberately kept (the engineer considered and declined a full ES module migration in the same session), so adopting it now would either need an experimental Node flag or reopening that closed question.

**Why the existing plan already covers the real risk.** The persisted daily counter in Postgres (see the Rate limiting row in index.md) caps total spend regardless of how abuse is distributed across IPs or how convincing the traffic looks, which is the actual financial exposure. Arcjet's marginal value on top of that is closer to a quality of service concern, keeping bots from eating the daily budget before real visitors arrive, than a spend risk, and that concern is real but low likelihood for a low traffic personal portfolio site. Anthropic's own console spend cap remains the last resort backstop either way.

**When to revisit.** If real abuse is actually observed in production logs or spend, or if a browser facing surface is added elsewhere in the app (a public facing form, for example) where Arcjet's browser telemetry based detection would actually apply, this is worth a fresh look.

## References

**Project sources** (verifiable, in this repo):
- `PROJECT_BRIEF.md`, the original NestJS and TypeORM learning goal framing
- `KNOWLEDGE_BASE.md`, the existing "OpenAI API" skills line that shaped, and was then overridden in, the model provider discussion
- Installed community skills: `nestjs-best-practices`, `prisma-database-setup`, `prisma-postgres`

**Practices & standards**:
- Monolith first, boring technology preferred over new and exciting, absent a specific constraint the boring choice cannot meet
- Token bucket style rate limiting for a public endpoint in front of a paid, metered API

**Links** (web verified during this session's landscape and tool discovery checks):
- Render platforms with a real free tier, 2026: https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026
- OpenAI SDK vs Vercel AI SDK comparison: https://strapi.io/blog/openai-sdk-vs-vercel-ai-sdk-comparison
- Rate limiting NestJS with Redis: https://oneuptime.com/blog/post/2026-03-31-redis-nestjs-rate-limiting/view
- Prisma or TypeORM in 2026: https://medium.com/@Nexumo_/prisma-or-typeorm-in-2026-the-nestjs-data-layer-call-ae47b5cfdd73
- SQLite vs PostgreSQL for serverless apps: https://www.kunalganglani.com/blog/sqlite-vs-postgresql-for-apps
- Prisma MCP Server docs: https://www.prisma.io/docs/postgres/integrations/mcp-server
- Render MCP Server docs: https://render.com/docs/mcp-server
- Prisma Postgres overview: https://www.prisma.io/docs/postgres
- Prisma Postgres launch blog: https://www.prisma.io/blog/prisma-postgres-the-future-of-serverless-databases
- Prisma Postgres vs Neon pricing comparison, 2026: https://www.prisma.io/blog/prisma-postgres-vs-neon-pricing-2026
- Arcjet NestJS reference docs: https://docs.arcjet.com/reference/nestjs/
- Arcjet bot protection docs: https://docs.arcjet.com/bot-protection/
- Arcjet advanced bot signals announcement: https://blog.arcjet.com/announcing-advanced-bot-signals-to-detect-automation-without-captchas/
- Arcjet pricing: https://arcjet.com/pricing
- Arcjet limitations: https://docs.arcjet.com/limitations
