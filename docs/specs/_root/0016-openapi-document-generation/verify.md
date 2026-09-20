# Verify: OpenAPI document generation · spec 0016 · updated 2026-09-20

_Steps derived from spec 0016 acceptance criteria and its Value sourcing table. `/check` runs these._

Everything here reads committed files. Nothing needs a database, a key, a network call or a running server. Run from the repo root on Node 22 or newer.

## Commands

- [ ] `npm run check:openapi --workspace=apps/api` → `check:openapi OK — 15 routes, registry and artifacts match the code`, exit 0 → AC-1, AC-8, AC-9, AC-10
- [ ] `npm run build:openapi --workspace=apps/api` then `git diff --exit-code docs/api/` → no diff, exit 0. Run the build a second time and diff again: still no diff → AC-9, AC-12
- [ ] `cd apps/api && env -i PATH="$PATH" HOME="$HOME" npx tsx scripts/check-openapi.ts` → still OK with no `DATABASE_URL`, no `ANTHROPIC_API_KEY` and no `GRADE_GAME_ENABLED` set → AC-11
- [ ] `cd apps/api && npx jest src/openapi` → 57 tests pass → AC-2, AC-4, AC-5, AC-6, AC-13, AC-14
- [ ] `npx tsc --noEmit -p apps/api/tsconfig.json` and `npm run lint` → both exit 0
- [ ] `grep -c '"servers"' docs/api/openapi.json` → 0, and no `onrender.com`, `vercel.app` or other origin anywhere in `docs/api/` → AC-6

## Break and confirm

Each step breaks the tree deliberately, confirms the check fails **and names the offender**, then restores. A check that passes on a broken tree is worth nothing, so run these rather than trusting a green run.

- [ ] Add a second handler to `apps/api/src/modules/health/health.controller.ts` (for example `@Get('deep')`) → check fails with `GET /health/deep is served by HealthController.deep (...) but is not in the registry`. Restore → AC-8
- [ ] Add `@AllowAnonymous()` to `apps/api/src/modules/usage-summary/usage-summary.controller.ts` → check fails with `GET /internal/usage/summary is marked as requiring a session in the registry, but UsageSummaryController.getSummary carries @AllowAnonymous()`. Restore. This is the assertion that stops a false security claim reaching a public file → AC-4, AC-8
- [ ] In `apps/api/src/modules/feedback/feedback.controller.ts` replace `@Body(new ZodValidationPipe(createFeedbackSchema))` with a bare `@Body()` → check fails with `FeedbackController.create (...) binds @Body() with no ZodValidationPipe, so POST /feedback validates nothing`. Restore → AC-10
- [ ] Hand edit one string inside `docs/api/openapi.json` → check fails with `docs/api/openapi.json differs from a fresh generation`. Restore. Repeat for `docs/api/README.md` → AC-9
- [ ] Delete a route entry from `apps/api/src/openapi/route-registry.ts` → check fails with `<route> is in the registry but no controller serves it`, the mirror of the first case. Restore → AC-8

### The evasions a pre-deploy audit confirmed, then closed

Each of these shipped a live route that the first version of the check reported as clean. They are covered by `controller-scan.spec.ts`, but replay them against the real tree when the scan changes, because unit tests on synthetic sources cannot prove the file walk still reaches every controller.

- [ ] **A controller in a file not named `*.controller.ts`.** Add `apps/api/src/modules/health/health-extra.ts` with a `@Controller('health-extra')` class holding `@Post('echo') echo(@Body() body: unknown)`, register it in `health.module.ts` → check fails twice: not in the registry, and binds `@Body()` with no pipe. Restore → AC-8, AC-10
- [ ] **A handler inherited from a base class.** Put a `class BaseHealthController` with a `@Post('echo')` handler above `@Controller('health')`, and make `HealthController extend` it → check fails naming `HealthController.echo`. NestJS walks the prototype chain, so that route really is served. Restore → AC-8, AC-10
- [ ] **An aliased Nest import.** In `feedback.controller.ts` change the import to `Body as ReqBody` and the binding to a bare `@ReqBody()` → check fails naming `FeedbackController.create`. This is the route that persists visitor typed text. Restore → AC-10
- [ ] **A better-auth exemption that is not `@AllowAnonymous`.** Add `@Public()` (a direct alias) to `usage-summary.controller.ts` → check fails with `GET /internal/usage/summary is marked as requiring a session in the registry, but ... is reachable without one`. Repeat with `@OptionalAuth()`. Restore → AC-4
- [ ] **A schema swap.** In `route-registry.ts` change the `/feedback` row's `requestSchema` to `gradeGuessRequestSchema` → check fails with `publishes a different requestSchema than the code enforces`. Restore. This is what keeps the document's headline claim true → AC-2
- [ ] **A validated `@Query` with nowhere to go.** Add `@Query(new ZodValidationPipe(gradeProblemIdParamSchema))` to `GradeController.problems` → check fails with `documents no querySchema`, rather than silently dropping the parameter from the document → AC-1
- [ ] **A path argument the scan cannot read.** Change `@Controller('health')` to `@Controller({ path: 'health' })` → check fails naming the file and saying the prefix cannot be read. The old code defaulted to an empty prefix and produced a misdiagnosing "two controller handlers serve the same method and path". Restore → AC-8
- [ ] **A rate limiting claim the code does not back.** Remove `@Throttle(...)` and the throttler guard from `feedback.controller.ts` → check fails with `documents a 429 response but ... carries no throttle`. Restore → AC-13
- [ ] **A controller no module registers.** Comment `HealthController` out of `health.module.ts`'s `controllers: []` → check fails saying NestJS never mounts it, rather than publishing a route that answers 404. Restore → AC-1

