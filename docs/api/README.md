# Tony Chou portfolio API

<!--
  Generated from packages/shared/contracts.ts plus apps/api/src/openapi/route-registry.ts.
  Do not edit by hand: `npm run check:openapi --workspace=apps/api` fails on any difference.
  Regenerate with `npm run build:openapi --workspace=apps/api`.
-->

Version `1.0.0` · OpenAPI 3.1.0 · [`openapi.json`](openapi.json)

The HTTP surface of `apps/api`, the NestJS service behind the portfolio’s AI features: the interview simulator, Beta the return to climbing planner, and Grade Guesser.

This document is generated from the zod schemas that actually validate each request (`packages/shared/contracts.ts`) plus a route registry, and a CI check fails the build when either artifact stops matching the code. Run `npm run build:openapi --workspace=apps/api` to regenerate it.

**What is described here.** Request bodies and path parameters are generated, so they are exactly what the service enforces, including the refusal of unknown properties. Responses are hand written from the service return types and are not machine checked, so treat them as documentation rather than as a contract.

**Authentication.** Eleven routes are anonymous. The four under `/internal` require a better-auth session cookie and are the admin surface. Sign up is permanently closed; the single admin account is seeded directly.

**Rate limiting.** A route that documents a `429` response is rate limited; a route that does not is not. There is no global limiter, so the static reads carry no limit of their own. Where a limit applies it is keyed per client on an address identity that collapses an IPv6 allocation to its /64 prefix, so rotating within one cannot buy more requests, and it comes in two layers: an in memory window that resets on deploy, and, for the routes that spend money on a model call, a persisted daily cap that does not. Exceeding a window answers 429; exhausting the shared daily budget for plans answers 503. The numbers are deliberately not copied here, because they move and a stale limit in a public document is worse than none. `check:openapi` compares each route’s 429 against the code, so this paragraph cannot drift from it.

**Not described here.** better-auth mounts its own sign in and session handlers, which are not Nest controller routes and so are outside both the registry and the check that guards it. `apps/web` also serves its own route handlers on the web origin; those are a separate surface and this document leaves them out on purpose.

**No `servers` block.** The api origin is not published in this repository.

## Every route

