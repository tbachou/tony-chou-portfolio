# 0003. Frontend deployment platform

**Date**: 2026-08-06
**Status**: Accepted

## Summary

This decides where the Next.js frontend (`apps/web`) actually deploys, closing a gap spec 0001 left open on purpose (that spec only covered the backend). The frontend deploys to Vercel, on its default free subdomain for now, while the backend stays on Render exactly as spec 0001 already decided. This settles the real values for `CORS_ORIGIN` and `NEXT_PUBLIC_API_URL` that spec 0001 named but left abstract, and gives the project a second distinct hosting platform to speak to, rather than repeating the same one twice.

## Context

Spec 0001 decided the backend stack (NestJS, Prisma, Prisma Postgres, Render, the Anthropic SDK) and explicitly scoped the frontend out of its decision, noting only that `apps/web` "stays as is" from an earlier session. It did name two config values the frontend's deployment would eventually need to settle: `CORS_ORIGIN` ("the deployed Next.js origin, plus localhost during dev") and `NEXT_PUBLIC_API_URL` ("points at the deployed apps/api origin"), but left both as placeholders since no deploy target existed yet. `PROJECT_BRIEF.md` is also silent on where `apps/web` should deploy.

Checking `apps/web`'s actual code before this decision: it has no `next/image`, no API routes, no middleware, and no server actions. It is a fully client rendered app (a 3D canvas plus client side `fetch()` calls against the separate NestJS API). This matters because it means no Next.js server side rendering requirement is forcing this choice; every realistic hosting option here works technically, so the decision comes down to platform tradeoffs (cost, operational simplicity, and the project's own stated goal) rather than a hard capability gap.

That stated goal, from `PROJECT_BRIEF.md` and echoed throughout spec 0001's own rationale, is real, resume worthy practice with the stack, not just the cheapest or easiest path. Spec 0001 leaned on this reasoning repeatedly (choosing NestJS over simpler Next.js API routes, for instance) while also cutting complexity that did not serve it (Docker, Turborepo). The same discipline applies here: the right choice adds genuine, distinct experience without adding needless operational surface for its own sake.

## Options considered

### Option 1: Vercel

Vercel is the company behind Next.js and its hosting platform is the framework's native, zero configuration target: connect the GitHub repo, point it at `apps/web`, and it builds and deploys automatically, including full support for any future server rendered Next.js feature without extra setup.

**Pros**:
- Zero configuration for Next.js, including any server rendered feature added later
- Free Hobby tier comfortably covers a low traffic portfolio site (1M edge requests, 1M function invocations a month)
- A genuinely different platform from the Render hosted backend, real and distinct deployment experience to speak to

**Cons**:
- The Hobby (free) tier's terms restrict commercial use; a personal portfolio is not commercial use under a normal reading, but it is worth knowing the term exists
- One more platform account and dashboard to manage, on top of Render and Prisma Postgres

### Option 2: Render, as a Static Site

Since `apps/web` has no server only Next.js feature today, it can be statically exported (`next build` with `output: 'export'`) and hosted on Render as a Static Site, the same platform already running the backend.

**Pros**:
- One platform for the whole project, one dashboard, one set of account level settings
- Unlimited page views on Render's static site free tier (bandwidth is the actual limit)

**Cons**:
- Only 5 GB a month of free bandwidth, the tightest limit of any option considered here
- Locks the frontend into static export; any future server rendered Next.js feature (an API route, `next/image`'s optimization, middleware) would force a re platform, not just a config change
- Same platform as the backend trades away a second, distinct deployment experience for marginal simplicity, working against the project's own stated practice goal

### Option 3: Cloudflare Pages

Cloudflare's static hosting platform, with genuinely unlimited bandwidth on its free tier. Server rendering is possible but runs through Cloudflare Workers rather than Next.js's own runtime.

**Pros**:
- Unlimited bandwidth on the free tier, the most generous of any option here
- A third distinct platform, in a genuinely different ecosystem (edge workers) from either Render or Vercel

**Cons**:
- Not Next.js native; server rendering (if ever needed) means learning Cloudflare's Workers model on top of Next.js itself
- A third platform and account, more than this decision needs to add for the practice value it buys

### Option 4: Netlify

A general purpose static and Jamstack hosting platform, a reasonable middle ground between Vercel's Next.js native fit and Cloudflare's more generic model.

**Pros**:
- Generous free tier (roughly 15 GB bandwidth a month)
- Straightforward git based deploys, similar workflow to Vercel

**Cons**:
- Less Next.js native than Vercel; some server rendered features need Netlify specific adapters
- Does not add meaningfully more practice value than Vercel while being less purpose built for this exact framework

## Decision

**Chosen option**: Option 1: Vercel.

The frontend (`apps/web`) deploys to Vercel, on its default `*.vercel.app` subdomain for now (no custom domain yet), building and deploying automatically from the GitHub repo with `apps/web` set as the project root.

**Implementation skills**: `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.agents/skills/vercel-react-best-practices/`)

## Rationale

Since `apps/web` has no current server side rendering need (confirmed by reading its code, not assumed), every option considered here works technically; the deciding forces are the ones Context names: cost, operational simplicity, and the project's own repeatedly stated goal of real, resume worthy stack practice over the merely convenient path.