## Value sourcing

One step per row of the spec's Value sourcing table, so each published value is exercised at its source rather than only at design time.

- [ ] **Request schema body.** Tighten a bound in `packages/shared/contracts.ts` (for example `createFeedbackSchema.message` max from 2000 to 1999), run `npm run build:shared`, then `build:openapi` → `docs/api/README.md` shows `0 to 1999 characters` for `POST /feedback`. Restore and rebuild. Proves the request half is generated, never transcribed → AC-2
- [ ] **`additionalProperties: false` from `.strict()`.** `grep -c '"additionalProperties": false' docs/api/openapi.json` → at least one per request body, and each request body section of the Markdown carries _Any property not listed is rejected, it is not dropped._ → AC-2
- [ ] **Method and path from the registry, compared to the controllers.** Covered by the first two break and confirm steps → AC-8
- [ ] **Auth marking.** `docs/api/README.md` route table shows exactly four `session` rows, all under `/internal`, and eleven `anonymous` rows → AC-4
- [ ] **The `/grade/*` conditional note.** All three grade routes say `This route exists only when GRADE_GAME_ENABLED is set`, and their index rows say `(only when GRADE_GAME_ENABLED is set)`. Confirm `apps/api/src/app.module.ts` still gates `GradeModule` on that variable → AC-14
- [ ] **A success status and body.** Spot check one route against its service: `POST /grade/guess` documents `201` (Nest's default for POST, no `@HttpCode` on the handler) and its field table matches `GradeReveal` in `apps/api/src/modules/grade/grade.service.ts`, including `model` and `modelDistance` being nullable → AC-3
- [ ] **The shared 400 body.** `ValidationError` in the Markdown shows `message` as `string[]`, matching `ZodValidationPipe` throwing `BadRequestException` with an array → AC-3
- [ ] **The 413 on upload.** `POST /internal/grade-photos` documents 413, matching `MulterErrorFilter` and `MAX_UPLOAD_BYTES` → AC-3
- [ ] **Limiting, as responses.** 429 appears on the public routes that can emit it and 503 on `POST /beta/plan` and `POST /grade/guess` → AC-13
- [ ] **Limiting, as prose with no numbers.** The document description describes the limiting model, and `grep -in "per hour\|per minute\|per day\|requests per" docs/api/` returns nothing. No `@Throttle` number reaches either artifact → AC-13
- [ ] **Limiting, as a checked claim.** The description says a route is limited exactly when it documents a 429, and `check:openapi` compares every route's 429 against the controllers, so the sentence cannot drift. It used to say "every public route is limited per client", which was false for `GET /`, `/health`, `/stories` and `/topics` → AC-13
- [ ] **SSE event sequences.** `POST /conversation/turn` and `POST /beta/plan` are `text/event-stream` with an event table. Check each event name against the emitting service (`conversation.service.ts` emits `turn_start`, `token`, `turn_end`, `turn_error`; `beta.service.ts` emits `status`, `red_flag`, `plan_delta`, `plan_replace`, `error`, `done`) → AC-5
- [ ] **Coercion field notes.** `POST /internal/grade-photos` carries a field note on `trueGrade` and the PATCH route one on `active`, both saying the generated type is what the field becomes and not what the wire carries. This is the document's known imprecision, so the note is the fix → AC-2
- [ ] **`info.version` is a constant.** `docs/api/openapi.json` has `"version": "1.0.0"` and it changes only when `DOCUMENT_VERSION` in `apps/api/src/openapi/document.ts` changes. No date or clock appears in either artifact → AC-12
- [ ] **One document, two renderings.** The route count in the Markdown index table equals the operation count in the JSON (15), because both come from the same in memory object → AC-7

## Manual

- [ ] Open `docs/api/README.md` on GitHub → every table renders, and each row of the index table jumps to its route section. The anchors are explicit `<a id="op-...">` tags, so this is the one thing local checks cannot prove → AC-7
- [ ] Skim both artifacts as a stranger would → no api origin, no credential, no visitor content, nothing operational that does not belong in a public repository → AC-6

## Acceptance criteria coverage

- AC-1 → `check:openapi` step, and the 15 operation count
- AC-2 → jest run, request schema sourcing step, `additionalProperties` step, coercion note step
- AC-3 → success status step, shared 400 step, 413 step
- AC-4 → jest run, auth marking step, the `@AllowAnonymous` break and confirm
- AC-5 → jest run, SSE event sequence step
- AC-6 → `servers` grep step, jest run, manual skim
- AC-7 → one document two renderings step, manual GitHub render
- AC-8 → three break and confirm steps (added route, removed registry entry, auth flip)
- AC-9 → rebuild and diff step, hand edit break and confirm
- AC-10 → dropped pipe break and confirm
- AC-11 → emptied environment step
- AC-12 → double rebuild step, `info.version` step
- AC-13 → 429 and 503 step, no numbers step
- AC-14 → grade conditional step
