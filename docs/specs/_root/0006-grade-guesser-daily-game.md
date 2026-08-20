# 0006. Grade Guesser, a daily climbing grade game

**Date**: 2026-08-20
**Status**: Proposed

## Summary

A daily game on the portfolio site: one photo of a boulder problem per day, the visitor guesses its V grade (the bouldering difficulty scale), then Claude's vision analysis of the same photo is revealed next to the true grade. The fun is comparing your read of the wall against the model's, and against everyone else's guesses. It runs on one model call per day, stores no visitor content, and reuses the site's existing web plus api shape.

## Context

The portfolio's climbing surfaces (Beta, the rehab planner) are serious by design. Research into the climbing app space (2026-08-20, recorded in the AWS GenAI track memory) found a proven but vacant niche: Crimpdle, a Wordle style daily grade guessing game, engaged climbers but shut down because curating videos by hand did not scale. Vision models remove that burden. A small daily game gives the site a return hook, a shareable moment, and a credible demonstration of vision reasoning (the model explains what it sees, not just a label), at portfolio demo cost.

Forces: the site's hard data boundary (no visitor typed content ever comes to rest, spec 0004 AC-6); demo economics (Beta style caps exist because a portfolio must not run away with an AI bill); two separate deploys (web on Vercel, api on Render) that share a repo but not a filesystem at runtime; and the owner supplies the photo pool, so content volume is small and curated.

Prerequisite with no spec: none. The feature depends only on decisions already specced (0001 backend stack, 0003 frontend platform) and on a photo pool the owner must produce (Follow-up).

## Requirements

**User stories**:
- As a visitor, I want to guess today's problem grade and immediately see how I did against Claude and the community, so that I have a reason to come back tomorrow.
- As the site owner, I want the game to cost about one model call per day and store nothing a visitor typed, so that it honors the site's cost and data rules.

