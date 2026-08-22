# 0006. Grade Guesser, a climbing grade game

**Date**: 2026-08-20
**Revised**: 2026-08-21 (how the api gets the image, and where photos live)
**Revised**: 2026-08-22 (the daily cadence is dropped; see the revision in Options considered)
**Revised**: 2026-08-22 (R7's three open questions settled: AC-26, AC-27, and AC-12's owner)
**Status**: In Progress

The filename still says `daily-game` and is deliberately left alone, because other specs and commits link to it. The title is what changed.

## Summary

A game on the portfolio site: a small fixed set of boulder problem photos, each one a puzzle the visitor guesses the V grade of (the bouldering difficulty scale), then Claude's vision analysis of the same photo is revealed next to the true grade. The fun is comparing your read of the wall against the model's, and against everyone else's guesses. It runs on one model call per problem, ever, stores no visitor content, and reuses the site's existing web plus api shape. Photos live in a private S3 bucket and are added by uploading them through an internal admin page, not by committing files and deploying.

It was designed as a daily game and built that way through R6. The cadence was dropped on 2026-08-22 because sourcing a photo every day is a content treadmill the owner cannot sustain, and because retention is a product goal this artifact does not have. Nothing about demonstrating vision reasoning required the day.

## Context

> Premise note (2026-08-21 revision): the change that triggered this revision is small, and the change being made is not. The vision call is broken because Bedrock will not take a URL image, and that alone is fixable in an afternoon by reading bytes off the repo checkout. Moving photos to S3, adding a table, and building an upload page is a much larger piece of work, chosen deliberately for a reason the bug did not raise: adding a photo should not require a commit and a deploy. That is a legitimate reason, and the cost is that the game stays unreleased longer, and the vision call (which has never once run against a real API) stays unproven longer. The build order below puts storage first at the engineer's direction, so the risk is accepted knowingly rather than discovered later.

The portfolio's climbing surfaces (Beta, the rehab planner) are serious by design. Research into the climbing app space (2026-08-20, recorded in the AWS GenAI track memory) found a proven but vacant niche: Crimpdle, a Wordle style daily grade guessing game, engaged climbers but shut down because curating videos by hand did not scale. Vision models remove that burden. A small daily game gives the site a return hook, a shareable moment, and a credible demonstration of vision reasoning (the model explains what it sees, not just a label), at portfolio demo cost.

Forces: the site's hard data boundary (no visitor typed content ever comes to rest, spec 0004 AC-6); demo economics (Beta style caps exist because a portfolio must not run away with an AI bill); two separate deploys (web on Vercel, api on Render) that share a repo but not a filesystem at runtime; and the owner supplies the photo pool, so content volume is small and curated.

Three forces surfaced on 2026-08-21 that the original decision did not account for. This game's grader is one of the surfaces that runs on Amazon Bedrock: `AI_PROVIDER=bedrock` governs every consumer of the `AI_PROVIDER` token, which is the interview simulator and this grader, but NOT Beta, which stays on the direct Anthropic API by construction (see `apps/api/AGENTS.md`). Bedrock's Anthropic surface rejects URL source images outright, so the vision call as specced could never have worked in production; it would have failed silently on every attempt, degrading through AC-5 into a reveal with the model fields empty. The feature flag gates the route and the api module but does not gate static assets, so the seed photos under the web app's public directory were served to the open internet the entire time the game was supposedly hidden. And the grader's model id is pinned to a first party name that Bedrock does not recognise, which is a second, independent failure on the same path.

Prerequisite with no spec: none. The feature depends only on decisions already specced (0001 backend stack, 0003 frontend platform) and on a photo pool the owner must produce (Follow-up).

## Requirements

**User stories**:
- As a visitor, I want to guess a problem's grade and immediately see how I did against Claude and against everyone else, so that I learn something about reading a wall. (Revised 2026-08-22: was "today's problem" and "a reason to come back tomorrow".)
- As the site owner, I want the game to cost about one model call per problem, ever, and store nothing a visitor typed, so that it honors the site's cost and data rules. (Revised 2026-08-22: was per day, which was an unbounded running cost; it is now a fixed one time cost for the whole set.)

**Acceptance criteria**:

> **Read this first, 2026-08-22.** The daily cadence was dropped (see the revision in Options considered). Six criteria below are superseded and are struck through where they appear: AC-1, AC-7, AC-19, AC-20 and AC-21 die outright, and AC-8's request shape changes. AC-22 to AC-24 replace them. Everything else stands unchanged, including every criterion R1 to R6 was built against.

