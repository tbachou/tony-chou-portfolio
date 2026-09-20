# 0015. NestJS 12 and the move of apps/api to ESM

**Date**: 2026-09-20
**Status**: In Progress

## Summary

`apps/api` runs NestJS 11 and CommonJS (the older way Node loads code, using `require`). NestJS 12 is published as ESM only (the newer standard way, using `import`), so upgrading forces three changes at once: the API becomes an ESM package, the test suite moves from Jest to Vitest because Jest cannot load ESM through its own module system, and `@nestjs/config` is dropped because its own upgrade brings breaking changes we do not need.

The reason is that this is a personal educational repository where keeping up with the latest framework release is an explicit goal, and working through what a major version breaks is the point rather than a cost. Stability is deliberately not the top priority. Two open `multer` (file upload library) advisories are the occasion: NestJS 12 ships a fixed `multer`, so the upgrade closes them as a side effect. Both are denial of service (crashing or hanging the server) and both need a signed in admin, so they are not what is driving this.

TypeScript moves from 5.7 to 6 first, in its own pull request, because `@nestjs/schematics` 12 requires it and the upgrade touches all four workspaces. Everything else lands as one pull request.

## Requirements

**User stories**:
- As the maintainer, I want `apps/api` on a supported NestJS line so security fixes keep arriving without a forced migration under pressure.
- As the maintainer, I want the two open `multer` advisories closed, so the repository's security page reflects real risk rather than a known exception.
- As the maintainer, I want the test suite to keep proving the same things after the migration, so the upgrade cannot hide a regression behind a green run.

**Acceptance criteria**:

- **AC-1**: `apps/api` runs `@nestjs/core` 12.x, and the installed tree contains exactly one copy. `npm ls @nestjs/core --all` reports no second version anywhere, including no nested copy under `@nestjs/throttler`.
- **AC-2**: the merged `package-lock.json` contains no `multer` entry below 2.4.0 at any depth, and `node_modules` holds one hoisted copy. Dependabot reads the lockfile on the default branch, so alerts 19 (GHSA-535w-7cp7-47q4) and 21 (GHSA-wc9g-mqfw-jrwm) close within 24 hours of the merge without being dismissed. If they do not, the lockfile is wrong rather than Dependabot.
- **AC-3**: `apps/api/package.json` declares `"type": "module"`, the build emits ESM, and `node --input-type=module -e "import('./apps/api/dist/main.js')"` resolves without a module resolution error. The built server boots on Node 22 on Render.
- **AC-4**: the `apps/api` suite runs on Vitest and reports a test count greater than or equal to the Jest count on the commit before the migration (1239 at commit 847f3f6), with zero skipped suites and zero skipped tests.
- **AC-5**: `@nestjs/config` is no longer a dependency, `.env` still loads in development, and `validateEnv()` still aborts boot on a malformed numeric environment variable, preserving the behaviour landed in commit `bc35261`.
- **AC-6**: `rm -rf node_modules package-lock.json && npm install` exits 0 with no ERESOLVE and without `--legacy-peer-deps`, **on npm 11 or later** (npm 10 crashes, see task 3). The lockfile diff covers the NestJS and multer sets, the React Three Fiber removal, React 19.3, and their transitive fallout. The original bound, "no package outside the NestJS, multer, and expo set", was written before the resolve was actually run and does not hold. `legacy-peer-deps` in `.npmrc` is not an acceptable outcome here: `render.yaml` runs `npm install`, not `npm ci`, so the setting would silently apply in production and disable peer checking for every future install.
- **AC-7**: every throttle guarded route still rate limits: `/beta`, `/feedback`, `/grade`, and `/conversation`. This is the observable proof that the guards bind to the same NestJS instance the application runs on.
- **AC-8**: the agent prompt markdown files still load at runtime from disk on Render, for all three loaders (conversation, Beta, Grade).
- **AC-9**: server sent event streaming still works end to end for both `/conversation/turn` and `/beta`.
- **AC-10**: TypeScript 6 lands first, in its own pull request, with all four workspaces typechecking clean and the full root suite green. Met by #103 — but note it also left the dependency tree unresolvable (fault (d) in task 3), which neither typecheck nor the suite could see, because neither re-resolves the lockfile.
- **AC-11**: CI boots the built server on linux x64 and gets a 200 from `/health`, on every pull request. Building is not running: an import cycle, late `reflect-metadata` evaluation, or an unresolvable named export all typecheck clean and fail only at boot.
- **AC-13**: no relative import specifier in `apps/api/src` or `apps/api/scripts` is extensionless. `grep -rE "from '\.[^']*'" apps/api/src apps/api/scripts | grep -v "\.js'"` returns nothing.
- **AC-14**: `madge --circular apps/api/src` reports no cycle. CommonJS tolerates import cycles by returning a partly populated module; ESM throws `ReferenceError: Cannot access 'X' before initialization` at boot instead.
- **AC-15**: a booted ESM build serves one `/beta` request whose body is validated by a `@portfolio/shared` schema, proving the shared package's named exports resolve at runtime and not only at typecheck.
- **AC-12**: `/predeploy-audit` clears with no Critical or High finding and no adversarial HIGH, and a live smoke test exercises the interview simulator, Beta, Grade Guesser, and feedback against the running ESM build.

