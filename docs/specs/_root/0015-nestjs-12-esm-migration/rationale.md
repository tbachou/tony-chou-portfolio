# 0015. Rationale

Reasoning, options, and evidence for [index.md](index.md).

## Context

> ⚠️ Premise note: the one constraint that survives the educational framing is that the site is live. This repository is a personal learning project, staying on the latest framework is an explicit goal in itself, and stability is deliberately not the top priority (stated by the engineer, 2026-09-20). That settles the cost question: the migration does not need to be justified by the advisories, and Option 2 below is rejected precisely because it avoids the work that is the point. What does not change is that `apps/api` serves the live portfolio site, which is itself a job application artifact, and that the repository is public so every push is publication. So the two protections worth keeping are the ones that are cheap and unrelated to framework risk: verify on a Render branch deploy before `main` (step 9), and keep the spend caps and the no logging invariants intact through the migration. Breaking the build while learning is fine and expected. Breaking the live site during a job search, or leaking something into public history, is a different category and stays guarded.

`apps/api` runs NestJS 11 on CommonJS, the older way Node loads code. Spec 0001 chose that deliberately in August 2026, and cited it when rejecting Arcjet for not supporting CommonJS natively. The service hosts every AI surface on the portfolio: the interview simulator, Beta the return to climbing planner, Grade Guesser, and the feedback endpoint. It deploys to Render on a single instance, and a push to `main` deploys automatically.

Four `multer` advisories were opened by Dependabot against the file upload path. Two were dismissed on 2026-09-20 as not applicable, with evidence: the file descriptor leak affects `diskStorage` and this API configures none, and the file size bypass requires an asynchronous `fileFilter` and no route configures one. Two remain. One of them, GHSA-535w-7cp7-47q4, was reproduced against the installed `multer` 2.2.0 and pegs a CPU core past forty seconds with the event loop unable to serve anything else. Tightening `multer`'s own `limits` does not mitigate it; the advisory saying there is no workaround is accurate. What contains it is that the only multipart route in the API sits behind the better auth guard, and NestJS runs guards before interceptors, so an unauthenticated request is rejected before `multer` parses the body.

`@nestjs/platform-express` pins `multer` to an exact `2.2.0` across the whole 11.x line. Only NestJS 12 moves to 2.4.0. An npm `overrides` entry would also work, but npm only applies overrides during a full dependency re resolve, and a full re resolve of this repository currently fails outright: four independent faults stack, none of them about NestJS (see task 3 in [index.md](index.md) for the measured detail). `expo` looked like the cause and is not: it is an optional peer of `@react-three/fiber` that appears only while npm thrashes to satisfy a React peer that fiber itself caps at `<19.3`. The committed lockfile omits `expo` entirely and is correct; only a clean resolve fails. That means the lockfile cannot currently be regenerated from scratch, which is a latent single point of failure independent of anything to do with NestJS.

Separately, NestJS 11 will stop receiving fixes as the 12 line matures, and more of the ecosystem is publishing ESM only. better auth already forced this repository onto Node 22 for exactly that reason, which is recorded in the root `AGENTS.md` as a hard requirement.

The decisive force is none of the above. This repository is a personal educational project, and keeping up with the latest framework releases is an explicit goal rather than a chore to be deferred. Working through the breakage a major version causes, and filing issues upstream when the breakage is the framework's rather than ours, is part of what the project is for. Stability is deliberately not the top priority here. That inverts the usual reasoning: the question is not whether the advisories justify a migration, it is whether there is a good reason to delay one, and there is not. The advisories are the occasion rather than the argument.

## Options considered

### Option 1: Do nothing, leave both alerts open and documented

Keep NestJS 11 and CommonJS. The reasoning for why the two advisories are contained is already written into `apps/api/AGENTS.md`, including the constraint that adding an anonymous multipart route would turn a contained problem into a remote unauthenticated denial of service.

**Pros**:
- Zero risk and zero work. Nothing deploys, nothing can break.
- The analysis is already captured, so a future reader does not repeat it.
- Honest about the real risk level: an admin only denial of service on a portfolio site.

**Cons**:
- The repository's security page keeps showing two open high severity alerts, which is a poor look on a public portfolio repository whose purpose is partly to demonstrate engineering judgement.
- The NestJS 11 line ages. The migration still has to happen eventually and gets harder the longer the gap grows.
- Does nothing about the broken clean resolve, which is a real latent problem.

### Option 2: Fix the resolve and override multer, stay on NestJS 11

