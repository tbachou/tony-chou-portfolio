# Interactive Portfolio App — Project Brief & Handoff

Start a new Claude session in this folder (`/Users/tonychou/source/portfolio`) and pick up from here. This doc + `KNOWLEDGE_BASE.md` in this same folder are everything needed to continue without re-deriving context.

## The idea

A public, no-auth portfolio web app centered on a **3D interactive room** (Three.js). The centerpiece is a simulated interview: the AI plays **both** the interviewer and an AI version of Tony answering, grounded strictly in verified facts about his real work history. Visitors (recruiters, hiring managers) watch or steer the conversation — pick a topic, watch the AI-Tony answer accurately, backed by real git-verified specifics rather than generic resume language. This is a portfolio centerpiece, not a private practice tool.

## Key decisions already made (don't re-litigate these)

- **AI role — "Showcase mode"**: AI generates both the interviewer's questions and Tony's answers. Visitor watches/steers; doesn't need to type their own answers.
- **V1 scope — full 3D from day one**: build the Three.js interactive room now, not a 2D placeholder first. (This was a deliberate choice against the lower-risk recommendation of 2D-first — go in with eyes open that this is the harder, slower path, but it's the one Tony wants.)
- **Backend — NestJS + TypeORM**, not Next.js API routes alone. Deliberate choice to get real practice with the stack Tony is currently learning, even though a public no-auth app doesn't strictly need this much backend. Treat "built a NestJS backend" as itself a resume-worthy line from this project.
- **Location**: `/Users/tonychou/source/portfolio` (separate from the `product-forge` client repo — do not mix them).
- **No auth required** — it's a public showcase app.

## Architecture

Monorepo with npm workspaces:

```
portfolio/
  apps/
    web/     — Next.js 15 (App Router) + React 19 + @react-three/fiber + @react-three/drei + Tailwind
    api/     — NestJS + TypeORM (not yet scaffolded)
  packages/
    shared/  — intended for shared TS types between web/api (not yet built; currently types are duplicated inline in apps/web/src/lib/api.ts — worth extracting once the API's real response shapes stabilize)
  KNOWLEDGE_BASE.md  — source of truth for all portfolio content (see below)
  PROJECT_BRIEF.md   — this file
```

## What's already built (apps/web only — apps/api is NOT started)

- `package.json` (root) — npm workspaces config, `dev:web`/`dev:api`/`build:web`/`build:api` scripts.
- `apps/web/package.json` — Next.js 15, React 19, three, @react-three/fiber, @react-three/drei, Tailwind. **Dependencies are declared but `npm install` has NOT been run yet** — no `node_modules` exists. Run `npm install` from the repo root before anything else.
- `apps/web/tsconfig.json`, `next.config.js` (transpiles `three`), `tailwind.config.ts`, `postcss.config.js` — standard config, nothing unusual.
- `apps/web/src/app/globals.css`, `layout.tsx` — minimal shell, dark theme (`#0a0a0f` background).
- `apps/web/src/components/InterviewRoom.tsx` — the actual 3D scene. **This is placeholder blocking, not final art**: a dark room (floor + back wall), a small table, and two capsule-and-sphere "figures" (blue = Interviewer, orange = Tony-AI) facing each other across the table, with floating text labels, ambient + directional lighting with shadows, `<Environment preset="city">` for reflections, and `OrbitControls` so visitors can look around. This proves out the Three.js/R3F pipeline and camera framing — replacing the capsule figures with real character models/animations is future work, not urgent.
- `apps/web/src/lib/api.ts` — typed fetch client for the (not-yet-built) NestJS API. Defines `ConversationTurn` (`role: 'interviewer' | 'tony'`, `text`), `Story` (`id`, `title`, `ownership: 'solo' | 'contributed' | 'co-led'`, `engagement`, `summary`), `fetchStories()` → `GET /stories`, `fetchNextTurn(history, topicId?)` → `POST /conversation/turn`. Expects `NEXT_PUBLIC_API_URL` env var, defaults to `http://localhost:3001`.

**Not yet built, and next in line:**
- `apps/web/src/components/ConversationPanel.tsx` — the 2D HTML overlay UI (transcript display, topic-picker buttons, sits on top of the 3D canvas as a HUD) that was about to be written when this session ended.
- `apps/web/src/app/page.tsx` — ties `InterviewRoom` + `ConversationPanel` together. Not started.
- `.env.local.example` for `NEXT_PUBLIC_API_URL`. Not started.
- The entire `apps/api` NestJS backend — nothing scaffolded yet. Needs: Nest project bootstrap (`main.ts`, `app.module.ts`), TypeORM connection (recommend SQLite for local dev — zero external DB setup, easy to swap to Postgres later for deployment), a `Story` entity mirroring the shape in `apps/web/src/lib/api.ts`, a seed script that loads `KNOWLEDGE_BASE.md`'s story bank into the DB, a `StoriesModule` (`GET /stories`), and a `ConversationModule` (`POST /conversation/turn`) that calls an LLM (Vercel AI SDK or OpenAI SDK directly) with the knowledge base as grounding context to generate the next interviewer question + AI-Tony answer pair.
- **Rate limiting on `/conversation/turn` is a real requirement, not a nice-to-have** — this is a public, no-auth endpoint that calls a paid LLM API. Without rate limiting, it's an open invitation to run up an API bill. Solve this early, don't bolt it on later.
- `packages/shared` — currently empty/unused. Extract `ConversationTurn`/`Story` types here once both apps exist, so frontend and backend don't drift.

## A known environment constraint worth knowing before you resume

Building this in the Cowork sandbox hit a real limitation: **background/detached processes (`nohup ... &`) do not survive past the end of a single tool call** — the sandbox appears to tear down child processes when the invoking shell exits, and each tool call may run in a fresh container. Long-running commands (`npm install`, dev servers) must run synchronously within a single call, and `npm install` for this stack will likely need to be split across multiple calls / resumed via cache rather than run once in the background. If continuing in a different environment (local machine, a real terminal, Claude Code with persistent shell access), this constraint may not apply — worth confirming rather than assuming it carries over.

## Content source of truth

`KNOWLEDGE_BASE.md` in this same folder contains the full, git-verified story bank this whole app is built to showcase — every claim tagged `[SOLO]`, `[CONTRIBUTED]`, or `[CO-LED]` based on actual commit-history verification (not memory), plus an explicit "do not claim" section. **The AI-Tony persona in the conversation engine must be grounded in this file and must preserve the ownership tags** — the entire point of this app is to be more honest and specific than a resume, not to regress into vague resume-speak once an LLM is generating the answers. If the LLM prompt for `/conversation/turn` doesn't explicitly instruct the model to respect these ownership boundaries, it will eventually generate an answer that overclaims something — guard against this directly in the system prompt, and consider it a correctness bug (not just a tone issue) if it happens.

## Suggested order of work for the next session

1. `npm install` from repo root (get `apps/web` actually installable/runnable).
2. Scaffold `apps/api` (NestJS + TypeORM + SQLite), get a bare `GET /stories` endpoint returning hardcoded data.
3. Seed real `Story` data from `KNOWLEDGE_BASE.md` into the DB.
4. Build `ConversationPanel.tsx` + `page.tsx` in the frontend, wire to the (still-hardcoded) API.
5. Build the actual `/conversation/turn` LLM endpoint, with the knowledge base as grounding and rate limiting from the start.
6. Only after the above works end-to-end with placeholder 3D figures: revisit `InterviewRoom.tsx` for real character models/animation if desired.