## Decision

**Chosen option**: Option 4: Upgrade to NestJS 12, move `apps/api` to ESM, and move its tests to Vitest.

Upgrade `apps/api` to NestJS 12, convert it to a full ESM package, replace Jest with Vitest as its test runner, drop `@nestjs/config`, and fix the dependency resolution failure that currently prevents a clean install. TypeScript 6 lands first as a separate pull request.

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `~/.claude/skills/nestjs-best-practices/`) · `better-auth-best-practices` (`better-auth/skills`, `~/.claude/skills/better-auth-best-practices/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `~/.claude/skills/javascript-typescript-jest/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Migration design

**What changes, precisely:**

| Piece | From | To | Note |
|---|---|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | 11.1.28 | 12.0.3 | ESM only, which is what forces everything below |
| `@nestjs/testing` | 11.1.28 | 12.0.3 | |
| `@nestjs/schematics` | 11.x | 12.0.3 | Requires TypeScript 6, which is why that lands first |
| `@nestjs/throttler` | 6.5.0 | 6.7.0 | Peer range already allows NestJS 12 |
| `@thallesp/nestjs-better-auth` | 2.4.0 | 2.8.0 | 2.8.0 is the first release declaring NestJS 12 support |
| `@nestjs/config` | 4.0.4 | removed | Nothing injects `ConfigService` |
| `multer` (transitive) | 2.2.0 | 2.4.0 | Arrives through `@nestjs/platform-express` 12, which pins it |
| TypeScript | 5.7 | 6.x | All four workspaces, separate pull request |
| Test runner (`apps/api`) | Jest with ts-jest | Vitest | `apps/web` already runs Vitest |
| Module format (`apps/api`) | CommonJS | ESM | |

**What does not change**: Prisma, the Prisma Postgres database, Render hosting, the Anthropic SDK, the AI provider split, every route, every schema, and the rate limit values. `apps/web` was originally listed here too; task 3 changed that, and the React Three Fiber removal plus React 19.3 are now part of this spec's scope. Spec 0001 stays Accepted; only its module format line is revised by this spec.

**Known migration surface, measured rather than estimated:**

- **365 relative import specifiers across 132 files carry no file extension** (292 in `src`, 73 in `scripts`; re-measured 2026-09-20 — the earlier figure of 253 counted `src` only and was already stale). This is the largest single work item and the one most easily underestimated. `apps/api/tsconfig.json` sets `module: nodenext`, so the moment `"type": "module"` lands each one is both a TS2835 typecheck error and an unresolved specifier at runtime. swc does not rewrite extensions. The generated Prisma client already uses `.js` specifiers and is excluded from that count.
- Production source is otherwise ESM clean: zero `require(`, zero `module.exports`, and zero `__dirname` in `apps/api/src` outside spec files. That is true, but it is not sufficient on its own, and reading it as "the conversion is small" is the mistake this list exists to prevent.
- Three `__dirname` uses exist, all in spec files: `app.module.spec.ts`, `clinical-rules.spec.ts`, and `corpus-guard.spec.ts`. They become `import.meta.dirname`.
- Seven files in `apps/api/scripts` use `__dirname` or `require(` and run through `tsx`. They need the same treatment.
- The three prompt loaders resolve paths through `process.cwd()`, not `__dirname`, so they are already ESM safe. This is the piece that would have hurt most and it does not apply.
- **Three build settings decide the output format, and two are not where you would look.** There is no `.swcrc` in `apps/api`, so `nest build --builder swc` derives its options from `tsconfig.json`. And `apps/api/prisma/schema.prisma` pins `moduleFormat = "cjs"` on the `prisma-client` generator, which `postinstall` regenerates on every Render build. Leave that and the generated client stays CommonJS inside an ESM package.
- **`@portfolio/shared` is a CommonJS package that `apps/api` typechecks against as TypeScript source.** It compiles with `module: commonjs`, declares `main: dist/index.js` and `types: index.ts`, and has no `exports` map and no `type` field, while `apps/api/tsconfig.json` maps `@portfolio/shared` through `paths` to the source file. So typecheck reads TypeScript and Node resolves the CommonJS build. Under ESM, named imports of a CommonJS module depend on static export detection succeeding against tsc's re export chain. If it fails, boot throws and typecheck plus every mocked unit test still pass.
- `apps/streamflow`'s `dist/` boundary is not affected: only `apps/web` consumes it, and `apps/web` is untouched by this migration.
- Nineteen `jest.mock()` call sites across 15 files move to `vi.mock()`. Hoisting behaviour differs between the two, so each needs reading rather than a blind find and replace. Alongside them: 74 `jest.fn`, 17 `jest.spyOn`, 14 `jest.Mock` type annotations, and one each of `jest.requireMock` and `jest.requireActual`, whose Vitest equivalents are async and therefore change the shape of the call site.

**Value sourcing**: not applicable. This decision produces no user facing values; it changes how the existing code is loaded, built, and tested. No acceptance criterion above depends on a value whose source is undecided.

**Key invariants that must survive the migration:**

- No visitor typed content is ever logged, anywhere (spec 0005 AC-I7).
- Beta writes anonymous counters only (spec 0004 AC-6).
- The red flag check runs in code before any model call, and the global cap stays an atomic reserve and refund.
- `validateEnv()` runs before the NestJS application is created, and numeric environment reads stay lazy. A module scope read anywhere in the `AppModule` import graph would throw during import and suppress the aggregated report.

**Critical test scenarios:**

- Happy path: a full conversation turn streams over SSE from a booted ESM build, verifies **AC-3**, **AC-9**.
- Loading: all three prompt loaders read their markdown from disk on Render, verifies **AC-8**.
- Dependency identity: `npm ls @nestjs/core --all` and `npm ls multer --all` each report one version, verifies **AC-1**, **AC-2**.
- Rate limiting: a throttle guarded route returns 429 after its configured limit, verifies **AC-7**. This is the scenario that catches two NestJS copies, which unit tests with mocks cannot see.
- Configuration: a malformed `DAILY_TOKEN_CAP` still aborts boot with the variable named, verifies **AC-5**.
- Clean install: `rm -rf node_modules package-lock.json && npm install` succeeds, verifies **AC-6**.

## Build plan

Ordered as a thin working thread first, per the Tracer Bullet default that specs 0002 and 0004 assumed. Each step leaves the application booting and the suite green, so a failure has one suspect. Steps 2 onward are one pull request with several small commits.

**Prerequisite pull request:**

1. Upgrade TypeScript from 5.7 to 6 across `apps/api`, `apps/web`, `apps/streamflow`, `packages/shared`, and `infra/lambda/feedback-classifier`. Typecheck and full root suite green. Satisfies **AC-10**.

**Prerequisite (done 2026-09-20, before the migration began):**

2. Add a CI step that boots the built API and waits for `/health`. No Render environment is needed: CI already runs `ubuntu-latest` on Node 22 and already builds with the same builder Render runs, so the linux x64 build risk was covered. The only gap was that nothing ever started the process. Satisfies **AC-11**.

**Migration pull request:**

3. Make a clean resolve work again. Measured 2026-09-20 by replaying the resolve against a scratch copy of the manifests; three independent faults stack, and the original diagnosis in this line was wrong on all three:
   - **(a)** `@react-three/fiber` 9.7.0 caps `react` at `>=19 <19.3`. React 19.3.0 is published, so a fresh resolve picks it and that peer fails. This is the ERESOLVE actually reported.
   - **(b)** `@react-three/drei` `^9.121.0` resolves to 9.122.0, a stale major peering on `@react-three/fiber ^8` and `react ^18`. Only visible once (a) is fixed. It had already bitten at runtime: `MeshReflectorMaterial` crashed and was worked around in `DeskScene.tsx`.
   - **(c)** `vitest` 4.1.0 and later crash npm 10's resolver outright — `TypeError: Cannot read properties of null (reading 'edgesOut')` in arborist's `#loadPeerSet`. Bisected: 4.0.18 resolves, 4.1.0 does not. Unrelated to React Three Fiber; it still crashes with that stack fully removed. npm 11 fixes it.

   - **(d)** `@thallesp/nestjs-better-auth` `^2.4.0` floors at 2.4.0, which peers on `typescript@^5.9.2`. Task 1 moved the repository to TypeScript 6, so that peer has been unsatisfiable since #103 — invisible because `npm install` against an existing lockfile never re-resolves. Fixed by raising the floor to `^2.8.0`, which allows TypeScript 6 and NestJS 12 both, pulling that part of task 10 forward because task 3 cannot complete without it.

   `expo` is a red herring. Nothing in the repository depends on it; it is an optional peer of `@react-three/fiber` and appears only while npm thrashes to satisfy (a). Once (a) is fixed the tree contains zero expo packages, and no `overrides` entry is needed.

   **Resolution**: remove the React Three Fiber stack from `apps/web` outright — `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `postprocessing`, `@types/three`, `DeskScene.tsx`, `DeskSceneProvider.tsx`, and `public/desk-scene.glb` — move React to 19.3, keep vitest current, and regenerate the lockfile on npm 11+. The scene was already opt-in behind one colophon link; keeping a third rendering stack alive to hold React back was not worth it. `legacy-peer-deps` remains unacceptable for the reason AC-6 gives. Satisfies **AC-6**.
4. Append `.js` to all 365 extensionless relative import specifiers in `apps/api/src` and `apps/api/scripts`, by codemod, **while the package is still CommonJS**. `nodenext` accepts `.js` specifiers under CommonJS, so this is a behaviour preserving change that keeps the suite green and isolates several hundred edits into their own reviewable commit. Satisfies **AC-13**.
5. Run `madge --circular apps/api/src` and break any import cycle it reports. CommonJS hides cycles; ESM throws at boot. Satisfies **AC-14**.
6. Remove `@nestjs/config` and its `ConfigModule.forRoot` registration. Confirm `.env` still loads through the existing `dotenv/config` import and that `validateEnv()` still gates boot. Satisfies **AC-5**.
7. Migrate the `apps/api` suite from Jest to Vitest while still on NestJS 11, so the runner change is proven independently of the framework change. Port the nineteen `jest.mock()` call sites; for each, assert in the test that the mocked export really is a mock, and run one deliberate falsification per file (break the real implementation and confirm the test still passes only because it is mocked). Remove the `jest` config block, `test:e2e`, `test:debug`, and the `jest`, `ts-jest`, and `@types/jest` devDependencies. Drop the Jest only `--ci` flag from `.github/workflows/ci.yml`, as `apps/web`'s line already does. Satisfies **AC-4**.
8. Give `packages/shared` an `exports` map and ESM output, and drop the `@portfolio/shared` `paths` mapping from `apps/api/tsconfig.json` so typecheck resolves through the real package entry rather than the source file. Satisfies **AC-15**.
9. Convert `apps/api` to ESM: set `"type": "module"`, flip `moduleFormat` from `"cjs"` to `"esm"` in `apps/api/prisma/schema.prisma`, keep `tsconfig` at `module`/`moduleResolution: nodenext`, and add a `.swcrc` only if the inferred emit turns out wrong. Port the three spec files and seven script files off `__dirname` and `require`. Confirm `reflect-metadata` is still evaluated before any decorated class: ESM hoists imports and evaluates dependencies before the importing module body, so the ordering CommonJS `require` gave for free is no longer guaranteed. Satisfies **AC-3**.
10. Upgrade `@nestjs/*` to 12.0.3 and `@nestjs/throttler` to 6.7.0. `@thallesp/nestjs-better-auth` was already raised to `^2.8.0` in task 3, which needed it to resolve at all. Satisfies **AC-1**.
11. Prove dependency identity: one hoisted `@nestjs/core` 12 and one hoisted `multer` 2.4.0, in both the installed tree and the lockfile. Satisfies **AC-1**, **AC-2**.
12. Prove the throttle guarded routes still rate limit on all four surfaces. Satisfies **AC-7**.
13. Verify prompt loading, SSE streaming, and one shared schema validated request against a locally booted ESM build. CI covers the linux x64 boot (step 2); these three need a running app and real requests. Satisfies **AC-8**, **AC-9**, **AC-15**.
14. Run `/predeploy-audit`, then a live smoke test of the interview simulator, Beta, Grade Guesser, and feedback against the running ESM build. Satisfies **AC-12**.

## Migration plan

**Strategy**: phased within one pull request, with TypeScript 6 as a separate prerequisite pull request.

**Phases**:
1. TypeScript 6 across all four workspaces, merged and deployed on its own.
2. Dependency resolution fix, then `@nestjs/config` removal, then Vitest, then ESM, then NestJS 12. Each is its own commit.
3. The pre deploy gate, then merge. CI's boot check runs on every push, so the linux x64 boot is proven continuously rather than once.

**Rollback**: Render keeps prior deploys, so the fast path is a manual rollback to the previous deploy rather than a revert and full rebuild. Confirm the service is configured for that before merging. A `git revert` of the merge is the fallback and costs a full rebuild of several minutes during which the API is down. Note that reverting the migration does not revert the TypeScript 6 pull request, which is deliberate: it is independent and should stay.

**Risks**:
- Import cycles are the most likely boot failure. CommonJS returns a partly populated module and carries on; ESM throws `ReferenceError: Cannot access 'X' before initialization`. NestJS module graphs produce cycles readily, and `forwardRef()` hides the Nest level cycle without removing the JavaScript level one. Step 5 exists for this, and it is the reason the cycle check runs before the module switch rather than after.
- The `@portfolio/shared` boundary fails in the worst possible way if it fails: typecheck resolves through `paths` to TypeScript source and every unit test mocks the module, so a broken named export shows up first as a boot error on Render. Step 8 and AC-15 exist for this.
- `reflect-metadata` ordering is no longer guaranteed by import position. ESM hoists imports and evaluates dependencies before the importing module body, so the ordering CommonJS gave for free can change. The symptom is `Nest can't resolve dependencies`, at boot.
- The Render environment is linux x64 and the local machine is arm64 macOS. `apps/api/AGENTS.md` records that a clean install on Render is not implied by one working locally. CI runs linux x64 and now boots the built server (step 2), which closes most of that gap. What CI still does not exercise is Render's own environment: its env vars and its `preDeployCommand`. Neither changes in this migration.
- Two copies of `@nestjs/core` in one process is the failure this migration can most easily ship by accident. Typecheck and unit tests both pass with it present. Step 8 is the scenario that catches it.
- Vitest and Jest differ in mock hoisting. A mechanically converted `jest.mock()` can pass while mocking nothing, which would leave the suite green and meaningless. Test count parity (AC-4) does not catch this on its own, so the conversion needs reading.
- A failed boot after the code swap takes the whole API down, which is every AI surface on the portfolio at once.

## Consequences

**Positive**:
- The two open `multer` advisories close without a dismissal, and the repository's security page reflects real risk.
- `apps/api` stops being pinned behind an ESM only ecosystem. better auth already forced Node 22 for this reason; the next dependency will not force a migration under pressure.
- One test runner across `apps/web` and `apps/api` instead of two, which simplifies the root test story.
- A clean install works again, which fixes a latent single point of failure: today the lockfile cannot be regenerated at all.
- `@nestjs/config` leaves the dependency list without replacement, because nothing was using it.

**Negative / tradeoffs**:
- This is a large amount of change at once: a framework major, a module system change, a test runner change, and a TypeScript major. That is accepted deliberately here, because working through the breakage is the goal, but it does mean the work is not separable if it stalls halfway.
- This reverses a deliberate decision. Spec 0001 chose to keep CommonJS, and cited it when rejecting Arcjet. Anything else previously rejected partly on CommonJS grounds may deserve a fresh look.
- Vitest and Jest are not the same tool. Eighteen mock call sites carry real behavioural risk, and mock hoisting differences can produce a green suite that proves less than the old one.
- The repository runs two test runners for the life of this work and afterwards, since `apps/streamflow` and `infra/lambda/feedback-classifier` stay on Jest.
- TypeScript 6 touches all four workspaces and 380 source files for the benefit of one development dependency (`@nestjs/schematics`), which is only used for scaffolding.
- Four surfaces go down together if the deploy fails, because they share one Render service.

**Neutral**:
- `@nestjs/schematics` could have stayed at 11 and avoided TypeScript 6 entirely. Upgrading was chosen deliberately over holding it back.
- ESM changes how paths resolve at runtime, so any future code reaching for `__dirname` will fail. The existing `process.cwd()` convention in the prompt loaders becomes the pattern to follow.
- The Vitest configuration for `apps/api` should follow `apps/web`'s, which gives the repository one config style to maintain.

## Follow-up

- [ ] Confirm the Render service is configured for manual rollback to a previous deploy before the migration merges, since the migration plan depends on it.
- [ ] `render.yaml` declares `plan: free` while `apps/api/AGENTS.md` records the service as Starter at 7 dollars a month, verified against the live service on 2026-09-01. One of the two is stale. Worth settling before step 2 creates a second service, since the plan affects what a branch service costs.
- [ ] Update `apps/api/AGENTS.md` after the migration: the multer entry recording why it stays at 2.2.0 becomes wrong the moment this lands, and the ERESOLVE entry becomes wrong when step 2 lands. `/sync` owns that file, not this spec.
- [ ] Revise spec 0001's module format line to point at this spec, so the CommonJS decision is not read as current. Its database, hosting, and AI choices are untouched and stay Accepted.
- [ ] Reconsider anything previously rejected partly because it did not support CommonJS. Arcjet is the one named in spec 0001's rationale. `needs its own spec`
- [ ] Consider whether `apps/streamflow` and `infra/lambda/feedback-classifier` should follow onto Vitest, so the repository converges on one runner. Explicitly out of scope here. `needs its own spec`
- [ ] No Vitest community skill is installed. Consider looking for one before step 4, since that step carries the most subtle risk in the plan.
- [ ] File the npm resolver crash upstream: vitest >= 4.1.0 makes npm 10's arborist throw `Cannot read properties of null (reading 'edgesOut')` in `#loadPeerSet` rather than report a conflict. Fixed in npm 11, so confirm it is already tracked before filing. The minimal reproduction is this repository's manifests at task 3, which is cheapest to capture now.
- [ ] File upstream issues for anything that turns out to be a framework bug rather than ours. Candidates already visible: `@nestjs/schematics` 12 requiring TypeScript 6 while no other NestJS 12 package declares a TypeScript peer at all, which forces a repo wide TypeScript major for a scaffolding only development dependency. Capture a minimal reproduction while the migration is fresh, since that is when the detail is cheapest to write down.
- [ ] Verify the lifecycle hook ordering change during the build. It was only found on a secondary source and not in the official release notes, so confirm it against the NestJS 12 release notes rather than trusting the summary in `rationale.md`.
