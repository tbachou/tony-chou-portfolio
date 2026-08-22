# 0006. Grade Guesser, a daily climbing grade game

**Date**: 2026-08-20
**Revised**: 2026-08-21 (how the api gets the image, and where photos live)
**Status**: In Progress

## Summary

A daily game on the portfolio site: one photo of a boulder problem per day, the visitor guesses its V grade (the bouldering difficulty scale), then Claude's vision analysis of the same photo is revealed next to the true grade. The fun is comparing your read of the wall against the model's, and against everyone else's guesses. It runs on one model call per day, stores no visitor content, and reuses the site's existing web plus api shape. Photos live in a private S3 bucket and are added by uploading them through an internal admin page, not by committing files and deploying.

## Context

> Premise note (2026-08-21 revision): the change that triggered this revision is small, and the change being made is not. The vision call is broken because Bedrock will not take a URL image, and that alone is fixable in an afternoon by reading bytes off the repo checkout. Moving photos to S3, adding a table, and building an upload page is a much larger piece of work, chosen deliberately for a reason the bug did not raise: adding a photo should not require a commit and a deploy. That is a legitimate reason, and the cost is that the game stays unreleased longer, and the vision call (which has never once run against a real API) stays unproven longer. The build order below puts storage first at the engineer's direction, so the risk is accepted knowingly rather than discovered later.

The portfolio's climbing surfaces (Beta, the rehab planner) are serious by design. Research into the climbing app space (2026-08-20, recorded in the AWS GenAI track memory) found a proven but vacant niche: Crimpdle, a Wordle style daily grade guessing game, engaged climbers but shut down because curating videos by hand did not scale. Vision models remove that burden. A small daily game gives the site a return hook, a shareable moment, and a credible demonstration of vision reasoning (the model explains what it sees, not just a label), at portfolio demo cost.

Forces: the site's hard data boundary (no visitor typed content ever comes to rest, spec 0004 AC-6); demo economics (Beta style caps exist because a portfolio must not run away with an AI bill); two separate deploys (web on Vercel, api on Render) that share a repo but not a filesystem at runtime; and the owner supplies the photo pool, so content volume is small and curated.