**Acceptance criteria**:
- **AC-1**: every visitor on the same UTC day sees the same photo, chosen from the manifest by a deterministic date cycle (day index modulo pool size). The photo changes at midnight UTC.
- **AC-2**: the pre guess surface (`GET /grade/today` and the page source) never contains the true grade or the model's grade. The answer is only obtainable by submitting a guess.
- **AC-3**: submitting a guess (an integer 0 to 8) returns the true grade, the model's structured analysis (grade, confidence, observations, reasoning), the visitor's and the model's distance from truth, and the day's anonymous guess histogram.
- **AC-4**: at most one vision model call happens per UTC day, including under concurrent first guesses (atomic day row creation decides the single caller).
- **AC-5**: a failed vision call degrades gracefully: the guess response still carries the true grade and histogram with the model fields null, and a later guess retries the call. The visitor never gets an error page because the model failed.
- **AC-6**: the server stores and logs only anonymous integers for visitors (per grade guess counts, play counts). No free text input exists anywhere in the feature, and nothing visitor supplied is persisted or logged.
- **AC-7**: streaks and play history live only in the browser (localStorage) and are never transmitted.
- **AC-8**: the guess endpoint validates the guess as an integer 0 to 8 at the DTO boundary and is rate limited with the api's existing throttler.
- **AC-9**: a repo check (test or CI script) validates the manifest: unique ids, grades within 0 to 8, and every referenced image file present in the web app's public directory.
- **AC-10**: the page is a terminal themed route on the portfolio site with the repo's standard per page metadata and OG image conventions, playable on mobile widths. The game UI is a self contained component tree with no structural dependence on the terminal shell, so a later climbing branded host can re skin and re mount it without a rebuild.
- **AC-11**: after the reveal, a share button copies a spoiler safe emoji summary to the clipboard (day number, your grade, the model's grade, hit or miss marker, site link). Clipboard only: no share tracking, no visitor identifier, nothing sent to the server.
- **AC-12**: the portfolio home page carries a one line teaser for today's game (for example "Today's problem: can you out grade Claude?") linking to the page, so the game is discoverable in one click from the front door.

## Options considered

### Option 1: Live analysis once per day, cached (chosen)

The first guess of the day triggers one vision call; the structured result is stored on the day's row and served to everyone after.

**Pros**: real live model call (credible demo), fixed cost of about one call (~$0.02) per day, later visitors get an instant reveal.
**Cons**: the first guesser waits several seconds for the analysis; a cache row plus concurrency guard is needed.

### Option 2: Live analysis per visitor

Every guess triggers a fresh vision call.

**Pros**: most alive; shows model variance.
**Cons**: cost scales with plays and needs Beta style caps; variance means two visitors compare against different Claude guesses, which muddies the shared daily result.

### Option 3: Precomputed at curation time

A script analyzes each photo once when added; the site ships static JSON.

**Pros**: zero runtime cost, no api surface at all.
**Cons**: the "production GenAI" claim weakens to a batch script; the analysis text would ship in the page bundle, leaking the model grade pre guess (breaks AC-2 without extra machinery).

## Decision

**Chosen option**: Option 1: live analysis once per day, cached.

One vision call per UTC day, triggered lazily by the first guess, stored on the `GradeDay` row, served from cache to every later guess.

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `claude-api` (Anthropic vision API usage, `.claude/skills/claude-api/`)

## Rationale

The demo value of this feature is a live model doing visible reasoning, which rules out Option 3, and the daily game shape wants one shared Claude verdict per day, which rules out Option 2. Option 1 is also the cost shape the site already believes in: a fixed, tiny daily ceiling instead of per visitor spend, without needing Beta's cap machinery at all. The lazy fill (first guess pays ~10 seconds) is acceptable because it happens once per day and is presentable as a feature ("Claude is studying the problem"), and Render's free tier makes a midnight scheduler both unreliable (the dyno sleeps) and unnecessary.

Decisions settled here rather than asked, with the runner up noted: the vision model is `claude-sonnet-5` (one call per day makes quality the only axis; runner up Haiku 4.5 saves pennies that do not matter at this volume). The reveal returns plain JSON with a client side typewriter effect (runner up SSE re chunking; streaming a cached string is theater and adds an SSE surface for no visitor visible gain). The grading prompt lives as a skill file `apps/api/src/modules/grade/skills/grader.md` per the repo rule, and the model receives only the photo, never the manifest note or pool metadata, so its guess is honestly blind. The api builds the image URL for the vision call from the existing `CORS_ORIGIN` env var (it already holds the web origin on both environments), avoiding a new variable; Anthropic's vision API accepts URL source images, so no image bytes ever pass through the api. Replay abuse (a visitor re guessing via incognito inflates the histogram) is accepted: the data is anonymous fun, not a leaderboard, and defending it would cost identity tracking the data boundary forbids.

## Feature design

**Data model sketch**:

`apps/api/src/modules/grade/photos.json` (repo file, api side so grades never reach the client bundle):
| field | type | notes |
|---|---|---|
| id | string, required | unique, stable |
| file | string, required | filename under `apps/web/public/grade/` |
| trueGrade | int 0 to 8, required | the owner's gym grade |
| note | string, optional | location or credit line, shown after reveal |

`GradeDay` (Prisma, one migration; one row per UTC day):
| field | type | notes |
|---|---|---|
| date | string, PK | UTC date `YYYY-MM-DD` |
| photoId | string, required | manifest id for that day |
| modelGrade | int, nullable | null until the day's vision call lands |
| modelConfidence | string, nullable | low, medium, high |
| observations | string[], default [] | what the model saw |
| reasoning | string, nullable | the model's conclusion summary |
| model | string, nullable | model id used |
| inputTokens / outputTokens | int, default 0 | per call telemetry |
| guessCounts | int[], default 9 zeros | anonymous histogram, index = grade |
| plays | int, default 0 | atomic increment |

Browser localStorage (client only, never sent): streak count, last played UTC date, win/loss record.

Cross source link: `GradeDay.photoId` references `photos.json` ids; AC-9's repo check keeps manifest and image directory consistent.

**State transitions** (the `GradeDay` row): absent → created with guessCounts only (vision pending) → analysis filled. Both transitions happen inside the guess request; a row never goes back to pending.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /grade/today | GET | none | date, imageUrl, note?, poolSize | public, throttled | 503 no photos in manifest |
| /grade/guess | POST | guess:int 0 to 8 (req) | trueGrade, model {grade, confidence, observations, reasoning} or null, guessCounts, plays, yourDistance, modelDistance | public, throttled | 400 invalid guess, 429 throttled |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| GET /grade/today | date | server clock, UTC, `YYYY-MM-DD` |
| GET /grade/today | imageUrl | `CORS_ORIGIN` env + `/grade/` + manifest `file` |
| GET /grade/today | photo choice | days since epoch modulo manifest length, over ids sorted lexically (stable as photos are added) |
| POST /grade/guess | trueGrade | manifest row for the day's photoId |
| POST /grade/guess | model analysis fields | `GradeDay` row, filled by the day's one vision call (forced tool call schema) |
| POST /grade/guess | yourDistance / modelDistance | derived: absolute difference from trueGrade |
| POST /grade/guess | guessCounts, plays | `GradeDay` columns, atomic increments |
| share button | day number | derived: days since the game's launch date constant |
| share button | share text | composed client side from the reveal already on screen; nothing fetched |
| vision call | image | the same imageUrl, passed as an Anthropic URL source image |
| client reveal | streak | localStorage, computed client side from last played date |

**Key invariants**:
- One `GradeDay` row per date (PK); row creation uses an atomic insert (`ON CONFLICT DO NOTHING` semantics) and only the request that created the row (or finds analysis still null) runs the vision call, re checking after insert so concurrent first guesses cannot double call (AC-4).
- The true grade and model grade never appear in any response before a guess is submitted (AC-2).
- Histogram and plays only ever increment, by exactly 1 per guess request, whatever the vision call outcome (AC-6).
- No free text crosses the boundary: the request DTO is a single validated integer, so the feature has no injection surface by construction.

**Security model**: fully public, no auth, `@AllowAnonymous()` like Beta's endpoints. Both endpoints behind the existing `@nestjs/throttler` (guess tighter than today). No PII, no visitor content, no compliance scope. Photos are owner shot, so no third party copyright exposure.

**Configuration required**: none new. Reuses `ANTHROPIC_API_KEY`, `DATABASE_URL`, and `CORS_ORIGIN` (as the web origin for image URLs).

**Critical test scenarios**:
- Happy path: guess on a fresh day creates the row, runs one mocked vision call, returns truth, analysis, distances, histogram, verifies **AC-3**, **AC-4**.
- Concurrency: two simultaneous first guesses produce one vision call and two consistent responses, verifies **AC-4**.
- Failure case: vision call rejects; response still carries truth and histogram with model null; a subsequent guess triggers a successful retry and fills the row, verifies **AC-5**.
- Leak check: the today response and its DTO contain no trueGrade or model fields, verifies **AC-2**.
- Auth/permission: over limit requests receive 429 from the throttler; guess of 9 or "V5" receives 400, verifies **AC-8**.
- Manifest check: a manifest entry pointing at a missing file fails the repo check, verifies **AC-9**.

## Build plan

Tracer Bullet (the project's assumed default, per specs 0002 and 0004): a thin end to end thread first, then thicken.

1. Migration for `GradeDay` plus the `photos.json` manifest with 2 seed photos and the AC-9 repo check, satisfies **AC-9**.
2. Thin thread: `grade` api module (`GET /grade/today` with deterministic cycle; `POST /grade/guess` returning truth, distances, histogram, model null path only) with DTO validation and throttling, fully mocked tests, satisfies **AC-1**, **AC-2**, **AC-3** (partial), **AC-6**, **AC-8**.
3. Minimal `/grade` page: photo, grade buttons, reveal against truth and histogram, localStorage streak, satisfies **AC-7**, **AC-10** (partial); the game is now playable end to end without the model.
4. The vision call: `grader.md` skill file, forced tool call schema, lazy fill with the atomic single caller guard, failure degradation and retry, tokens logged per the api's structured line convention, satisfies **AC-3** (full), **AC-4**, **AC-5**.
5. Reveal polish: model observations and reasoning presentation (typewriter), "Claude is studying the problem" first guess state, the share button with its spoiler safe clipboard summary, metadata and OG image, mobile pass, satisfies **AC-10**, **AC-11**.
6. Discovery: the home page teaser line linking to the game, satisfies **AC-12**.
7. Content and gate: grow the pool to 10 or more photos, run `/predeploy-audit` before the shipping push.

## Consequences

**Positive**:
- A return hook and shareable moment the portfolio currently lacks, at a fixed ~$0.02 per day ceiling with no cap machinery.
- Demonstrates vision reasoning with a visible explanation, a stronger interview artifact than object detection.
- The share summary is the distribution engine if the game is ever put in front of climbers; it costs one button and stores nothing.
- Zero injection surface and zero visitor content by construction, the cleanest data boundary story on the site.

**Negative / tradeoffs**:
- The owner must produce and grade the photo pool; the game repeats photos every poolSize days until it grows.
- The first guesser each day waits several seconds for the reveal.
- Grade ground truth is one gym's opinion; the model (and visitors) may reasonably disagree, which the reveal copy should embrace rather than hide.
- A photo based OG image cannot include the day's answer flavor without spoiling; the OG stays static.

**Neutral**:
- New Prisma migration on the shared dev/prod database (the repo's known gotcha: dev runs consume nothing here since there are no caps, but the migration itself deploys with the api).
- The histogram double count via incognito replay is accepted and documented.

## Follow-up

- [ ] Owner: shoot and grade an initial pool (10 or more photos spanning V0 to V8) into `apps/web/public/grade/`; 2 seeds are enough to start building.
- [ ] **Climbing hub repositioning is its own decision**: whether a climbing branded surface (separate domain or subdomain) should house this game, Beta, and future climbing features, and when Beta joins it (its advertising prerequisites: monitoring, Bedrock Guardrails, budget raise). The game can lead that brand because it has none of Beta's launch blockers; run `/architect` on it when ready. This spec deliberately decides only the portfolio hosted version.
- [ ] After launch, consider a "how everyone guessed vs Claude over time" stats page from the accumulated `GradeDay` rows (anonymous by construction).