| Route | Auth | Summary |
|---|---|---|
| [`GET /`](#op-get-root) | anonymous | Service greeting |
| [`GET /health`](#op-get-health) | anonymous | Health check |
| [`GET /stories`](#op-get-stories) | anonymous | List the curated stories |
| [`GET /topics`](#op-get-topics) | anonymous | List the interview topics |
| [`GET /beta/status`](#op-get-beta-status) | anonymous | Whether Beta can take a plan right now |
| [`POST /beta/plan`](#op-post-beta-plan) | anonymous | Generate a return to climbing plan (streaming) |
| [`POST /conversation/turn`](#op-post-conversation-turn) | anonymous | Generate the next interview turn pair (streaming) |
| [`POST /feedback`](#op-post-feedback) | anonymous | Submit feedback |
| [`GET /grade/problems`](#op-get-grade-problems) | anonymous | List today’s problem ids (only when `GRADE_GAME_ENABLED` is set) |
| [`GET /grade/problems/{publicId}/image`](#op-get-grade-problems-by-publicId-image) | anonymous | Get a problem’s image URL (only when `GRADE_GAME_ENABLED` is set) |
| [`POST /grade/guess`](#op-post-grade-guess) | anonymous | Submit a guess and get the reveal (only when `GRADE_GAME_ENABLED` is set) |
| [`GET /internal/usage/summary`](#op-get-internal-usage-summary) | session | Usage totals for the admin dashboard |
| [`GET /internal/grade-photos`](#op-get-internal-grade-photos) | session | List the Grade Guesser photo pool |
| [`POST /internal/grade-photos`](#op-post-internal-grade-photos) | session | Add a photo to the pool |
| [`PATCH /internal/grade-photos/{id}/active`](#op-patch-internal-grade-photos-by-id-active) | session | Activate or retire a photo |

## service

Liveness and greeting.

<a id="op-get-root"></a>

### `GET /`

**Service greeting**

Auth: anonymous

A plain text liveness greeting from the Nest root controller. Carries no state and is not the health check.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `text/plain` | A greeting. |

<a id="op-get-health"></a>

### `GET /health`

**Health check**

Auth: anonymous

Answers as soon as the process is serving. It does not reach the database.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | The service is up. |

**`200` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string | yes | one of `ok` |

## content

The curated stories and interview topics.

<a id="op-get-stories"></a>

### `GET /stories`

**List the curated stories**

Auth: anonymous

The verified work stories the interview simulator is grounded in. `ownership` is what the honesty guard enforces: a story marked `contributed` or `co-led` may not be claimed solo.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | Every story. |

**`200` response body** (one array element)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `title` | string | yes |  |
| `ownership` | string | yes | one of `solo`, `contributed`, `co-led` |
| `engagement` | string | yes |  |
| `summary` | string | yes |  |

<a id="op-get-topics"></a>

### `GET /topics`

**List the interview topics**

Auth: anonymous

The topics a visitor can start a conversation on. `id` is what `POST /conversation/turn` takes.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | Every topic. |

**`200` response body** (one array element)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `slug` | string | yes |  |
| `label` | string | yes |  |
| `description` | string | yes |  |

## conversation

The interview simulator.

<a id="op-post-conversation-turn"></a>

### `POST /conversation/turn`

**Generate the next interview turn pair (streaming)**

Auth: anonymous

Generates one turn pair, an interviewer question and an answer in Tony’s voice, and streams both as Server Sent Events. Every generated answer passes the ownership guard before a single token reaches the visitor.

Omit `conversationId` to start a conversation; the first `turn_end` carries the id to send back on the next call. The transcript is rebuilt from persisted rows and is never echoed by the client.

No visitor text is stored. The service persists anonymous counters and a hashed address only.

**Event sequence**

| Event | Data | When |
|---|---|---|
| `turn_start` | `{ role: "interviewer" \| "tony" }` | A speaker begins. Sent twice per turn pair. |
| `token` | `{ text: string }` | A chunk of the current speaker’s text. |
| `turn_end` | `{ conversationId: string, turnIndex: number, isFinal: boolean }` | The pair is complete. `isFinal` marks the last turn of the conversation. |
| `turn_error` | `{ message: string }` | Generation failed after the stream opened. No `turn_end` follows. |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `topicId` | string | yes | 1 to ∞ characters |
| `conversationId` | string | no | format `uuid`; matches `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\|00000000-0000-0000-0000-000000000000\|ffffffff-ffff-ffff-ffff-ffffffffffff)$` |

_Any property not listed is rejected, it is not dropped._

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `text/event-stream` | The stream opened. Events follow in the sequence above; a turn that fails mid stream still answers 200 and reports the failure as a `turn_error` event. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |
| `500` | [`Error`](#error) | The topic has no mapped stories, or the service is not configured to reach the model provider. Raised before the stream opens. |

## beta

Beta, the return to climbing planner.

<a id="op-get-beta-status"></a>

### `GET /beta/status`

**Whether Beta can take a plan right now**

Auth: anonymous

Lets a client show the daily cap before a visitor fills the form. `reason` is `daily_cap` when the shared budget for the day is spent.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | Current availability. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |

**`200` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `available` | boolean | yes |  |
| `reason` | string | yes | one of `ok`, `daily_cap` |

<a id="op-post-beta-plan"></a>

### `POST /beta/plan`

**Generate a return to climbing plan (streaming)**

Auth: anonymous

Runs a three agent pipeline, screener then drafter then coach, and streams the result as Server Sent Events.

Beta is an educational demo. It is not medical advice, a diagnosis, or physical therapy. It screens for warning signs but does not ask about age, pregnancy, medication, surgery or other conditions, and the web app gates the form behind a fuller caveat that a direct caller of this route never sees.

Every failure that can be known before the stream opens arrives as a plain HTTP error, including the rate limits and the daily budget. Once the stream is open the status is already 200, so later failures arrive as an `error` event instead.

Nothing a visitor types here is stored or logged. The service keeps anonymous counters only.

**Event sequence**

| Event | Data | When |
|---|---|---|
| `status` | `{ stage: "screening" \| "drafting" \| "coaching" }` | Each time the pipeline enters a stage. |
| `red_flag` | `{ category: string \| null, message: string }` | A red flag was found: a checked warning sign, a pain pattern treated the same way, or the screener’s own judgment. The pipeline stops; no plan follows. |
| `plan_delta` | `{ text: string }` | A chunk of plan text. Append it to what you already hold. |
| `plan_replace` | `{}` | Discard the text so far: the coach is rewriting the plan from the start. |
| `error` | `{ message: string }` | The pipeline stopped after the stream opened. No `done` follows. |
| `done` | `{}` | The plan is complete. The stream then closes. |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `injuryArea` | string | yes | one of `finger_pulley`, `elbow_tendinopathy`, `shoulder_impingement` |
| `onsetWeeksAgo` | integer | yes | 0 to 520 |
| `symptoms` | string[] | yes | each one of `sudden_pop_with_swelling`, `numbness_or_tingling`, `cannot_bear_weight_or_grip`, `night_pain`, `pain_with_specific_holds_or_moves`, `pain_at_session_start_that_warms_up`, `morning_stiffness`, `mild_swelling`, `tenderness_to_touch`, `weakness_or_early_fatigue`; at most 10 items |
| `painBehavior` | string | yes | one of `none_at_rest_hurts_under_load`, `warms_up_then_fine`, `worsens_as_session_goes_on`, `constant_even_at_rest` |
| `preInjuryGrade` | string | yes | 1 to 12 characters; matches `^[A-Za-z0-9 .+/-]+$` |
| `discipline` | string | yes | one of `bouldering`, `sport`, `trad`, `indoor_gym` |
| `goals` | string | no | 0 to 200 characters |
| `sessionsPerWeek` | integer | no | 0 to 14 |
| `equipmentAccess` | string[] | no | each one of `climbing_gym`, `home_wall`, `hangboard`, `resistance_bands`, `weights`, `none`; at most 6 items |

_Any property not listed is rejected, it is not dropped._

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `text/event-stream` | The stream opened. Events follow in the sequence above; a plan that fails mid stream still answers 200 and reports the failure as an `error` event. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |
| `500` | [`Error`](#error) | The service is not configured to reach the model provider. Raised before the stream opens. |
| `503` | [`Error`](#error) | The shared daily budget for plans is spent. It resets the next day. |

## grade

Grade Guesser, the daily climbing grade game.

<a id="op-get-grade-problems"></a>

### `GET /grade/problems`

**List today’s problem ids**

Auth: anonymous

Public ids only, in play order. Images are minted one at a time by the route below rather than all at once.

**Conditional route.** This route exists only when `GRADE_GAME_ENABLED` is set. The module that serves it is not registered otherwise, so it answers 404 rather than being disabled.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | The ordered problem ids and how many there are. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |

**`200` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `problems` | object[] | yes |  |
| `problems[].publicId` | string | yes |  |
| `count` | integer | yes |  |

<a id="op-get-grade-problems-by-publicId-image"></a>

### `GET /grade/problems/{publicId}/image`

**Get a problem’s image URL**

Auth: anonymous

Mints a presigned object URL at the moment the problem is shown. A problem that is not licensed for display answers 404 rather than 403, so an excluded photo is indistinguishable from one that does not exist.

**Conditional route.** This route exists only when `GRADE_GAME_ENABLED` is set. The module that serves it is not registered otherwise, so it answers 404 rather than being disabled.

**Path parameters**

| Parameter | Type | Notes |
|---|---|---|
| `publicId` | string | matches `^[0-9a-f]{16}$` |

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | A presigned URL for the image. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `404` | [`Error`](#error) | No such problem, or the problem is not licensed for display. |
| `410` | [`Error`](#error) | The problem exists but is no longer active. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |

**`200` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `imageUrl` | string | yes |  |

<a id="op-post-grade-guess"></a>

### `POST /grade/guess`

**Submit a guess and get the reveal**

Auth: anonymous

Records the guess and answers with the true grade, the histogram of every guess so far, and the model’s own attempt when it has landed.

**Conditional route.** This route exists only when `GRADE_GAME_ENABLED` is set. The module that serves it is not registered otherwise, so it answers 404 rather than being disabled.

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `guess` | integer | yes | 0 to 8 |
| `publicId` | string | yes | matches `^[0-9a-f]{16}$` |

_Any property not listed is rejected, it is not dropped._

**Responses**

| Status | Body | Description |
|---|---|---|
| `201` | `application/json` | The reveal for this problem. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `404` | [`Error`](#error) | No such problem, or the problem is not licensed for display. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |
| `503` | [`Error`](#error) | The problem’s stats row could not be read back. Retry. |

**`201` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `publicId` | string | yes | Echoed back so a client can match a reveal to the problem it holds. |
| `trueGrade` | integer | yes |  |
| `model` | object \| null | yes | Null while this problem’s vision call has not landed yet. |
| `model.grade` | integer | yes |  |
| `model.confidence` | string | yes | one of `low`, `medium`, `high` |
| `model.observations` | string[] | yes |  |
| `model.reasoning` | string | yes |  |
| `guessCounts` | integer[] | yes |  |
| `plays` | integer | yes |  |
| `yourGuess` | integer | yes |  |
| `yourDistance` | integer | yes |  |
| `modelDistance` | integer \| null | yes | Null whenever `model` is. |
| `note` | string | no |  |

## feedback

Visitor feedback.

<a id="op-post-feedback"></a>

### `POST /feedback`

**Submit feedback**

Auth: anonymous

Accepts a short message from a visitor. This is the one place the service stores visitor typed text on purpose; it is stored and forwarded for classification, and it is never written to a log.

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | string | yes | 1 to 2000 characters |
| `category` | string | no | one of `bug`, `feature`, `other` |
| `source` | string | yes | one of `beta`, `portfolio` |

_Any property not listed is rejected, it is not dropped._

**Responses**

| Status | Body | Description |
|---|---|---|
| `201` | `application/json` | Accepted. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `429` | [`Error`](#error) | A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies. |

**`201` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |

## internal

The admin surface, behind a better-auth session.

<a id="op-get-internal-usage-summary"></a>

### `GET /internal/usage/summary`

**Usage totals for the admin dashboard**

Auth: better-auth session cookie

A rolling window of daily turn and token totals, plus the heaviest sources by hashed address. Addresses are hashed at the boundary and never stored raw.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | The usage summary. |
| `401` | [`Error`](#error) | No valid better-auth session cookie was sent, or it has expired. |

**`200` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `dailyTotals` | object[] | yes |  |
| `dailyTotals[].date` | string | yes | format `date` |
| `dailyTotals[].turnCount` | integer | yes |  |
| `dailyTotals[].tokenCount` | integer | yes |  |
| `topSources` | object[] | yes |  |
| `topSources[].hashedIp` | string | yes |  |
| `topSources[].tokenCount` | integer | yes |  |

<a id="op-get-internal-grade-photos"></a>

### `GET /internal/grade-photos`

**List the Grade Guesser photo pool**

Auth: better-auth session cookie

Every photo in the pool, active or not, each with a presigned URL the browser can load. Registered whatever `GRADE_GAME_ENABLED` is set to, so the pool can be curated while the game is off.

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | The whole pool. |
| `401` | [`Error`](#error) | No valid better-auth session cookie was sent, or it has expired. |

**`200` response body** (one array element)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `trueGrade` | integer | yes |  |
| `source` | string | yes |  |
| `sourceNote` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `active` | boolean | yes |  |
| `createdAt` | string | yes | format `date-time` |
| `imageUrl` | string | yes | A presigned object URL, valid for a limited window. |

<a id="op-post-internal-grade-photos"></a>

### `POST /internal/grade-photos`

**Add a photo to the pool**

Auth: better-auth session cookie

A multipart upload: the fields below plus the image itself. The image is re-encoded before it is stored.

**Field notes**

- `trueGrade`: Arrives as a string over multipart and is coerced to an integer. The generated schema says `integer`, which is what the field becomes, not what the wire carries.

**Request body** (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | matches `^[a-z0-9][a-z0-9-]{2,63}$` |
| `trueGrade` | integer | yes | 0 to 8 |
| `source` | string | yes | one of `own_photo`, `permission_given`, `licensed`, `unlicensed_test` |
| `sourceNote` | string | no | 0 to 500 characters |
| `note` | string | no | 0 to 200 characters |
| `file` | string | yes | The image. Required. Rejected with 413 above the size limit and 415 when it cannot be decoded as an image.; format `binary` |

_Any property not listed is rejected, it is not dropped._

**Responses**

| Status | Body | Description |
|---|---|---|
| `201` | `application/json` | The stored photo. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `401` | [`Error`](#error) | No valid better-auth session cookie was sent, or it has expired. |
| `409` | [`Error`](#error) | A photo with this id is already in the pool. |
| `413` | [`Error`](#error) | The image is larger than the upload limit. |
| `415` | [`Error`](#error) | The upload could not be decoded as an image. |

**`201` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `trueGrade` | integer | yes |  |
| `source` | string | yes |  |
| `sourceNote` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `active` | boolean | yes |  |
| `createdAt` | string | yes | format `date-time` |
| `imageUrl` | string | yes | A presigned object URL, valid for a limited window. |

<a id="op-patch-internal-grade-photos-by-id-active"></a>

### `PATCH /internal/grade-photos/{id}/active`

**Activate or retire a photo**

Auth: better-auth session cookie

Toggles whether a photo can be served to players. Retiring one does not delete it.

**Field notes**

- `active`: Accepts the strings `"true"` and `"false"` as well as a real boolean, because the admin form sends a string. The generated schema says `boolean`, which is what the field becomes.

**Path parameters**

| Parameter | Type | Notes |
|---|---|---|
| `id` | string | matches `^[a-z0-9][a-z0-9-]{2,63}$` |

**Request body** (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `active` | boolean | yes |  |

_Any property not listed is rejected, it is not dropped._

**Responses**

| Status | Body | Description |
|---|---|---|
| `200` | `application/json` | The updated photo. |
| `400` | [`ValidationError`](#validationerror) | The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping. |
| `401` | [`Error`](#error) | No valid better-auth session cookie was sent, or it has expired. |
| `404` | [`Error`](#error) | No photo with this id. |

**`200` response body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `trueGrade` | integer | yes |  |
| `source` | string | yes |  |
| `sourceNote` | string \| null | yes |  |
| `note` | string \| null | yes |  |
| `active` | boolean | yes |  |
| `createdAt` | string | yes | format `date-time` |
| `imageUrl` | string | yes | A presigned object URL, valid for a limited window. |

## Shared error shapes

Every error response uses one of these two.

<a id="validationerror"></a>

### `ValidationError`

| Field | Type | Required | Notes |
|---|---|---|---|
| `statusCode` | integer | yes | one of `400` |
| `message` | string[] | yes | One entry per failed field, as `path: reason`. |
| `error` | string | yes | one of `Bad Request` |

<a id="error"></a>

### `Error`

| Field | Type | Required | Notes |
|---|---|---|---|
| `statusCode` | integer | yes |  |
| `message` | string | yes |  |
| `error` | string | no |  |