Three forces surfaced on 2026-08-21 that the original decision did not account for. This game's grader is one of the surfaces that runs on Amazon Bedrock: `AI_PROVIDER=bedrock` governs every consumer of the `AI_PROVIDER` token, which is the interview simulator and this grader, but NOT Beta, which stays on the direct Anthropic API by construction (see `apps/api/AGENTS.md`). Bedrock's Anthropic surface rejects URL source images outright, so the vision call as specced could never have worked in production; it would have failed silently on every attempt, degrading through AC-5 into a reveal with the model fields empty. The feature flag gates the route and the api module but does not gate static assets, so the seed photos under the web app's public directory were served to the open internet the entire time the game was supposedly hidden. And the grader's model id is pinned to a first party name that Bedrock does not recognise, which is a second, independent failure on the same path.

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
- **AC-9** (rewritten 2026-08-21): a photo row can never name an object that does not exist. The upload writes the S3 object first, then the row, and deletes the object if the insert fails. The guarantee is structural rather than a repo scan, because the manifest that scan read is removed in R2. The reverse is deliberately NOT guaranteed: a crash between the two writes, or a failed rollback delete, can leave an object with no row pointing at it. That is accepted, and it is harmless because object keys are random and never reused.
- **AC-10**: the page is a terminal themed route on the portfolio site with the repo's standard per page metadata and OG image conventions, playable on mobile widths. The game UI is a self contained component tree with no structural dependence on the terminal shell, so a later climbing branded host can re skin and re mount it without a rebuild.
- **AC-11**: after the reveal, a share button copies a spoiler safe emoji summary to the clipboard (day number, your grade, the model's grade, hit or miss marker, site link). Clipboard only: no share tracking, no visitor identifier, nothing sent to the server.
- **AC-12**: the portfolio home page carries a one line teaser for today's game (for example "Today's problem: can you out grade Claude?") linking to the page, so the game is discoverable in one click from the front door.
- **AC-13** (added 2026-08-21): photos are stored in a private S3 bucket with all public access blocked. No game image is served from the web app's public directory, so turning the feature flag off actually hides the images too.
- **AC-14** (added 2026-08-21): `GET /grade/today` returns a presigned URL valid for one hour. AC-2 is unchanged: the response still carries no grade of any kind.
- **AC-15** (added 2026-08-21): the vision call sends image bytes read from S3, base64 encoded, tagged with the stored content type. It never sends a URL, so it works under either provider.
- **AC-16** (added 2026-08-21): the grader model id is resolved per provider. Under Bedrock a valid Bedrock model id is used; a first party model id is never passed to Bedrock.
- **AC-17** (added 2026-08-21): an internal admin page behind the existing better-auth guard uploads a photo (file, slug, true grade, source, optional note), lists the pool, and toggles a photo active or inactive. Uploads are capped at 10 MB, and every upload is decoded, resized so its long edge is at most 1568 pixels, and re encoded. Re encoding is not just for size: it strips EXIF metadata (a phone photo carries GPS coordinates, which a presigned URL would hand to every visitor) and it makes the stored content type the pipeline's own output rather than a client supplied claim that could be a lie. The admin endpoints live in a module that is always registered, so the pool can be filled while the game is still hidden.
- **AC-18** (added 2026-08-21): every photo records where it came from. When `GRADE_GAME_ENABLED` is true, a photo whose source is `unlicensed_test` is excluded from the daily cycle, and the api logs one line naming how many were excluded. The line is written when the daily cycle resolves the day's photo, not at startup: a boot time count goes stale the moment a photo is toggled without a redeploy.
- **AC-19** (added 2026-08-21): a guess carries the UTC date the visitor was shown. If that date is not the server's current UTC date, the guess is rejected with 409 and the client reloads the day. Without this, a visitor who opens the page at 23:55 and guesses at 00:02 is graded against tomorrow's photo, which they never saw.
- **AC-20** (added 2026-08-21): once a `GradeDay` row exists, the image, the true grade and the analysis for that date all come from the photo the row pinned, even if that photo is later deactivated. The daily cycle decides only which photo a date gets when no row exists yet, so uploading or retiring a photo mid day cannot change the answer under visitors already playing.

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

## Decision

**Chosen option**: Option 1: live analysis once per day, cached.

One vision call per UTC day, triggered lazily by the first guess, stored on the `GradeDay` row, served from cache to every later guess.

**Implementation skills** (revised 2026-08-21): `aws-iam` (`.claude/skills/aws-iam/`, the bucket policy and the api's read and write policy) · `terraform-style-guide` (`.claude/skills/terraform-style-guide/`, the bucket and IAM in `infra/`) · `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`, the admin page guard) · `prisma-postgres` (`prisma/skills`, `.claude/skills/prisma-postgres/`) · `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `claude-api` (Anthropic vision API usage, `.claude/skills/claude-api/`)

## Rationale

The demo value of this feature is a live model doing visible reasoning, which rules out Option 3, and the daily game shape wants one shared Claude verdict per day, which rules out Option 2. Option 1 is also the cost shape the site already believes in: a fixed, tiny daily ceiling instead of per visitor spend, without needing Beta's cap machinery at all. The lazy fill (first guess pays ~10 seconds) is acceptable because it happens once per day and is presentable as a feature ("Claude is studying the problem"), and Render's free tier makes a midnight scheduler both unreliable (the dyno sleeps) and unnecessary.

Decisions settled here rather than asked, with the runner up noted: the vision model is `claude-sonnet-5` (one call per day makes quality the only axis; runner up Haiku 4.5 saves pennies that do not matter at this volume). The reveal returns plain JSON with a client side typewriter effect (runner up SSE re chunking; streaming a cached string is theater and adds an SSE surface for no visitor visible gain). The grading prompt lives as a skill file `apps/api/src/modules/grade/skills/grader.md` per the repo rule, and the model receives only the photo, never the manifest note or pool metadata, so its guess is honestly blind. The api sends the day's photo to the model as base64 encoded bytes read from S3, and the browser loads the same photo through a presigned URL, so `CORS_ORIGIN` is no longer involved in images at all (revised 2026-08-21; see the revision rationale below). Replay abuse (a visitor re guessing via incognito inflates the histogram) is accepted: the data is anonymous fun, not a leaderboard, and defending it would cost identity tracking the data boundary forbids.

**Revision rationale (2026-08-21).** Option A is the cheapest fix and would have been the right call if the only goal were an unbroken vision call. It was rejected because it leaves both of the real problems standing: adding a photo would still be a code change, and the photos would still be public files served whether the game is on or off. Option B keeps a network hop on the one call this feature makes per day, adding a failure mode to the exact path that has never successfully run. Option C costs the most and is worth it here for a specific reason: the pool is the thing this game is actually waiting on, and a pool that needs a deploy per photo is a pool that stays at two placeholders. Making the bucket private and handing the browser a presigned URL is what turns the earlier exposure from a mistake that was fixed into one that cannot recur. The required `source` field is the same instinct applied to copyright: the original spec claimed no copyright exposure because the photos would be owner shot, which was an assumption held only in memory. Now it is a column, and an unlicensed test image cannot reach a released game by being forgotten.

## Feature design

**Data model sketch**:

`GradePhoto` (Prisma, added by the 2026-08-21 revision; replaces `photos.json`, which is deleted). Api side so grades never reach the client bundle, exactly as the repo file was:
| field | type | notes |
|---|---|---|
| id | string, PK | owner set slug, for example `north-gym-blue-prow`; the daily cycle sorts on it |
| objectKey | string, required, unique | the S3 key holding the bytes |
| contentType | string, required | `image/png`, `image/jpeg` or `image/webp`; the media type the vision call sends |
| trueGrade | int 0 to 8, required | the owner's gym grade |
| source | enum, required | `own_photo`, `permission_given`, `licensed`, `unlicensed_test` |
| sourceNote | string, optional | where it came from: a URL, a photographer, a permission reference |
| note | string, optional | location or credit line, shown after reveal |
| active | boolean, default true | the daily cycle filters on this; rows are never deleted |
| createdAt | datetime, default now | |

`GradeDay` (Prisma, one migration; one row per UTC day):
| field | type | notes |
|---|---|---|
| date | string, PK | UTC date `YYYY-MM-DD` |
| photoId | string, required, FK to `GradePhoto.id`, `onDelete: Restrict` | the day's photo (a real foreign key since the 2026-08-21 revision). `Restrict` makes "rows are never deleted" structural rather than a habit |
| modelGrade | int, nullable | null until the day's vision call lands |
| modelConfidence | string, nullable | low, medium, high |
| observations | string[], default [] | what the model saw |
| reasoning | string, nullable | the model's conclusion summary |
| model | string, nullable | model id used |
| inputTokens / outputTokens | int, default 0 | per call telemetry |
| guessCounts | int[], default 9 zeros | anonymous histogram, index = grade |
| plays | int, default 0 | atomic increment |

Browser localStorage (client only, never sent): streak count, last played UTC date, win/loss record.

Cross source link: `GradeDay.photoId` is a foreign key to `GradePhoto.id`. Object and row are kept consistent by the upload writing both or neither (AC-9), not by a repo check.

**State transitions** (the `GradeDay` row): absent → created with guessCounts only (vision pending) → analysis filled. Both transitions happen inside the guess request; a row never goes back to pending.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /grade/today | GET | none | date, imageUrl, note?, poolSize | public, throttled | 503 no active photo available for today |
| /grade/guess | POST | guess:int 0 to 8 (req), date:`YYYY-MM-DD` (req) | trueGrade, model {grade, confidence, observations, reasoning} or null, guessCounts, plays, yourDistance, modelDistance | public, throttled | 400 invalid guess or date, 409 date is not today (client reloads), 429 throttled |
| /internal/grade-photos | GET | none | list: id, trueGrade, source, active, note, presigned image URL, ordered `createdAt` descending | better-auth admin | 401 |
| /internal/grade-photos | POST | file (req), id slug (req), trueGrade:int 0 to 8 (req), source enum (req), sourceNote?, note? | the created row | better-auth admin | 400 slug, grade or schema invalid, 409 slug taken, 413 over 10 MB, 415 unsupported media type |
| /internal/grade-photos/:id/active | PATCH | active:boolean (req) | the updated row | better-auth admin | 401, 404 |

The three `/internal/grade-photos` endpoints live in their own module, registered unconditionally. Only the public `GradeController` and the web `/grade` route stay behind `GRADE_GAME_ENABLED`. Without this the pool could not be filled until the game was already live, which is the opposite of the build order below. The admin list presigns the full size object rather than a real thumbnail; at ten photos that is fine, and it is called out so nobody later mistakes it for one. Error bodies are Nest's default `HttpException` shape, as everywhere else in the api.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| GET /grade/today | date | server clock, UTC, `YYYY-MM-DD` |
| GET /grade/today | imageUrl | presigned S3 GET URL for the row's `objectKey`, one hour lifetime |
| GET /grade/today | photo choice | if a `GradeDay` row exists for the date, its `photoId`, always (AC-20). Otherwise days since epoch modulo pool size, over ACTIVE photo ids sorted lexically, with `unlicensed_test` rows excluded whenever the game is enabled. Note the sort gives determinism ACROSS INSTANCES, not stability across uploads: changing the pool size reshuffles which photo every FUTURE date lands on, which is harmless because nobody sees the schedule, and AC-20 is what protects the current day |
| POST /grade/guess | trueGrade | `GradePhoto.trueGrade` for the row's pinned `photoId`, never a freshly recomputed cycle result (AC-20) |
| POST /grade/guess | date validity | compared against the server's current UTC date; a mismatch is a 409, not a silent regrade (AC-19) |
| POST /grade/guess | model analysis fields | `GradeDay` row, filled by the day's one vision call (forced tool call schema) |
| POST /grade/guess | yourDistance / modelDistance | derived: absolute difference from trueGrade |
| POST /grade/guess | guessCounts, plays | `GradeDay` columns, atomic increments |
| share button | day number | derived: days since `GRADE_LAUNCH_DATE`, a web app constant set to the date the flag is flipped, so day 1 is launch day (set as an R8 checklist item) |
| share button | share text | composed client side from the reveal already on screen; nothing fetched |
| vision call | image bytes | S3 GetObject on the row's `objectKey`, base64 encoded, sent with `GradePhoto.contentType` as the media type |
| vision call | model id | resolved per provider: a Bedrock model id when `AI_PROVIDER=bedrock`, the pinned first party id otherwise. Never the first party id under Bedrock |
| admin upload | objectKey | `photos/` plus 16 random hex characters plus the extension the resize pipeline produced. Deliberately NOT derived from the slug: a slug derived key means a duplicate slug upload overwrites a live photo's bytes before the insert fails, and the rollback then deletes the object a live row points at. A random key also keeps circuit colour words out of the presigned URL, which would otherwise leak a grade hint before the guess |
| admin list | thumbnail URL | presigned S3 GET URL, same mechanism as the game's imageUrl |
| client reveal | streak | localStorage, computed client side from last played date |

**Key invariants**:
- One `GradeDay` row per date (PK); row creation uses an atomic insert (`ON CONFLICT DO NOTHING` semantics) and only the request that created the row (or finds analysis still null) runs the vision call, re checking after insert so concurrent first guesses cannot double call (AC-4).
- The true grade and model grade never appear in any response before a guess is submitted (AC-2).
- Histogram and plays only ever increment, by exactly 1 per guess request, whatever the vision call outcome (AC-6).
- No free text crosses the boundary on the public endpoints: the guess DTO is a single validated integer, so the visitor facing feature has no injection surface by construction. The admin endpoints accept text, but they sit behind better-auth and none of their text reaches a model.
- An upload writes the S3 object first, then the row, and deletes the object if the insert fails. A row therefore never names a missing object (AC-9).
- Photo rows are deactivated, never deleted, and the foreign key is `onDelete: Restrict`, so every historical `GradeDay` keeps pointing at a real photo.
- Once a `GradeDay` row exists, the image, the true grade and the analysis all come from `row.photoId` (AC-20). The daily cycle is consulted only to create the row. Without this rule, uploading or retiring a photo mid day changes the pool size, later guessers are graded against a different photo than earlier ones, and one histogram silently mixes two problems. The built code currently recomputes the cycle on every guess, which R2 must change.
- A guess is only accepted for the current UTC date (AC-19).
- Object keys are random and never reused, so a failed upload's rollback delete can only ever remove the object that upload just wrote.
- The bucket blocks all public access. Every read by a browser goes through a presigned URL the api mints (AC-13, AC-14).

**Security model**: the two game endpoints are fully public, no auth, `@AllowAnonymous()` like Beta's endpoints, both behind the existing `@nestjs/throttler` (guess tighter than today). The three `/internal/grade-photos` endpoints sit behind the existing better-auth admin guard, like the rest of `/internal`. No PII, no visitor content, no compliance scope.

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
- Grader model: a pinned constant per provider in `grade.constants.ts`, resolved in `GradeAnalysisService` from `resolveConfiguredProvider().provider`, and recorded in `GradeDay.model`. It must NOT fall back to `BEDROCK_MODEL_ID`, because that is the env driven downgrade the original pinning exists to prevent; the Bedrock side is its own pinned id for the same model family.
- Slug rules: `^[a-z0-9][a-z0-9-]{2,63}$`, validated in the upload DTO. AC-1's deterministic ordering depends on slugs being lexically comparable.
- New dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, and `sharp`. AWS SDK v3 is already precedented in the repo (`@aws-sdk/client-sns`). `sharp` ships native binaries, so confirm Render's build installs it cleanly before relying on it in R3.

**Critical test scenarios**:
- Happy path: guess on a fresh day creates the row, runs one mocked vision call, returns truth, analysis, distances, histogram, verifies **AC-3**, **AC-4**.
- Concurrency: two simultaneous first guesses produce one vision call and two consistent responses, verifies **AC-4**.
- Failure case: vision call rejects; response still carries truth and histogram with model null; a subsequent guess triggers a successful retry and fills the row, verifies **AC-5**.
- Leak check: the today response and its DTO contain no trueGrade or model fields, verifies **AC-2**.
- Auth/permission: over limit requests receive 429 from the throttler; guess of 9 or "V5" receives 400, verifies **AC-8**.
- Write both or neither: an upload whose row insert fails leaves no object behind, verifies **AC-9**.
- Provider routing: with `AI_PROVIDER=bedrock` the vision call sends base64 bytes and a Bedrock model id, and no code path can pass a URL or a first party model id to Bedrock, verifies **AC-15**, **AC-16**.
- Presigned URL: the today response carries a URL that expires in one hour and still carries no grade of any kind, verifies **AC-14**, **AC-2**.
- Admin auth: an unauthenticated request to any `/internal/grade-photos` endpoint receives 401, verifies **AC-17**.
- Upload validation, two separate limits: a file over 10 MB is rejected with 413, while a file within the cap whose long edge exceeds 1568 pixels is accepted and resized, verifies **AC-17**.
- Upload hygiene: an image carrying EXIF GPS is re encoded so the stored object has none, and a file whose declared content type disagrees with its bytes is stored under the type the pipeline actually produced, verifies **AC-17**.
- Rollback safety: an upload whose insert fails deletes only its own object, and an upload using an already taken slug returns 409 without touching the existing photo's bytes, verifies **AC-9**.
- Day rollover: a guess carrying yesterday's date receives 409 rather than being graded against today's photo, verifies **AC-19**.
- Mid day pool change: deactivating the day's photo after its `GradeDay` row exists leaves the image, truth and analysis unchanged for that date, verifies **AC-20**.
- Licence gate: with the game enabled, a photo whose source is `unlicensed_test` never appears in the cycle and the exclusion is logged once at startup, verifies **AC-18**.

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
R7. The original steps 5 and 6, unchanged: reveal polish, the share button, metadata, and the home page teaser, satisfies **AC-10**, **AC-11**, **AC-12**.
R8. Content and gate: upload a real pool of 10 or more photos with each source recorded, confirm no `unlicensed_test` row is active, then run `/predeploy-audit` before the shipping push.

## Consequences

**Positive**:
- A return hook and shareable moment the portfolio currently lacks, at a fixed ~$0.02 per day ceiling with no cap machinery.
- Demonstrates vision reasoning with a visible explanation, a stronger interview artifact than object detection.
- The share summary is the distribution engine if the game is ever put in front of climbers; it costs one button and stores nothing.
- Zero injection surface and zero visitor content by construction, the cleanest data boundary story on the site.
- Adding a photo stops being a code change. The pool can grow from a phone, which is the difference between a pool that grows and one that stays at two placeholders.
- The photo exposure closed on 2026-08-21 cannot recur: with the bucket private and no game images under the web app's public directory, there is no path by which turning the flag off leaves images served.
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
5. Polish, teaser, real pool, audit, then flip the flag (R7, R8).

**Rollback**: phases 1 and 3 to 5 revert by reverting their commits, since nothing outside the feature reads them. Phase 2 is the only one that is not a plain revert: it drops `photos.json` and adds a table. Reverting after phase 2 means a down migration, and the safe order is to revert the code first and the schema second. Phase 4 touches `ForceToolCallParams`, so its revert is the one that can affect a live surface. Corrected 2026-08-21 after a cross check: that surface is BETA, not the interview simulator. The conversation path only calls `streamMessage` and is untouched by this change; the other `forceToolCall` callers are Beta's screener and drafter. Beta's tests are the guard, and Beta's are the tests to run before merging R5.

**Risks**:
- The `ForceToolCallParams` change is the only edit in this plan that touches a shipping feature. A mistake there breaks BETA, which is live, rather than the game, which is hidden. (An earlier draft of this spec named the interview simulator here, which was simply wrong: it uses `streamMessage` only.)
- Resizing on a free Render instance is a memory risk if the upload size cap is set too generously or enforced too late.
- A terraform apply that grants the api broader S3 access than intended is the kind of mistake nothing here would catch, since no test asserts the shape of an IAM policy.
- The vision call has never run. Phase 4 is where a problem that has been latent since the feature was built will finally surface, and the plan should expect that rather than treat it as a formality.

## Follow-up

- [ ] Owner: shoot and grade an initial pool (10 or more photos spanning V0 to V8) and upload it through the admin page, recording each photo's source. Images borrowed for testing are marked `unlicensed_test`, which keeps them out of the cycle once the game is enabled. Revised 2026-08-21: photos are no longer committed to the repo, and the pool is currently empty.
- [ ] Resolved 2026-08-21, recorded so it is not reopened without reason: `ForceToolCallParams` carries the image for every provider rather than the grade module owning a narrower vision specific seam. A narrower seam would need its own provider dispatch, its own error classification and its own DI token, all for exactly one caller, and the field is optional so every existing caller is unaffected. Revisit only if a second image caller appears with genuinely different needs.
- [ ] Orphan objects (an object with no row, from a crash between the two writes) are accepted by AC-9 and are harmless with random keys. If the pool ever grows enough that wasted storage matters, the admin list is the natural place to surface them.
- [ ] **Climbing hub repositioning is its own decision**: whether a climbing branded surface (separate domain or subdomain) should house this game, Beta, and future climbing features, and when Beta joins it (its advertising prerequisites: monitoring, Bedrock Guardrails, budget raise). The game can lead that brand because it has none of Beta's launch blockers; run `/architect` on it when ready. This spec deliberately decides only the portfolio hosted version.
- [ ] After launch, consider a "how everyone guessed vs Claude over time" stats page from the accumulated `GradeDay` rows (anonymous by construction).
