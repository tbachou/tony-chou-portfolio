# packages/shared — the request contracts, and shared types

## Overview

What both apps agree on, imported as `@portfolio/shared`:

- **[contracts.ts](contracts.ts)** — a zod schema per HTTP contract, plus the enums and bounds those schemas use. The api validates every request body and param against these (`ZodValidationPipe`); the web app builds its payloads to the types inferred from them. One definition per contract, so a rule cannot be tightened on one side and left alone on the other.
- **[types.ts](types.ts)** — hand-written response shapes that no schema owns.

Spec 0001 chose a shared package to stop shape drift between the API's responses and the web client. The schemas extend that from response shapes to request shapes.

## Build

There **is** a build step now, which there was not before: `tsc -p tsconfig.json` into `dist/`. It exists because apps/api runs compiled JS (`node dist/main`) and cannot require raw TypeScript from a workspace package at runtime.

- `main` points at `dist/index.js` — what Node resolves.
- `types` points at `index.ts` — the source, so `tsc --noEmit` in either app needs no build first.
- The root `postinstall` builds it, and both apps `prebuild` it, so a fresh clone and a deploy both work without anyone remembering.
- After editing a schema, rebuild (`npm run build:shared`) before running the api, or it will keep validating against the previous version.

## Conventions

- **Every object schema is `.strict()`.** That is what replaced the api's `forbidNonWhitelisted`: an unexpected property is a 400 rather than something silently dropped. Do not relax it.
- **These are request shapes, not form shapes.** A form input is a string even when the field is a number, so the web app validates its own inputs and converts before handing over a value these schemas accept.
- **Nothing coerces unless the transport forces it.** The multipart upload's `trueGrade` and the active toggle's string booleans coerce because those fields arrive as strings; everything else must fail rather than convert.
- Enums live here rather than in a module's constants file. The api's constants re-export them so each module keeps reading its own vocabulary from its own file.
- When an API response shape changes with no schema to own it, update `types.ts` first, then both consumers.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
