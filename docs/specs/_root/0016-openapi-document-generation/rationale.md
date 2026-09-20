# 0016. OpenAPI document generated from the zod contracts — rationale

## Context

> ⚠️ Premise note: the purpose chosen for this document is a readable artifact, and it has no machine consumer, yet the shape it takes is real machinery: a registry, a generator, a Markdown renderer, a three way check and a CI step, for 15 routes a determined reader could learn from nine controller files. The proportionality question is fair and should be asked out loud. The answer is that two thirds of the check earn their keep independently of the document: comparing the registry against `@AllowAnonymous` makes a false authentication claim in a public file a build failure, and walking the controllers for input bindings without a validation pipe closes a hole `main.ts` currently names as an accepted cost. If those two assertions were dropped, this would be a lot of scaffolding for a file nobody parses, and the honest alternative would be Option 4.

`apps/api` exposes 15 routes across nine controllers. Eleven are anonymous and four sit behind the better-auth session guard. The only description of that surface is the controller files themselves. For a repository that is public and whose purpose is to be read, the surface is effectively undocumented: understanding what the service accepts means opening nine files and following each `@Body` binding into `packages/shared/contracts.ts`.

Three forces shape what can be built here.

The first is that request shapes are already single sourced. Every body and path parameter is a zod schema in `contracts.ts`, applied per route through `ZodValidationPipe`, and every contract object is `.strict()`. That file states as its first rule that there is one definition per contract, so a field cannot be tightened on one side and left alone on the other. Anything that introduces a second description of a request shape works against the reason that file exists.

The second is that response shapes are not single sourced and never have been. They are hand written TypeScript interfaces living in the services and in `types.ts`. Nothing can generate them today without first changing how every service types its return value.

The third is that the repository is public, so merging publishes. Whatever this document contains becomes permanent: the api origin appears nowhere in the tree today, and anything the document asserts about which routes require authentication is a security claim visible to everyone. A document that is confidently wrong is worse than no document, and generated documents that nothing checks are reliably wrong within a few months.

There is also no external consumer to serve. The only client is `apps/web`, in the same repository, which imports the inferred types from `@portfolio/shared` directly. That is stronger than anything a generated client could offer, so this decision is not about type safety. It is about whether the public surface is legible.

## Options considered

### Option 1: Generate from zod, hand authored route registry, CI check

One script reads the zod exports for request shapes, a hand authored registry for everything zod cannot know (method, path, auth, responses, prose), and writes both artifacts. A check compares the registry against the controllers and the artifacts against a fresh generation.

**Pros**:

- Request shapes stay single sourced; nothing restates a field.
- No new dependency. zod 4.4.3 exports JSON Schema natively, and OpenAPI 3.1 is a superset of JSON Schema 2020-12, so the output passes through.
- The check turns the registry from a liability into a guarded copy, and can cheaply also catch a route added with no validation at all.
- Matches an established repository pattern: a committed generated artifact guarded by a file only CI check, as `check:skills`, `check:evals` and `check:corpus` already do.

**Cons**:

- The registry is a second description of method, path, auth and responses. The check keeps it honest but it is still a file to edit whenever a route changes.
- Response shapes remain hand authored, so the response half of the document can drift from the service interfaces with nothing to catch it.

### Option 2: `@nestjs/swagger` with class DTOs

The conventional NestJS path: decorate class DTOs with `@ApiProperty` and let `SwaggerModule` build the document.

**Pros**:

- Well understood, heavily documented, and the routes and their metadata come from the framework rather than a hand maintained list.
- Brings a served UI essentially for free.

**Cons**:

- Requires class DTOs, which this repository deliberately does not have. Every contract would exist twice, once as a zod schema and once as a decorated class, which is precisely the drift `contracts.ts` was built to prevent.
- The decorated class is not what validates, so the two can disagree while both look correct.

### Option 3: Introspect the running Nest application

Boot `AppModule` in a script and walk the router to discover routes.

**Pros**:

- Routes cannot go missing, because the source is the thing that actually serves them.

**Cons**:

- The import chain reaches `new PrismaClient()` through `lib/auth.ts`, and better-auth is ESM only, so a documentation script inherits the whole boot surface and its environment requirements.
- `GradeModule` is registered conditionally on `GRADE_GAME_ENABLED`, so introspection produces a different document depending on an environment variable. A documentation artifact whose content depends on how the script was invoked cannot be diffed in CI.

### Option 4: No document, prose in the README

Describe the surface in the README by hand.

**Pros**:

- Zero machinery, and prose can explain things a schema cannot.

**Cons**:

- Nothing keeps it true. Hand written API prose is the single most reliably stale document in any repository.
- Throws away the fact that exact, validated request shapes are already sitting in `contracts.ts` ready to be published.

## Rationale

The deciding force is that request shapes are already single sourced and response shapes are not. Option 1 is the only one that publishes the single sourced half without copying it, and is honest about hand authoring the half that has no generator. Option 2 would have solved the response problem by making both halves hand authored, which trades the real asset away for symmetry.

The second force is the public repository. A document nobody checks decays, and here decay is published. That is why the check is not an optional extra in this spec but the thing that makes the registry acceptable at all: the registry is a duplication, and only the check distinguishes a guarded duplication from an unguarded one. Since the check must walk the controllers anyway to compare routes and auth markings, extending it to catch a route bound without a validation pipe costs almost nothing and closes a hole `main.ts` already names as the price of dropping the global pipe. All eight current bindings carry a pipe, so it starts green.

The third force is conditional registration. `GradeModule` is only imported when `GRADE_GAME_ENABLED` is true, which rules out runtime introspection on its own: Option 3 would emit a document whose contents depend on the environment of whoever ran it, and a CI check that diffs such an artifact is unimplementable. A static registry records the gate as a fact about the route instead.

Two calls worth stating. The scripts live in `apps/api` rather than the repository root, following `check-corpus.ts`, which documents that choice for itself; the runner up was root `scripts/` alongside `check-evals.mjs`, rejected because the domain knowledge here is the api's own route surface. And the logic the check depends on lives in `apps/api/src/openapi/` rather than in `scripts/`, because jest's `rootDir` is `src` and will not collect `scripts/`, which is the same reason four eval and retrieval files already sit in `src` with a single caller in `scripts/`. The thin script wrappers stay in `scripts/`.