Fix the `expo` optional peer chain so a clean install works again, then add an npm `overrides` entry forcing `multer` to 2.4.0. `multer` 2.2.0 to 2.4.0 is a minor bump, and NestJS 12's own `platform-express` uses 2.4.0, so the API surface NestJS relies on is compatible.

**Pros**:
- Achieves the stated goal, closing both alerts, at a tiny fraction of the cost.
- Also fixes the broken clean resolve, which is the more serious latent problem of the two.
- Small, reviewable diff. One dependency version and one resolution fix.
- Leaves the framework migration to be done deliberately later rather than under the pressure of an advisory.

**Cons**:
- Avoids the work that is the actual point of this project. Keeping up with the latest framework is an explicit goal, and this option is a way of not doing that while appearing to resolve the issue.
- Leaves `apps/api` on NestJS 11 and CommonJS, so the ecosystem pressure keeps building and the migration still has to happen, later and larger.
- An `overrides` entry is a maintenance surface. It silently pins a transitive package and someone must remember why.
- Depends on `multer` 2.4.0 being compatible with `platform-express` 11's usage, which is very likely but unverified here.

### Option 3: Upgrade to NestJS 12 but keep CommonJS output

Node 22.12 and later can `require()` an ESM module graph, and this machine reports `process.features.require_module` as `true`. So the built CommonJS output might load NestJS 12 without any module system change, provided the NestJS ESM graph has no top level await. Jest would still fail, because it uses its own module registry rather than Node's, so the test runner would still have to move.

**Pros**:
- Much smaller blast radius than a full ESM migration. No change to the build output, the seven scripts, or the three spec files using `__dirname`.
- Keeps spec 0001's CommonJS decision intact rather than reversing it.
- Still gets `multer` 2.4.0 and a supported NestJS line.

**Cons**:
- Depends on an implementation detail (no top level await anywhere in the NestJS 12 graph) that can change in a patch release and would break the build with no warning.
- Leaves the application in a mixed state: an ESM framework loaded by CommonJS application code, which is harder to reason about than either pure form.
- Postpones the ESM migration without removing the need for it.

### Option 4: Upgrade to NestJS 12, move apps/api to ESM, move its tests to Vitest

Convert `apps/api` to a full ESM package, replace Jest with Vitest, drop `@nestjs/config`, and fix the resolution failure. TypeScript 6 lands first in its own pull request to unblock `@nestjs/schematics` 12.

**Pros**:
- It is the option that actually does the thing this project exists to do: take the current major version and work through what it breaks.
- Ends the module format question permanently rather than deferring it. The next ESM only dependency is a non event.
- The breakage surface is the educational payload. An ESM migration, a test runner migration, and a framework major in one codebase is a genuinely instructive piece of work, and anything that turns out to be the framework's bug rather than ours becomes an upstream issue.
- Converges the repository on one test runner, since `apps/web` already uses Vitest.
- Gets `multer` 2.4.0 through the supported path rather than through an override that has to be maintained and explained.
- Fixes the broken clean resolve as a prerequisite, so that problem is solved either way.
- Production source turned out to be almost ESM clean already, which makes the runtime part of this cheaper than expected.

**Cons**:
- By far the most expensive option, and out of proportion to the stated trigger.
- Reverses a deliberate decision from spec 0001 without that reversal being the thing anyone set out to do.
- The Jest to Vitest conversion carries the subtlest risk in the whole plan: mock hoisting differs, so a converted test can pass while mocking nothing.
- Drags TypeScript 6 across 380 source files in four workspaces for the benefit of one development only dependency.
- Puts every AI surface at risk in one deploy, since they share a single Render service.

### Option 5: Upgrade to NestJS 12 and bundle apps/api to ESM instead of converting it

Keep the source as it is and change the build instead: replace `nest build --builder swc` with a bundler (tsup or esbuild) that emits a single ESM output. The bundler resolves every relative specifier and every workspace import at build time, so the 253 extensionless imports never need editing and the `@portfolio/shared` CommonJS boundary is resolved during the build rather than at runtime.

**Pros**:
- Avoids the largest single work item in Option 4 (253 edits across 109 files) and the subtlest one (the shared package export detection) in one move.
- A bundled output has no runtime module resolution left to get wrong, which removes the entire class of failure where typecheck passes and boot fails.
- Smaller, more reviewable diff for the same end state.