- ~~**AC-1**: every visitor on the same UTC day sees the same photo, chosen from the manifest by a deterministic date cycle (day index modulo pool size). The photo changes at midnight UTC.~~ **Superseded by AC-22.**
- **AC-2**: the pre guess surface (`GET /grade/problems` and the page source) never contains the true grade or the model's grade. The answer is only obtainable by submitting a guess. **Extended 2026-08-22:** it also never contains a photo's `id`, because that id is the owner's slug and a slug like `north-gym-blue` names the circuit colour, which encodes the grade band. See AC-23.
- **AC-3**: submitting a guess (an integer 0 to 8) returns the true grade, the model's structured analysis (grade, confidence, observations, reasoning), the visitor's and the model's distance from truth, and that problem's anonymous guess histogram.
- **AC-4**: at most one vision model call happens per problem, ever, including under concurrent first guesses (atomic problem row creation decides the single caller). Previously per UTC day.
- **AC-5**: a failed vision call degrades gracefully: the guess response still carries the true grade and histogram with the model fields null, and a later guess retries the call. The visitor never gets an error page because the model failed.
- **AC-6**: the server stores and logs only anonymous integers for visitors (per grade guess counts, play counts). No free text input exists anywhere in the feature, and nothing visitor supplied is persisted or logged.
- ~~**AC-7**: streaks and play history live only in the browser (localStorage) and are never transmitted.~~ **Dropped 2026-08-22.** A streak measures consecutive days and there are no days. Play history in localStorage survives as the mechanism behind AC-24, and the no transmission rule stands wherever local state is kept.
- **AC-8**: the guess endpoint validates the guess as an integer 0 to 8 at the DTO boundary and is rate limited with the api's existing throttler. **Changed 2026-08-22:** the request carries the problem's public id instead of the UTC date it used to echo, validated as a fixed length hex string at the same boundary. The endpoint's input surface is still two machine shaped fields and no free text, which is what AC-6 rests on.
- **AC-9** (rewritten 2026-08-21): a photo row can never name an object that does not exist. The upload writes the S3 object first, then the row, and deletes the object if the insert fails. The guarantee is structural rather than a repo scan, because the manifest that scan read is removed in R2. The reverse is deliberately NOT guaranteed: a crash between the two writes, or a failed rollback delete, can leave an object with no row pointing at it. That is accepted, and it is harmless because object keys are random and never reused.
- **AC-10**: the page is a terminal themed route on the portfolio site with the repo's standard per page metadata and OG image conventions, playable on mobile widths. The game UI is a self contained component tree with no structural dependence on the terminal shell, so a later climbing branded host can re skin and re mount it without a rebuild.
- **AC-11**: after the reveal, a share button copies a spoiler safe emoji summary to the clipboard (**the problem's position in the set rather than a day number**, your grade, the model's grade, hit or miss marker, site link). Clipboard only: no share tracking, no visitor identifier, nothing sent to the server.
- **AC-12**: the portfolio home page carries a one line teaser linking to the game, so it is discoverable in one click from the front door. **Changed 2026-08-22:** the copy no longer refers to "today's problem", since there is no today.
- **AC-13** (added 2026-08-21): photos are stored in a private S3 bucket with all public access blocked. No game image is served from the web app's public directory, so turning the feature flag off actually hides the images too.
- **AC-14** (added 2026-08-21): `GET /grade/today` returns a presigned URL valid for one hour. AC-2 is unchanged: the response still carries no grade of any kind.
- **AC-15** (added 2026-08-21): the vision call sends image bytes read from S3, base64 encoded, tagged with the stored content type. It never sends a URL, so it works under either provider.
- **AC-16** (added 2026-08-21): the grader model id is resolved per provider. Under Bedrock a valid Bedrock model id is used; a first party model id is never passed to Bedrock.
- **AC-17** (added 2026-08-21): an internal admin page behind the existing better-auth guard uploads a photo (file, slug, true grade, source, optional note), lists the pool, and toggles a photo active or inactive. Uploads are capped at 10 MB, and every upload is decoded, resized so its long edge is at most 1568 pixels, and re encoded. Re encoding is not just for size: it strips EXIF metadata (a phone photo carries GPS coordinates, which a presigned URL would hand to every visitor) and it makes the stored content type the pipeline's own output rather than a client supplied claim that could be a lie. The admin endpoints live in a module that is always registered, so the pool can be filled while the game is still hidden.
- **AC-18** (added 2026-08-21): every photo records where it came from. When `GRADE_GAME_ENABLED` is true, a photo whose source is `unlicensed_test` is excluded from the daily cycle, and the api logs one line naming how many were excluded. The line is written when the daily cycle resolves the day's photo, not at startup: a boot time count goes stale the moment a photo is toggled without a redeploy.
- **AC-18** note, 2026-08-22: "excluded from the daily cycle" now reads "excluded from the served set". The licence gate itself is unchanged and still the reason the `source` column is required.
- ~~**AC-19** (added 2026-08-21): a guess carries the UTC date the visitor was shown. If that date is not the server's current UTC date, the guess is rejected with 409 and the client reloads the day.~~ **Dropped 2026-08-22.** There is no rollover, so there is no stale date to guard against. The guess names its problem directly (AC-8, AC-23), which is a stronger identity than a date ever was.
- ~~**AC-20** (added 2026-08-21, sharpened 2026-08-22): once a `GradeDay` row exists, the image, the true grade and the analysis for that date all come from the photo the row pinned.~~ **Dropped 2026-08-22.** Pinning existed to answer "which photo is today", and a fixed set never asks. The problem IS the identity.
- ~~**AC-21** (added 2026-08-22): serving the day pins the day.~~ **Dropped 2026-08-22, hours after it was written.** Worth leaving visible rather than deleting: AC-21 was a correct fix to a real bug inside the daily model, and the pivot deleted the model. The lesson is not that the fix was wrong, it is that a constraint one level up (where photos come from) was left unexamined while three rounds of gate work polished the level below it.
- **AC-22** (added 2026-08-22): the game serves a **fixed set**. `GET /grade/problems` returns every active photo the licence gate allows, in a stable order, each with a presigned URL and its public id and nothing else. There is no schedule, no rollover, and no notion of today anywhere in the api or the page.
- **AC-23** (added 2026-08-22, simplified the same day): a problem is addressed publicly by an **opaque id that is the random hex basename of its `objectKey`**, never by its slug. The slug is the owner's name for the problem and typically carries the gym circuit colour, which encodes the grade band, so exposing it would hand the visitor a hint before they guess and break AC-2. **No new column.** `newObjectKey` already produces `photos/<random hex>.<ext>` under a unique constraint, so the value is already random, already opaque, already server generated, already unique, and already present on every existing row. A first draft of this criterion added a `GradePhoto.publicId` column; that was strictly worse, because a required unique column on a table that already holds rows needs a backfill and a collision policy, and it would have made the migration fail.
- **AC-24** (added 2026-08-22): the page records which problems the visitor has already revealed, in localStorage only, and shows progress through the set (for example "4 of 8 read"). Nothing is transmitted, and clearing it costs nothing but the marker. This replaces the streak and is the only retention mechanic that survives.
- **AC-25** (added 2026-08-22): the page presents **one problem at a time** with a control to move to the next, not the whole set as a list. `GET /grade/problems` therefore returns the ordered public ids **without** presigned URLs, and a second call presigns a single problem on demand, so a visitor who reads two problems mints two URLs rather than ten. This also keeps a one hour presign from expiring under a long sitting, because each is minted at the moment it is shown.
- **AC-26** (added 2026-08-22, settled for R7): a revealed problem's reveal is cached in the browser beside the AC-24 marker, keyed by public id, and returning to that problem (a refresh, or stepping back through the set) restores it read only instead of offering the guess pad again. Nothing is transmitted and no second server call is made, so reloading cannot inflate the histogram. The cached histogram is the counts at the moment that visitor played, and is labelled as such, because other visitors keep playing after it is stored. **A server side "read the reveal without guessing" route is impossible here and was not merely rejected:** it would have to be unauthenticated, since the data boundary forbids any visitor identity, so anyone could call it and read the true grade and the model's answer without ever guessing. That is AC-2 broken outright. The browser is therefore the only place a reveal can survive.
- **AC-27** (added 2026-08-22, settled for R7): every photo in the released set shows one unambiguous line. Gym walls carry several circuits and nothing in the response says which one to grade, so the photo itself has to answer it, by framing or by the wall being clear. This is the one rule in this spec held by the owner's care rather than by the schema, and that is a deliberate choice: the obvious alternative, an owner written route note, is a migration and an admin field for a problem a curated pool of five to ten photos may never actually have. See the Follow-up for the trigger that reopens it.

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

### Revision 2026-08-21: how the api gets the image, and where photos live