Render as a Static Site is the "one platform" answer, but it buys that simplicity by locking the frontend into static export and accepting the tightest bandwidth limit of any option, while also giving up a second, genuinely different deployment experience the project's own rationale (spec 0001) has valued consistently. Cloudflare Pages and Netlify are both reasonable, but neither adds more practice value than Vercel while Vercel is also the framework's own native platform, the path most real Next.js teams actually use, and worth knowing firsthand for exactly that reason. Vercel's free tier comfortably covers this project's actual traffic, and its commercial use restriction does not apply to a personal portfolio under a normal reading, so the cost concern is not a real constraint here.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Hosting, frontend (`apps/web`) | Vercel | Native zero configuration fit for Next.js; a genuinely distinct platform from the Render hosted backend, real practice value rather than redundancy |
| Frontend domain | Vercel's default subdomain (`*.vercel.app`) | Simplest to ship now; a custom domain can be added later without changing `CORS_ORIGIN`'s shape, only its value |
| Backend hosting and domain | Unchanged: Render, `*.onrender.com` (spec 0001) | No new decision needed; this spec only resolves the frontend side |
| Preview deployment access | Not allowed to call the live API | `CORS_ORIGIN` stays a small, fixed list (localhost plus the one production origin); Vercel's automatic per branch preview URLs will hit CORS errors calling `apps/api`, an accepted tradeoff for a solo project |

**Configuration required**:
- `CORS_ORIGIN` (`apps/api` side, Render environment variable): `http://localhost:3000,https://<vercel-project>.vercel.app`. The exact `<vercel-project>` subdomain is only known once the Vercel project is created, see Follow up.
- `NEXT_PUBLIC_API_URL` (`apps/web` side, Vercel environment variable): the existing deployed `apps/api` Render URL (unchanged from spec 0001's intent), e.g. `https://<service-name>.onrender.com`. Scoped to the **Production** environment only in Vercel's settings, not Preview or Development, so a preview deployment never picks it up.

**Deploy pipeline** (Vercel, npm workspaces monorepo):
- Framework preset: Next.js, auto detected
- Root directory: `apps/web` (tells Vercel which workspace to build; it still installs from the repo root so the workspace's dependencies resolve correctly)
- Build and install commands: Vercel's Next.js defaults, no override needed
- Environment variable: `NEXT_PUBLIC_API_URL` set in the Vercel project's settings, scoped to Production only
- Deploy trigger: push to `main` deploys to production; every other branch or pull request gets an automatic preview URL, which per the decision above cannot successfully call the live API

## Consequences

**Positive**:
- Zero configuration Next.js hosting; any future server rendered feature (an API route, image optimization, middleware) works without a re platform
- A genuinely distinct platform from Render adds real, speakable practice and resume breadth rather than repeating the same experience twice
- Free tier comfortably covers this project's actual, low traffic use

**Negative / tradeoffs**:
- Two separate hosting platforms (Render, Vercel) instead of one, two dashboards and two sets of environment variables to keep in sync
- Vercel's Hobby tier carries a non commercial use term; a personal portfolio reads as compliant under a normal interpretation, but it is worth knowing the term exists if this project's purpose ever changes
- Preview and branch deployments cannot call the live backend (a deliberate choice, not an oversight): with `NEXT_PUBLIC_API_URL` scoped to Production only, a preview build falls back to the code's `http://localhost:3001` default, which fails to connect from the visitor's browser (a connection error, not a CORS error, since the request never reaches `apps/api` at all). Testing a branch against real data means pointing it at `localhost` yourself, or against production directly

**Neutral**:
- `apps/web`'s `next.config.js` needs no change for this decision; Vercel supports the app exactly as it is today, unlike the Render static site alternative which would have forced `output: 'export'`
- The exact `CORS_ORIGIN` value stays a placeholder shape until the Vercel project actually exists and its subdomain is known (see Follow up)

## Follow-up

- [ ] Connect the Vercel MCP server (`https://mcp.vercel.com`, OAuth based, gives live access to deployment status, logs, and project config) in your own MCP settings; found and offered this session, connecting is a step only you can do.
- [ ] Once the Vercel project is created, take its actual assigned subdomain and set `apps/api`'s `CORS_ORIGIN` (a Render environment variable) to the real value; this spec names the shape, not yet the concrete subdomain.
- [ ] Update `apps/api/.env.example`'s `CORS_ORIGIN` line once the real Vercel URL is known, so local dev docs stay accurate.
- [ ] `vercel-react-best-practices` conventions are not yet in any `AGENTS.md` (none exists yet in this repo); once `/audit` creates a root `AGENTS.md`, this belongs in its `## Agent skills` section, alongside `nestjs-best-practices`, `prisma-database-setup`, `prisma-postgres`, and `better-auth-best-practices` from specs 0001 and 0002.
- [ ] If a custom domain is added later for either app, revisit `CORS_ORIGIN` and `NEXT_PUBLIC_API_URL` again; this spec deliberately deferred that.

## References

**Project sources**:
- `PROJECT_BRIEF.md`, the stated goal of real stack practice over the merely convenient path
- [spec 0001](0001-backend-ai-stack/index.md), the backend's Render decision and the `CORS_ORIGIN`/`NEXT_PUBLIC_API_URL` placeholders this spec resolves
- `apps/web`'s own code (`next.config.js`, `src/app`, `src/components`, `src/lib/api.ts`), read directly to confirm no server side rendering feature is in use

**Practices & standards**:
- Hosting a framework on its own creators' platform for the most native, lowest friction fit (Next.js on Vercel)

**Links** (web verified during this session):
- Vercel Hobby plan terms: https://vercel.com/docs/plans/hobby
- Render, deploying a Next.js app: https://render.com/docs/deploy-nextjs-app
- Render static sites: https://render.com/docs/static-sites
- Render, platforms with a real free tier (2026): https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026
- Cloudflare Pages, Next.js framework guide: https://developers.cloudflare.com/pages/framework-guides/nextjs/
- Vercel MCP documentation: https://vercel.com/docs/agent-resources/vercel-mcp