**Cons**:
- NestJS relies on decorator metadata, and bundlers have historically needed care to preserve `emitDecoratorMetadata` correctly. Getting this wrong fails at runtime in dependency injection, not at build time.
- Drops Nest's own builder, so the project takes on bundler configuration it does not currently have, against a build that deliberately has no bundling step.
- Source maps and stack traces from a bundle are worse, which matters when the point of the exercise is working through breakage.
- It converts the build rather than the codebase, so the source keeps its CommonJS shaped imports and the module format question is only answered at the boundary.

## Rationale

Option 4 is chosen because it is the only option that serves the project's actual goal. This is a personal educational repository where keeping current with framework releases is the objective, not a maintenance tax, and stability is explicitly not the top priority. Option 2 is cheaper and would close both advisories, which is exactly why it is the wrong answer here: it routes around the work rather than doing it. Option 1 does even less. The usual reasoning, where a migration must earn its cost against a business risk, does not apply to a repository whose purpose is the learning.

The supporting forces still point the same way. better auth already forced this repository onto Node 22, and that fact is recorded in the root `AGENTS.md` as a hard requirement discovered the hard way. NestJS 12 is the second ESM only dependency to arrive in the same service inside a year, so the module format question is going to be settled sooner or later regardless.

Two measurements made the decision materially safer than it looked at the start. Production source in `apps/api` has zero `require(`, zero `module.exports`, and no `__dirname` outside spec files, so the runtime conversion is small. More importantly the three agent prompt loaders resolve their markdown paths through `process.cwd()` rather than `__dirname`, so the part of this system most likely to break silently under ESM, loading the AI prompts from disk on Render, does not change at all.

Option 3 was rejected despite being the cheapest route to NestJS 12, for two reasons that now point the same way. It rests on the NestJS 12 ESM graph containing no top level await, which is true today and is not a guarantee anyone has made, so a patch release could break the boot with no warning. And it is a half measure: it takes the version bump while ducking the module migration, which leaves the codebase in a mixed state and skips the part with the most to learn from.

Option 5, bundling rather than converting, was raised by the cross check after the decision was made and is the strongest alternative on the list. It is rejected for the same reason Option 3 is: it reaches the destination while skipping the journey. Bundling resolves the module format question at the build boundary and leaves the source in its CommonJS shaped form, so the codebase never actually becomes an ESM codebase. In a repository whose purpose is learning, converting 253 specifiers and resolving a real CommonJS to ESM package boundary is the content, not the overhead. It is worth revisiting if step 4 or step 8 turns out to be genuinely intractable rather than merely tedious.

On sequencing, the engineer initially chose a single pull request, then split TypeScript 6 out when it entered scope. That split is the right call and the reasoning generalises: TypeScript 6 touches four workspaces that have no opinion about NestJS, so bundling it would mean a red build with two unrelated families of cause. Attribution is worth protecting even when stability is not, because an unattributable failure teaches nothing. The remaining work stays in one pull request at the engineer's preference. Step 9, the Render branch deploy, stays in the plan for a narrower reason than usual: not to protect the deploy generally, but because `apps/api` serves the live portfolio site while a job search is active, and because `apps/api/AGENTS.md` already records that a clean install on Render is not implied by one working locally, which was learned from sharp's native binaries.

`@nestjs/config` is dropped rather than upgraded because nothing injects `ConfigService` anywhere in the codebase. Its only job here is loading `.env`, which `lib/prisma.ts` already does through `dotenv/config`, and validation now lives in `env.config.ts`. Upgrading it would mean inheriting a reversed configuration precedence, where internal configuration overrides `process.env`, and that interacts directly with the environment variable caps that shipped in commit `bc35261`. Removing an unused dependency is strictly better than carrying a breaking change for it.

## Evidence

Measured during the session on 2026-09-20, against commit `847f3f6`.

**NestJS 12 is ESM only.** `@nestjs/common@12.0.3` and `@nestjs/core@12.0.3` both declare `"type": "module"`. NestJS 11.1.28 declares no `type` field, so it is CommonJS. Installing NestJS 12 and running the suite as it stood then produced 831 passing tests but 20 of 49 suites failing to load, each with:

```
apps/api/node_modules/@nestjs/common/index.js:7
import 'reflect-metadata';
^^^^^^
SyntaxError: Cannot use import statement outside a module
```

Typecheck passed cleanly in the same state, which is why a green typecheck is not evidence here.

**Node can require ESM.** Node 22.22.3 reports `process.features.require_module` as `true`. This is what makes Option 3 possible in principle.