The original decision (URL source images, photos committed under the web app's public directory) cannot work under Bedrock. Three ways forward were weighed.

**Option A: read bytes from the repo checkout (rejected)**

The api reads the file off disk (the whole repo is checked out on Render) and base64 encodes it.

**Pros**: smallest possible change; no new infrastructure; works on a laptop, which finally makes the vision call testable.
**Cons**: adding a photo stays a commit, a push and a deploy, which is the opposite of what the owner wants; and the photos stay public assets, so the exposure just fixed comes straight back at release.

**Option B: fetch the public URL, then encode (rejected)**

The api fetches the same URL the browser uses and encodes the response body.

**Pros**: one source of truth, since the model sees exactly what the visitor sees; photos stay out of the api deploy.
**Cons**: keeps a network dependency and a new failure mode on the vision path; still cannot run locally unless the origin is public; and it solves none of the storage or exposure problems.

**Option C: private S3 bucket, presigned URLs, upload through the api (chosen)**

Photos live as objects in a private bucket. A `GradePhoto` table holds the grade and metadata. The api reads bytes with the AWS SDK for the vision call, and mints a one hour presigned URL for the browser. An internal admin page uploads.

**Pros**: adding a photo needs no deploy; the bucket blocks all public access, so the exposure cannot recur; grades move to a store the api already runs; the vision call works under either provider; and it adds AWS surface that fits the certification track already underway.
**Cons**: by far the most work (bucket, IAM, terraform, a migration, an upload endpoint and an admin page) for a pool of perhaps ten photos; a presigned URL expires, so a page left open overnight shows a broken image until refresh; and it puts the game's content behind AWS credentials rather than in the repo.

### Revision 2026-08-22: the daily cadence is dropped

The 2026-08-21 revision solved how photos are stored and served. It did not solve where they come from, and that turned out to be the binding constraint. Every round from R1 to R6 built infrastructure for getting legally usable photos of real routes with a trustworthy grade attached, and R8 still asked the owner to shoot ten and then keep going indefinitely.

Two escape hatches were investigated on 2026-08-22 and both are closed. Generated route images cannot carry a grade, because nothing about the pixels constrains the label, so `trueGrade` becomes an assertion and any climber who disputes it is automatically right; this is a property of the idea, not of current model quality, so better models do not fix it. Standardized boards (MoonBoard, Kilter, Tension) do have a defensible crowdsourced grade on a fixed geometry, and are arguably better ground truth than one setter's opinion, but their data and layout imagery are legally closed right now. Prior art, Crimpdle, reportedly went dormant for exactly this reason.

That leaves self serve sourcing, which works: `own_photo` is a legitimate source and the single photo in the pool today uses it. The owner can photograph problems at a gym he climbs at and record their grade. The constraint is not permission, it is that a daily cadence makes that effort endless.

**Option A: keep daily, accept the treadmill (rejected)**

Nothing changes and the game keeps its return hook.

**Pros**: no rework; AC-1, AC-7, AC-11, AC-19, AC-20 and AC-21 all stay meaningful; the streak and the daily share are genuinely good mechanics.
**Cons**: commits the owner to sourcing photos forever, which is the failure mode the prior art demonstrated. Retention is a product goal this artifact does not have, so the treadmill buys something the portfolio does not need.

**Option B: a fixed set of problems (chosen)**

Five to ten problems, permanently available, no rollover and no schedule. The visitor works through them.

**Pros**: sourcing becomes a weekend once rather than forever; needs no partnership, no licence negotiation and no third party; the portfolio goal (vision reasoning with a visible explanation) is delivered identically; and the vision call cost stops being per day and becomes a one time cost per problem.
**Cons**: real rework. AC-1, AC-7, AC-19, AC-20 and AC-21 die, `GradeDay` is rekeyed, and AC-21 was written one hour before this revision. The game loses its reason to be revisited, so whatever return traffic a daily puzzle would have produced does not exist.

**Option C: fixed set plus crowd consensus (deferred, not rejected)**

As B, and the reveal shows the aggregate of player guesses beside the owner's grade rather than presenting one number as authoritative.

**Pros**: dissolves the ground truth objection that dogged the prior art, by refusing to claim more authority than a single gym's grade deserves; costs nothing new to store, since the histogram already exists.
**Cons**: needs players before the consensus means anything, so it reads as empty at launch. Recorded as a Follow-up rather than built now.

## Decision

**Chosen option**: Option 1: live analysis, cached. **Plus Option B of the 2026-08-21 revision (private bucket, uploaded photos) and Option B of the 2026-08-22 revision (a fixed set, no daily cadence).**

One vision call **per problem, ever**, triggered lazily by the first guess of that problem, stored on the `GradeProblem` row, served from cache to every later guess. Revised 2026-08-22: this used to read "per UTC day… on the `GradeDay` row", which was the cadence the revision removed. The caching shape is unchanged; only what it is keyed on moved from the date to the problem, and the total cost moved from unbounded and recurring to a fixed one time cost for the whole set.

**Implementation skills** (revised 2026-08-21): `aws-iam` (`.claude/skills/aws-iam/`, the bucket policy and the api's read and write policy) · `terraform-style-guide` (`.claude/skills/terraform-style-guide/`, the bucket and IAM in `infra/`) · `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`, the admin page guard) · `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`) · `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `claude-api` (Anthropic vision API usage, `.claude/skills/claude-api/`)

## Rationale

The demo value of this feature is a live model doing visible reasoning, which rules out Option 3, and the game wants one shared Claude verdict per problem rather than a fresh one per visitor, which rules out Option 2. Option 1 is also the cost shape the site already believes in: a fixed ceiling instead of per visitor spend, without needing Beta's cap machinery at all. The lazy fill (the first guess of a problem pays about 10 seconds) is acceptable because it happens once per problem and is presentable as a feature ("Claude is studying the problem"), and Render's free tier makes a scheduler both unreliable (the dyno sleeps) and unnecessary. **Revised 2026-08-22:** the per day framing throughout this paragraph became per problem, and the argument got stronger rather than weaker, because a finite set has a finite total model cost.

Decisions settled here rather than asked, with the runner up noted: the vision model is `claude-sonnet-5` (one call per problem makes quality the only axis; runner up Haiku 4.5 saves pennies that do not matter at this volume). The reveal returns plain JSON with a client side typewriter effect (runner up SSE re chunking; streaming a cached string is theater and adds an SSE surface for no visitor visible gain). The grading prompt lives as a skill file `apps/api/src/modules/grade/skills/grader.md` per the repo rule, and the model receives only the photo, never the note or pool metadata, so its guess is honestly blind. The api sends the photo to the model as base64 encoded bytes read from S3, and the browser loads the same photo through a presigned URL, so `CORS_ORIGIN` is no longer involved in images at all (revised 2026-08-21; see the revision rationale below). Replay abuse (a visitor re guessing via incognito inflates the histogram) is accepted: the data is anonymous fun, not a leaderboard, and defending it would cost identity tracking the data boundary forbids. **That acceptance carries more weight after 2026-08-22**, because a fixed set removes the one guess per day ceiling that used to bound it; see the open question in Follow-up.

**Revision rationale (2026-08-21).** Option A is the cheapest fix and would have been the right call if the only goal were an unbroken vision call. It was rejected because it leaves both of the real problems standing: adding a photo would still be a code change, and the photos would still be public files served whether the game is on or off. Option B keeps a network hop on the one call this feature makes per day, adding a failure mode to the exact path that has never successfully run. Option C costs the most and is worth it here for a specific reason: the pool is the thing this game is actually waiting on, and a pool that needs a deploy per photo is a pool that stays at two placeholders. Making the bucket private and handing the browser a presigned URL is what turns the earlier exposure from a mistake that was fixed into one that cannot recur. The required `source` field is the same instinct applied to copyright: the original spec claimed no copyright exposure because the photos would be owner shot, which was an assumption held only in memory. Now it is a column, and an unlicensed test image cannot reach a released game by being forgotten.

## Feature design

**Data model sketch**:

`GradePhoto` (Prisma, added by the 2026-08-21 revision; replaces `photos.json`, which is deleted). Api side so grades never reach the client bundle, exactly as the repo file was:
| field | type | notes |
|---|---|---|
| id | string, PK | owner set slug, for example `north-gym-blue-prow`; SERVER SIDE ONLY, never in a public response (AC-23) |
| objectKey | string, required, unique | the S3 key holding the bytes |
| contentType | string, required | `image/png`, `image/jpeg` or `image/webp`; the media type the vision call sends |
| trueGrade | int 0 to 8, required | the owner's gym grade |
| source | enum, required | `own_photo`, `permission_given`, `licensed`, `unlicensed_test` |
| sourceNote | string, optional | where it came from: a URL, a photographer, a permission reference |
| note | string, optional | location or credit line, shown after reveal |
| active | boolean, default true | the served set filters on this; rows are never deleted |
| createdAt | datetime, default now | |

`GradeProblem` (Prisma; **renamed and rekeyed from `GradeDay` on 2026-08-22**, one row per problem rather than one per UTC day). Production held zero `GradeDay` rows and the game had never been enabled, so this is a clean rename plus a primary key move, not a data migration:
| field | type | notes |
|---|---|---|
| ~~date~~ | ~~string, PK~~ | **Dropped.** There are no days. |
| photoId | string, **PK**, FK to `GradePhoto.id`, `onDelete: Restrict` | was a required non key column; it is now the identity. One row per problem, created the first time that problem is served or guessed. `Restrict` makes "rows are never deleted" structural rather than a habit |
| modelGrade | int, nullable | null until the day's vision call lands |
| modelConfidence | string, nullable | low, medium, high |
| observations | string[], default [] | what the model saw |
| reasoning | string, nullable | the model's conclusion summary |
| model | string, nullable | model id used |
| inputTokens / outputTokens | int, default 0 | per call telemetry |
| guessCounts | int[], default 9 zeros | anonymous histogram, index = grade |
| plays | int, default 0 | atomic increment |

`GradePhoto` gains **no column** on 2026-08-22. The public problem id is derived, not stored: it is the random hex basename of `objectKey`, which is already unique, already opaque and already on every row (AC-23). The lookup is `objectKey = 'photos/' || :publicId || '.' || ext`, or more simply an indexed exact match on `objectKey` once the client's value is expanded; settle the exact form in R6b, and note `GradePhoto_objectKey_key` already exists as a unique index.

Browser localStorage (client only, never sent): ~~streak count, last played UTC date, win/loss record~~ → **the set of public problem ids already revealed**, which is what AC-24's progress marker reads. Same rule as before: never transmitted.

Cross source link: `GradeProblem.photoId` is a foreign key to `GradePhoto.id`, and is now also its primary key, so the relation is strictly one to one. Object and row are kept consistent by the upload writing both or neither (AC-9), not by a repo check.

**State transitions** (the `GradeProblem` row): absent → created with guessCounts only (vision pending) → analysis filled. **Both happen inside a guess request**, exactly as before the revision. Serving `GET /grade/problems` creates nothing: pin on read existed only to answer "which photo is today", and a fixed set never asks. An earlier draft of this revision said "created on the first serve OR the first guess", which was the dropped AC-21 behaviour surviving by accident; it is not the design.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| ~~/grade/today~~ | ~~GET~~ | | | | **Replaced 2026-08-22 by /grade/problems** |
| /grade/problems | GET | none | problems[]: {publicId} in a stable order, and the count. **No image URLs** (AC-25) | public, throttled | 200 with an empty array when the set is empty; the page says so rather than erroring, because an empty pool is the owner not having uploaded yet, not a server fault |
| /grade/problems/:publicId/image | GET | publicId in the path | imageUrl, one hour presign | public, throttled | 404 no such problem, 410 the photo is inactive |
| /grade/guess | POST | guess:int 0 to 8 (req), publicId:hex (req) | trueGrade, model {grade, confidence, observations, reasoning} or null, note?, guessCounts, plays, yourDistance, modelDistance | public, throttled | 400 invalid guess or publicId, 404 no such problem, 429 throttled |
| /internal/grade-photos | GET | none | list: id, trueGrade, source, active, note, presigned image URL, ordered `createdAt` descending | better-auth admin | 401 |
| /internal/grade-photos | POST | file (req), id slug (req), trueGrade:int 0 to 8 (req), source enum (req), sourceNote?, note? | the created row | better-auth admin | 400 slug, grade or schema invalid, 409 slug taken, 413 over 10 MB, 415 unsupported media type |
| /internal/grade-photos/:id/active | PATCH | active:boolean (req) | the updated row | better-auth admin | 401, 404 |

The three `/internal/grade-photos` endpoints live in their own module, registered unconditionally. Only the public `GradeController` and the web `/grade` route stay behind `GRADE_GAME_ENABLED`. Without this the pool could not be filled until the game was already live, which is the opposite of the build order below. The admin list presigns the full size object rather than a real thumbnail; at ten photos that is fine, and it is called out so nobody later mistakes it for one. Error bodies are Nest's default `HttpException` shape, as everywhere else in the api.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| GET /grade/problems | the set | ACTIVE `GradePhoto` rows with `unlicensed_test` excluded whenever the game is enabled (AC-18), ordered by `createdAt` ascending so the order is stable and additions append rather than reshuffle |
| GET /grade/problems | publicId | derived, the random hex basename of `GradePhoto.objectKey`. **No `publicId` column exists**; an earlier draft of this row said there was one, which AC-23 reversed and R6b shipped without. Never the `id` slug (AC-23) |
| GET /grade/problems/:publicId/image | imageUrl | presigned S3 GET URL for that row's `objectKey`, one hour lifetime, minted when the problem is shown rather than when the set is listed (AC-25) |
| GET /grade/problems | side effect | none. The read is a pure read again, unlike the daily version, because there is no schedule to pin |
| POST /grade/guess | repeat guesses | allowed, and every one increments `plays` and the histogram. Consistent with the Rationale's existing acceptance of replay abuse: the data is anonymous fun rather than a leaderboard, and rejecting a repeat would need server side identity the data boundary forbids, so it could only ever be a localStorage honour system dressed as a 409. The existing throttle (5 per minute, 40 per hour, unchanged) is what bounds it |
| vision call | timing | still lazy, on the first guess of that problem. The first visitor to a problem waits about 10 seconds, presented as "Claude is studying the problem". Runner up considered and rejected: warming at upload, which would mean nobody ever waits but spends a call on photos that may be deactivated before release and puts a model call on the admin upload path |
| POST /grade/guess | problem identity | `publicId` from the request, resolved to a `GradePhoto` row. A deactivated photo still resolves here: only the LIST filters on `active`, so a visitor who loaded the set and guessed after a deactivation is still answered rather than erroring |
| POST /grade/guess | trueGrade | `GradePhoto.trueGrade` for the resolved row |
| POST /grade/guess | model analysis fields | `GradeProblem` row, filled by that problem's one vision call, ever (forced tool call schema) |
| POST /grade/guess | yourDistance / modelDistance | derived: absolute difference from trueGrade |
| POST /grade/guess | guessCounts, plays | `GradeProblem` columns, atomic increments |
| share button | problem label | derived client side: the problem's 1 based position in the set the client already holds. No day number, and no launch date constant is needed (none was ever built) |
| share button | share text | composed client side from the reveal already on screen; nothing fetched |
| vision call | image bytes | S3 GetObject on the row's `objectKey`, base64 encoded, sent with `GradePhoto.contentType` as the media type |
| vision call | model id | resolved per provider: a Bedrock model id when `AI_PROVIDER=bedrock`, the pinned first party id otherwise. Never the first party id under Bedrock |
| admin upload | objectKey | `photos/` plus 16 random hex characters plus the extension the resize pipeline produced. Deliberately NOT derived from the slug: a slug derived key means a duplicate slug upload overwrites a live photo's bytes before the insert fails, and the rollback then deletes the object a live row points at. A random key also keeps circuit colour words out of the presigned URL, which would otherwise leak a grade hint before the guess |
| admin list | thumbnail URL | presigned S3 GET URL, same mechanism as the game's imageUrl |
| client reveal | progress marker | localStorage, the set of public problem ids already revealed (AC-24). Was a streak computed from the last played date, which needed days |
| client reveal | cached reveal | localStorage, keyed by public id, written from the guess response the visitor already received (AC-26). Never fetched, because no route can serve it without breaking AC-2 |
| page load | which problem opens | the first problem in the served order that has no AC-24 marker, else the first in the set once every problem is read. Falls out of the marker rather than needing its own stored cursor |
| page | progress display | the count of AC-24 markers that are still in the served set, over the set size from `GET /grade/problems`. Intersected rather than counted raw, so a marker for a retired photo does not read as "9 of 8" |

**Key invariants** (swept 2026-08-22 for the cadence revision):
- One `GradeProblem` row per problem (PK is `photoId`); row creation uses an atomic insert (`ON CONFLICT DO NOTHING` semantics) and only the request that created the row (or finds analysis still null) runs the vision call, re checking after insert so concurrent first guesses cannot double call (AC-4).
- The true grade and model grade never appear in any response before a guess is submitted (AC-2).
- Histogram and plays only ever increment, by exactly 1 per guess request, whatever the vision call outcome (AC-6).
- No free text crosses the boundary on the public endpoints: the guess DTO is a single validated integer, so the visitor facing feature has no injection surface by construction. The admin endpoints accept text, but they sit behind better-auth and none of their text reaches a model.
- An upload writes the S3 object first, then the row, and deletes the object if the insert fails. A row therefore never names a missing object (AC-9).
- Photo rows are deactivated, never deleted, and the foreign key is `onDelete: Restrict`, so every `GradeProblem` keeps pointing at a real photo.
- The guess names its own problem by public id (AC-8, AC-23), so there is nothing to pin and nothing to recompute. The three invariants that used to live here (AC-19's date guard, AC-20's pinning, AC-21's pin on read) all existed to answer "which photo is today", and the fixed set never asks. They are struck through in Requirements rather than deleted, because the reasoning behind them is the clearest record of why the cadence cost what it did.
- A deactivated photo still resolves on the guess path; only `GET /grade/problems` filters on `active`. A visitor who loaded the set and guessed after a deactivation is answered rather than errored.
- Object keys are random and never reused, so a failed upload's rollback delete can only ever remove the object that upload just wrote.
- The bucket blocks all public access. Every read by a browser goes through a presigned URL the api mints (AC-13, AC-14).

**Security model**: the two game endpoints are fully public, no auth, `@AllowAnonymous()` like Beta's endpoints, both behind the existing `@nestjs/throttler` (limits revisited 2026-08-22: they were sized for one guess per visitor per day, and a visitor now works through five to ten problems in one sitting). The three `/internal/grade-photos` endpoints sit behind the existing better-auth admin guard, like the rest of `/internal`. No PII, no visitor content, no compliance scope.

Photo storage: the bucket blocks all public access, and the api's IAM policy grants GetObject, PutObject and DeleteObject on that bucket's objects and nothing else. Browsers never reach S3 directly; they follow a presigned URL with a one hour lifetime, which is short enough that a copied link stops working the same day and long enough that nobody playing normally sees a broken image.

Visitor privacy in the photos themselves: every upload is re encoded, which strips EXIF. This matters because the owner's own phone photos carry GPS coordinates, and a presigned URL hands the raw object to every visitor. After this revision the only location information that survives is what the owner deliberately types into `note` or `sourceNote`.

Pre guess leakage through the URL: the presigned URL contains the object key, so the key must not describe the photo. Gym circuit colours encode grade bands, and a key like `north-gym-blue-prow` would hand a climber a grade hint before they guess, which breaks AC-2 in spirit even though no grade field is present. Random object keys close this, and the AC-2 leak check test asserts on the URL string as well as the response body.

Copyright: the original claim that photos are owner shot is now enforced rather than assumed. Every row records a `source`, and a row marked `unlicensed_test` is excluded from the cycle whenever the game is enabled (AC-18), so images borrowed for testing cannot reach a released game by being forgotten.

**Configuration required** (revised 2026-08-21):
- `GRADE_PHOTO_BUCKET`: the S3 bucket holding photo objects. The only genuinely new variable.
- Reuses `ANTHROPIC_API_KEY`, `DATABASE_URL`, `GRADE_GAME_ENABLED`, and the AWS credentials plus `AWS_REGION` the api already uses for Bedrock.
- `CORS_ORIGIN` is no longer used for images at all. It keeps its original CORS job.
- One bucket, shared by local development and production, exactly as the database already is. A second bucket would drift from the shared database it must agree with. This inherits the same gotcha the api's AGENTS.md documents for the database: local runs touch production content.
- Local development now needs the AWS credentials and `AWS_REGION` that were previously optional when `AI_PROVIDER=anthropic`, because presigning and reading objects need them regardless of which model provider is in use. Add them to the api's documented local environment.
- Getting `GRADE_PHOTO_BUCKET` from the terraform output into Render's environment is a manual step, and belongs on the R1 checklist rather than being assumed.

**Interfaces and constants settled here** (so the build does not invent them):
- Seam shape: `imageUrl?: string` is replaced in `ForceToolCallParams` by `image?: { data: string; mediaType: string }`, where `data` is base64. Both providers map it to their SDK's `source: { type: 'base64', media_type, data }`. The field stays optional, so every existing caller is unaffected.
- Grader model: a pinned constant per provider in `grade.constants.ts`, resolved in `GradeAnalysisService` from `resolveConfiguredProvider().provider`, and recorded in `GradeProblem.model`. It must NOT fall back to `BEDROCK_MODEL_ID`, because that is the env driven downgrade the original pinning exists to prevent; the Bedrock side is its own pinned id for the same model family.
- Slug rules: `^[a-z0-9][a-z0-9-]{2,63}$`, validated in the upload DTO. the slug regex is kept for admin hygiene; AC-1's ordering argument for it died with the daily cycle.
- New dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, and `sharp`. AWS SDK v3 is already precedented in the repo (`@aws-sdk/client-sns`). `sharp` ships native binaries, so confirm Render's build installs it cleanly before relying on it in R3.

**Critical test scenarios**:
- Happy path: the first guess on a problem creates its row, runs one mocked vision call, returns truth, analysis, distances, histogram, verifies **AC-3**, **AC-4**.
- Concurrency: two simultaneous first guesses produce one vision call and two consistent responses, verifies **AC-4**.
- Failure case: vision call rejects; response still carries truth and histogram with model null; a subsequent guess triggers a successful retry and fills the row, verifies **AC-5**.
- Leak check: the `/grade/problems` response and its DTO contain no trueGrade, no model fields, and **no photo slug** anywhere, verifies **AC-2**, **AC-23**.
- Auth/permission: over limit requests receive 429 from the throttler; guess of 9 or "V5" receives 400, verifies **AC-8**.
- Write both or neither: an upload whose row insert fails leaves no object behind, verifies **AC-9**.
- Provider routing: with `AI_PROVIDER=bedrock` the vision call sends base64 bytes and a Bedrock model id, and no code path can pass a URL or a first party model id to Bedrock, verifies **AC-15**, **AC-16**.
- Presigned URL: every entry in the `/grade/problems` response carries a URL that expires in one hour and still carries no grade of any kind, verifies **AC-14**, **AC-2**.
- Admin auth: an unauthenticated request to any `/internal/grade-photos` endpoint receives 401, verifies **AC-17**.
- Upload validation, two separate limits: a file over 10 MB is rejected with 413, while a file within the cap whose long edge exceeds 1568 pixels is accepted and resized, verifies **AC-17**.
- Upload hygiene: an image carrying EXIF GPS is re encoded so the stored object has none, and a file whose declared content type disagrees with its bytes is stored under the type the pipeline actually produced, verifies **AC-17**.
- Rollback safety: an upload whose insert fails deletes only its own object, and an upload using an already taken slug returns 409 without touching the existing photo's bytes, verifies **AC-9**.
- ~~Day rollover~~ and ~~Mid day pool change~~: both removed 2026-08-22 with AC-19 and AC-20.
- Fixed set: `GET /grade/problems` returns every eligible problem once, in a stable order, and creates no rows, verifies **AC-22**.
- Opaque identity: no response on any public route contains a photo's `id` slug, and a guess addressed by public id resolves to the right photo, verifies **AC-23**.
- Deactivation mid session: a problem deactivated after the set was served is absent from a fresh `/grade/problems` but a guess against it still returns its truth and analysis.
- Licence gate: with the game enabled, a photo whose source is `unlicensed_test` never appears in the served set, and the exclusion is logged once per process rather than at startup (a boot time count goes stale the moment a photo is toggled), verifies **AC-18**.

## Build plan

Tracer Bullet (the project's assumed default, per specs 0002 and 0004): a thin end to end thread first, then thicken.

1. Migration for `GradeDay` plus the `photos.json` manifest with 2 seed photos and the AC-9 repo check, satisfies **AC-9**.
2. Thin thread: `grade` api module (`GET /grade/today` with deterministic cycle; `POST /grade/guess` returning truth, distances, histogram, model null path only) with DTO validation and throttling, fully mocked tests, satisfies **AC-1**, **AC-2**, **AC-3** (partial), **AC-6**, **AC-8**.
3. Minimal `/grade` page: photo, grade buttons, reveal against truth and histogram, localStorage streak, satisfies **AC-7**, **AC-10** (partial); the game is now playable end to end without the model.
4. The vision call: `grader.md` skill file, forced tool call schema, lazy fill with the atomic single caller guard, failure degradation and retry, tokens logged per the api's structured line convention, satisfies **AC-3** (full), **AC-4**, **AC-5**.
5. Reveal polish: model observations and reasoning presentation (typewriter), "Claude is studying the problem" first guess state, the share button with its spoiler safe clipboard summary, metadata and OG image, mobile pass, satisfies **AC-10**, **AC-11**.
6. Discovery: the home page teaser line linking to the game, satisfies **AC-12**.
7. Content and gate: grow the pool to 10 or more photos, run `/predeploy-audit` before the shipping push.

**Revised plan from 2026-08-21.** Steps 1 to 4 are built and merged behind `GRADE_GAME_ENABLED=false`. Since then the seed images have been deleted and `photos.json` emptied to `[]`, though the file, its loader and its validator are all still live in the tree (R2 removes them). Step 4's vision call has still never run against a real API, because the URL source it was built on cannot work under Bedrock. The remaining work is reordered so storage lands before the vision call: nothing built gets thrown away, and test images are uploaded rather than committed. The Tracer Bullet instinct still applies within each step, but the thin end to end thread already exists, so these thicken it rather than re establish it.

R1. Terraform: the private photo bucket with all public access blocked, plus the api's IAM policy for GetObject, PutObject and DeleteObject scoped to that bucket's objects only, satisfies **AC-13**.
R2. Migration for `GradePhoto` and the `GradeDay.photoId` foreign key (`onDelete: Restrict`). Delete `photos.json`, its loader and its validator, point the daily cycle at active rows, and change `submitGuess` to read the day's photo from `row.photoId` instead of recomputing the cycle per request, satisfies **AC-9**, **AC-1**, **AC-18**, **AC-20**.
R3. Upload endpoint and admin page in their own always registered module: cap at 10 MB, run every file through decode, resize if larger, re encode, then write object under a random key and insert the row, deleting the object if the insert fails. Plus the list view and the active toggle, satisfies **AC-9**, **AC-17**.
R4. Presigned URLs: `GET /grade/today` mints a one hour URL from the day's row (the controller becomes async). Add the guess date check while here. AC-2 is re verified, since the response shape changed and the URL is now part of the pre guess surface, satisfies **AC-14**, **AC-2**, **AC-19**.
R5. Provider seam: replace `imageUrl` with the `image` object above in `ForceToolCallParams`, implement it in both providers, and resolve the grader model id from the pinned per provider constants so neither a first party id nor an env driven downgrade can reach Bedrock. Beta's screener and drafter are the other `forceToolCall` callers, so their tests are the regression guard for this step, satisfies **AC-15**, **AC-16**.
R6. Point the vision call at S3 bytes, and run it against the real API for the first time, satisfies **AC-3** (full), **AC-4**, **AC-5**.
~~R7. The original steps 5 and 6, unchanged: reveal polish, the share button, metadata, and the home page teaser, satisfies **AC-10**, **AC-11**, **AC-12**.~~ **Rewritten below by the 2026-08-22 cadence revision.**

~~**Added 2026-08-22, after the pre deploy gate.** R6a is sequenced before R7 because it is small, it closes a visitor facing correctness gap, and the game is still dark so it can land without a release.~~

~~R6a. Pin the day on read.~~ **Never built. Cancelled 2026-08-22, hours after it was written**, by the cadence revision below: AC-20 and AC-21 are gone, so there is nothing to pin. Left visible because the sequence is the lesson. Three gate rounds found and fixed a real bug inside the daily model while nobody asked whether the daily model should exist. The bug was real, the fix was correct, and the round was still wasted.

**Revised plan from 2026-08-22, the cadence revision.** R1 to R6 stand. The daily mechanics are removed and R7 and R8 are rewritten; the build approach stays Tracer Bullet, and R6b is a thin end to end thread through the new shape before R7 thickens the UI.

R6b. Drop the cadence, api side. Rename `GradeDay` to `GradeProblem` and move the primary key from `date` to `photoId`, dropping the `date` column (a clean rename and rekey: production holds zero `GradeDay` rows and the game has never been enabled, and no column is added to the non empty `GradePhoto`). Replace `GET /grade/today` with `GET /grade/problems` plus the per problem image route. Change the guess DTO from `date` to the public id, derived from `objectKey`, no new column (AC-23). Rekey `GradeAnalysisService`: its in flight map, its `persist` where clause and its structured log field are all keyed on `date` today, and the log line must not gain the slug. Replace `lastExclusionLogDate` with a once per process flag, since AC-18's line was throttled per UTC date and there are none. Delete the daily cycle (`photoForDate`, `daysSinceEpoch`, `utcDateKey`), the rollover guard, the pinning logic, and the tests covering them, satisfies **AC-22**, **AC-23**, **AC-25**, and re verifies **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-8**, **AC-18**.

R7. Reveal polish and the page, on the new shape: one problem at a time with a next control, model observations and reasoning presentation (typewriter), the "Claude is studying the problem" first guess state, the per problem share button, the localStorage progress marker and reveal cache, metadata and OG image, mobile pass, and the home page teaser. **AC-12 was folded back in here on 2026-08-22**: the 2026-08-22 rewrite dropped it from R7 without giving it to R8, so no step satisfied it. It is a line of copy and a link, it is UI work in the area R7 already touches, and its copy has to stop saying "today's problem" anyway, which is this revision's whole point. Satisfies **AC-10**, **AC-11**, **AC-12**, **AC-24**, **AC-26**.

R8. Content and gate: photograph and upload five to ten problems with each source recorded, **each framed so one line is unambiguous (AC-27)**, confirm no `unlicensed_test` row is active, then run `/predeploy-audit` before the shipping push. **This is now a finite task rather than a standing commitment**, which is the entire point of the revision. The framing rule lands here rather than in code because this is the step where the pool is actually created, and it is the cheapest place to get it right.
~~R8. Content and gate: upload a real pool of 10 or more photos with each source recorded, confirm no `unlicensed_test` row is active, then run `/predeploy-audit` before the shipping push.~~ **Rewritten above by the 2026-08-22 cadence revision: five to ten problems, and finite.**

## Consequences

**Positive**:
- A return hook and shareable moment the portfolio currently lacks, at a fixed ~$0.02 per day ceiling with no cap machinery.
- Demonstrates vision reasoning with a visible explanation, a stronger interview artifact than object detection.
- The share summary is the distribution engine if the game is ever put in front of climbers; it costs one button and stores nothing.
- Zero injection surface and zero visitor content by construction, the cleanest data boundary story on the site.
- Adding a photo stops being a code change. The pool can grow from a phone, which is the difference between a pool that grows and one that stays at two placeholders.
- The photo exposure closed on 2026-08-21 cannot recur: with the bucket private and no game images under the web app's public directory, there is no path by which turning the flag off leaves images served.
- A revealed problem survives a refresh, so the model's analysis is re-readable rather than lost to a reload, and reloading can no longer inflate the histogram from a single browser (AC-26).
- The vision call becomes testable locally for the first time, because bytes do not require a publicly reachable origin.
- Copyright provenance becomes data rather than memory, which matters most months from now when nobody remembers where an image came from.

**Negative / tradeoffs**:
- The owner must produce and grade the photo pool; the game repeats photos every poolSize days until it grows.
- The first guesser each day waits several seconds for the reveal.
- Grade ground truth is one gym's opinion; the model (and visitors) may reasonably disagree, which the reveal copy should embrace rather than hide.
- A photo based OG image cannot include the day's answer flavor without spoiling; the OG stays static.
- The revision is far more work than the bug that prompted it: a bucket, IAM, terraform, a migration, an upload endpoint and an admin page, against an afternoon's work to read bytes off the repo checkout. The game stays unreleased and the vision call stays unproven for longer as a result.
- The game's content now lives behind AWS credentials rather than in the repo, so the pool is no longer readable, reviewable or restorable from a git clone alone.
- A presigned URL expires. A page left open overnight shows a broken image until it is refreshed.
- ~~`GET /grade/today` writes (AC-21)~~ and ~~once a day is pinned by a view, an upload cannot take effect until the next UTC day~~ and ~~`plays: 0` rows become normal~~. **All three removed 2026-08-22**: they were consequences of pin on read, which the cadence revision deleted. `GET /grade/problems` is a pure read.
- **The game loses its reason to be revisited.** A fixed set is read once and finished. Whatever return traffic a daily puzzle would have produced does not exist, and the share summary now spreads a one time curiosity rather than a recurring ritual. This is the real price of the 2026-08-22 revision and it is paid deliberately: retention was never what this artifact was for.
- **Three rounds of pre deploy gate work went into a model that was then deleted.** AC-21 was specced, built into R6a, and cancelled within hours. The bug it fixed was real and the fix was correct; the waste came from polishing a level below a constraint (where photos come from) that nobody had examined. Worth remembering the next time a gate keeps finding small correct things.
- Image handling brings an image library into the api for resizing, on a free Render instance where memory is genuinely scarce, which is why the upload size cap is load bearing rather than decorative.

**Neutral**:
- New Prisma migration on the shared dev/prod database (the repo's known gotcha: dev runs consume nothing here since there are no caps, but the migration itself deploys with the api).
- The histogram double count via incognito replay is accepted and documented.
- The api gains its first S3 dependency. Its AWS credentials already exist for Bedrock, so this widens an existing trust boundary rather than opening a new one.
- `photos.json`, its loader and its repo check are deleted. The AC-9 guarantee moves from a scan to an invariant, which is stronger but only as good as the rollback path's test.
- The provider seam changes shape for every caller, not just this one, since `imageUrl` leaves `ForceToolCallParams`. Grade Guesser is the only caller that passes an image today.

## Migration plan

**Strategy**: feature flagged, and the flag is already off. `GRADE_GAME_ENABLED=false` means the api module is not registered and the web route 404s, so every phase below ships to production without a visitor ever reaching it. There is no live data to transform: the pool is empty, `photos.json` is an empty array (the file and its loader are removed in phase 2, not before), and `GradeDay` is empty, verified on 2026-08-21 by counting rows in the shared database rather than assuming it. The module was registered unconditionally when it was first merged, but that merge and the feature flag reached origin in the same push, so no deployed build ever served the route.

**Phases**:
1. Terraform apply: the bucket and the IAM policy. Nothing in the running api reads them yet, so this is inert on its own (R1).
2. Migration plus code: `GradePhoto`, the `GradeDay` foreign key, and the cycle reading active rows. The `GradeDay` foreign key is safe to add as a constraint precisely because the table is empty; on a table with rows this would need the add nullable, backfill, then constrain sequence (R2).
3. Upload, admin page and presigned URLs. The pool can now be filled, still with the game hidden (R3, R4).
4. Provider seam and the vision call against S3 bytes, exercised for the first time with real images in the bucket (R5, R6).
5. **Added 2026-08-22:** drop the cadence api side, which is one more migration (rename `GradeDay` to `GradeProblem`, move the PK to `photoId`, drop `date`). Safe to do as a plain rename and rekey rather than the usual add nullable, backfill, constrain dance, because production holds zero `GradeDay` rows and the game has never been enabled (R6b). An earlier version of this line also said "add `GradePhoto.publicId`"; AC-23 reversed that and R6b shipped with no new column, because deriving the id from `objectKey` needs neither a backfill nor a collision policy on a table that already holds rows.
6. Polish, teaser, real pool, audit, then flip the flag (R7, R8).

**Rollback**: phases 1 and 3 to 5 revert by reverting their commits, since nothing outside the feature reads them. Phase 2 is the only one that is not a plain revert: it drops `photos.json` and adds a table. Reverting after phase 2 means a down migration, and the safe order is to revert the code first and the schema second. Phase 4 touches `ForceToolCallParams`, so its revert is the one that can affect a live surface. Corrected 2026-08-21 after a cross check: that surface is BETA, not the interview simulator. The conversation path only calls `streamMessage` and is untouched by this change; the other `forceToolCall` callers are Beta's screener and drafter. Beta's tests are the guard, and Beta's are the tests to run before merging R5.

**Risks**:
- The `ForceToolCallParams` change is the only edit in this plan that touches a shipping feature. A mistake there breaks BETA, which is live, rather than the game, which is hidden. (An earlier draft of this spec named the interview simulator here, which was simply wrong: it uses `streamMessage` only.)
- Resizing on a free Render instance is a memory risk if the upload size cap is set too generously or enforced too late.
- A terraform apply that grants the api broader S3 access than intended is the kind of mistake nothing here would catch, since no test asserts the shape of an IAM policy.
- The vision call has never run. Phase 4 is where a problem that has been latent since the feature was built will finally surface, and the plan should expect that rather than treat it as a formality.

## Follow-up

- [ ] **Where the pool comes from is the binding constraint, and it is a bigger problem than the build.** Everything R1 to R6 built is infrastructure for getting legally usable photos of real routes with a trustworthy grade attached. R8 asks the owner to shoot ten and then keep going forever, which is a content treadmill, not a build task. Researched 2026-08-22, three findings, none of them comfortable:

  1. **AI generated route images cannot work, and the reason is not image quality.** Nothing about generated pixels constrains the grade label, so `trueGrade` becomes an assertion rather than a fact and any climber who disputes it is automatically right. Visual realism and grade validity are independent properties, and only the second one matters here, so no model improvement fixes this. Do not revisit on the grounds that the images got better.
  2. **Standardized boards are the version of that idea that does have ground truth, and they are legally closed right now.** MoonBoard is a fixed 18x11 grid of about 142 fixed holds where a problem is a subset lit up and the grade is crowdsourced over many ascents, which is arguably MORE defensible than one setter's opinion. But MoonBoard's terms grant only limited, non transferable, internal, unmodified use; Kilter and Tension have no official public API and community access is reverse engineered; and on 2026-03-19 Kilter sent Aurora a cease and desist over trademark and copyright covering board layout imagery, which is exactly what would have to be rendered. Rendering is trivial once licensed. Ask for a licence before building anything, and treat a no as final.
  3. **Prior art died of exactly this.** Crimpdle, a daily guess the grade climbing game, reportedly went dormant because content sourcing could not be automated. Its players averaged within about one grade, and the main community objection was grading variance between gyms, that is the ground truth itself rather than the imagery. Academic MoonBoard grade prediction reaches about 0.87 MAE, roughly one grade, so "Claude was within a grade" is a defensible framing rather than a weak one.

  Correcting an earlier version of this note: the recommended path, a gym partnership with the setter's grade and a short setter note in the reveal, needs NO schema change and NO new spec. It is the `permission_given` source `GradePhotoSource` already carries. The open question is not the schema, it is whether the daily cadence survives at all given that the owner cannot currently secure a partnership. See the sibling follow up below.
- [x] **Does "daily" survive?** Decided 2026-08-22: no. See the revision in Options considered and the rewritten R6b, R7 and R8.
- [ ] **Crowd consensus beside the owner's grade (Option C, deferred not rejected).** Show the aggregate of player guesses next to `trueGrade` on the reveal, so the game claims only as much authority as one gym's grade deserves. This is the direct answer to the objection that sank the prior art, it needs no third party, and the histogram is already stored and already returned. Deferred because it reads as empty until there are players. Revisit once the set has real traffic.
- [ ] **The set has no ordering control.** R6b orders by `createdAt` ascending, which makes additions append rather than reshuffle, but gives the owner no way to open with an easy problem or to sequence difficulty deliberately. A `sortOrder` column is the obvious fix. **Unblocked 2026-08-22:** this was waiting on whether the page shows a list or one problem at a time, and AC-25 settled that as one at a time, which makes ordering matter MORE rather than less, because the order is now the order a visitor actually walks. Still deliberately not built: with five to ten photos the owner can control order by upload order, and a column is worth adding only when that stops being true.
- [ ] **The route note escape hatch (AC-27's trigger).** AC-27 holds the "one unambiguous line" rule by the owner's care rather than by the schema. Reopen it and add an optional owner written route note (a column, an admin form field, and a pre guess line on the page) the first time either happens: a photo in the real pool cannot be framed unambiguously, or a visitor reports grading the wrong line. The note must describe the line by position ("the line up the left arête"), never by circuit colour, which would hand over the grade band and break AC-2. Deliberately deferred rather than rejected: it is a migration for a problem a curated pool may never have.
- [ ] Owner: shoot and grade the set (five to ten photos spanning a range of grades) and upload it through the admin page, recording each photo's source. Images borrowed for testing are marked `unlicensed_test`, which keeps them out of the served set once the game is enabled. Revised 2026-08-21: photos are no longer committed to the repo, and the pool is currently empty.
- [ ] Resolved 2026-08-21, recorded so it is not reopened without reason: `ForceToolCallParams` carries the image for every provider rather than the grade module owning a narrower vision specific seam. A narrower seam would need its own provider dispatch, its own error classification and its own DI token, all for exactly one caller, and the field is optional so every existing caller is unaffected. Revisit only if a second image caller appears with genuinely different needs.
- [ ] Orphan objects (an object with no row, from a crash between the two writes) are accepted by AC-9 and are harmless with random keys. If the pool ever grows enough that wasted storage matters, the admin list is the natural place to surface them.
- [ ] **Climbing hub repositioning is its own decision**: whether a climbing branded surface (separate domain or subdomain) should house this game, Beta, and future climbing features, and when Beta joins it (its advertising prerequisites: monitoring, Bedrock Guardrails, budget raise). The game can lead that brand because it has none of Beta's launch blockers; run `/architect` on it when ready. This spec deliberately decides only the portfolio hosted version.
- [ ] After launch, consider a "how everyone guessed vs Claude over time" stats page from the accumulated `GradeDay` rows (anonymous by construction).
