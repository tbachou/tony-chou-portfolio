# packages/shared — shared types

## Overview

A single hand-written `types.ts` shared between apps/web and apps/api via the TypeScript path alias `@portfolio/shared`. No build step, no package publishing — spec 0001 chose this deliberately to stop shape drift between the API's responses and the web client.

## Conventions

- Keep it tiny and hand-written; do not generate into it or add a build step.
- When an API response shape changes, update here first, then both consumers.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