**The duplicate instance hazard.** After installing NestJS 12, `apps/api` resolved `@nestjs/core` 12.0.3 from its own nested `node_modules`, while a stale 11.1.28 stayed hoisted at the repository root. `@nestjs/throttler` is hoisted at the root and resolved the root copy, so the throttle guards would have been built against NestJS 11 while the application ran on 12. The lockfile recorded this arrangement, so `npm ci` on Render would reproduce it. Root `multer` also stayed at 2.2.0, meaning the alerts would not have closed. Throttler is not incidental: it guards routes in Beta, feedback, Grade Guesser, and conversation through per route guards.

**The clean resolve failure.** `rm -rf node_modules package-lock.json && npm install` fails with ERESOLVE in the `@react-three/fiber` to `expo` to `react` chain. `npm ls expo` reports empty, so the committed lockfile omits it correctly; only a fresh resolve tries to install it. Regenerating the lockfile with `--legacy-peer-deps` succeeds and does apply the `multer` override, but changes 517 package entries: 129 added, 55 removed, 333 version changes, including the Anthropic SDK 0.118 to 0.127 and the whole AWS SDK family.

**The reproduced advisory.** GHSA-535w-7cp7-47q4 was reproduced against `multer` 2.2.0 configured exactly as `grade-photos.controller.ts` configures it, using the field names `items[4294967294]` and `items[x]`. The process held 99% of a CPU core for the full 40 second timeout with the event loop blocked. Adding `fields`, `fieldNameSize`, and `parts` limits did not mitigate it, because the attack needs only two short field names. Against a NestJS application with a denying global guard and the same `FileInterceptor`, the identical payload returned 403 in 18ms, which is the measured proof that guards run before interceptors and that the advisory is contained by authentication here.

**Migration surface counts.** In `apps/api/src`, excluding generated Prisma output: 48 source files import from `@nestjs/*`, 14 spec files do, and there are 19 `jest.mock()` call sites across 15 files. Zero `require(` and zero `module.exports` in production source. Three `__dirname` uses, all in spec files. Seven files in `apps/api/scripts` use `__dirname` or `require(`.

## References

**Project sources** (verifiable, in this repo):
- Spec [0001](../0001-backend-ai-stack/index.md), which chose NestJS and deliberately kept CommonJS, and cited CommonJS when rejecting Arcjet.
- `apps/api/AGENTS.md`, the multer triage entry and the ERESOLVE entry, both added 2026-09-20, and the note that a clean install on Render is not implied by one working locally.
- Root `AGENTS.md`, the Node 22 hard requirement and the rule that this repository is public so every push is publication.
- Commit `bc35261`, which added `env.config.ts` and boot time environment validation, and is the reason `@nestjs/config` can be dropped rather than upgraded.
- Spec [0004](../0004-beta-climbing-rehab-planner/index.md) AC-6 and spec [0005](../0005-aws-genai-integration/index.md) AC-I7, the invariants the migration must not disturb.

**Practices & standards**:
- Strangler style phasing for live systems: change one thing per step and keep the system running at each one.
- Prove dependency identity rather than dependency version, since a duplicate copy passes both typecheck and unit tests.
- Verify a deploy on the target platform before the shared environment, when the local architecture differs from the target.

**Links** (web verified during this session's research):
- NestJS migration guide: https://docs.nestjs.com/migration-guide
- NestJS v12.0.0 release notes: https://github.com/nestjs/nest/releases/tag/v12.0.0
- NestJS swc recipe: https://docs.nestjs.com/recipes/swc
- `@nestjs/config` releases, for the 4 to 12 breaking changes: https://github.com/nestjs/config/releases
- `@nestjs/throttler` releases, which added NestJS 12 support in 6.6.0: https://github.com/nestjs/throttler/releases
- `@thallesp/nestjs-better-auth` releases, which added NestJS 12 support in 2.8.0: https://github.com/ThallesP/nestjs-better-auth/releases
- GHSA-535w-7cp7-47q4, the reproduced advisory: https://github.com/advisories/GHSA-535w-7cp7-47q4
- GHSA-wc9g-mqfw-jrwm, the second open advisory: https://github.com/advisories/GHSA-wc9g-mqfw-jrwm

Note on source quality: the Node version floor, the multer pin, and the package support ranges were confirmed from official NestJS sources and from the npm registry directly. Some finer details of the v12 release, such as the lifecycle hook ordering change, were only found on a secondary source (a Trilon blog post) and should be treated as unconfirmed until checked against the release notes during the build.
