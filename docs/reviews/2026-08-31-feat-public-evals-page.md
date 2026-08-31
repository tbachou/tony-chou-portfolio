# Review, feat/public-evals-page, 2026-08-31

> **Later note (2026-08-31).** The `check-worktrees.mjs` finding below was fixed twice and the script was then deleted outright: nothing in it was repo specific, and `git branch --merged origin/main | grep '^+'` plus `git -C <path> status --porcelain --ignored=matching` answer the same question. File paths and line numbers in that finding no longer exist. The rest of this review stands as written.

**Reviewed by**: Claude Sonnet 5 (author on Claude Sonnet 5)
**Scope**: 29 files, branch vs `origin/main`
**Verdict**: Approve with nits

## Summary

This branch ships the public `/projects/interview-simulator/evals` page exactly as spec 0012 phase two describes it: a build-time loader (`apps/web/src/lib/evals.ts`) validates a hand-edited `published.json` manifest against zod, cross-checks it against the committed results/baseline files, and a statically generated page renders the result with no case-level content ever reaching the payload. The `Markdown` component correctly omits `rehype-raw` and shifts headings, with tests that actually try to inject a `<script>` and assert it doesn't execute. The `run.ts` preflight that refuses a paid run on a dirty tree is a real, well-reasoned safety net with clear commentary. Test coverage of the risky module (`evals.ts`) is genuinely strong — the suite tests refusals, not just happy paths, which is the right instinct for a module whose whole job is to fail loudly. I found no blockers: the manifest/loader logic, the delta recomputation, the dataset-hash comparability rule, and the markdown sandboxing all hold up under adversarial reading and match the spec's acceptance criteria. The issues below are a real documentation blind spot in `check-worktrees.mjs`, a coverage gap in the new financially-relevant preflight logic in `run.ts`, and a handful of minor/nit items.

## Major

### 🟠 `check-worktrees.mjs` silently under-reports a worktree holding an ignored file, `scripts/check-worktrees.mjs:83-91`

**Problem**: `dirtyFiles` comes from `git status --porcelain` with no `--ignored` flag. Git excludes ignored paths from that output by default, so a worktree containing a `.env` (or any other gitignored file) with real, non-reproducible content is reported as `dirty: 0` and classified as "residue" — the script then prints `git worktree remove <path>` as the safe next action for exactly that directory.

**Why it matters**: This script exists specifically to prevent losing uncommitted state during worktree cleanup (the 2026-08-31 incident it documents). The blind spot is squarely inside that mission: a `.env` is one of the most likely files to sit uncommitted in a worktree (API keys, DB URLs for a scratch DB, etc.), and it is gitignored by convention in this repo. A user who trusts the "safe to remove" recommendation and runs the suggested command permanently deletes it, with no output from the tool suggesting anything was there. Neither the script's own doc comment, `AGENTS.md`'s new `check:worktrees` entry, nor the writeup mentions this limitation, so nothing warns the reader who is relying on this exact tool to avoid exactly this exact class of loss.

**Suggested fix**: Pass `--ignored=matching` (or run a second `git status --porcelain --ignored` pass) and fold ignored-but-present files into the dirty count with their own marker (e.g. a `~` prefix distinct from tracked changes), or at minimum print an explicit caveat line ("ignored files such as `.env` are not checked; verify by hand before removing") so a "clean" verdict is never read as "nothing here."

## Minor

### 🟡 New preflight/dirty-classification logic in `run.ts` has no tests, `apps/api/scripts/interview-eval/run.ts:101-161`

**Problem**: `INERT_PREFIXES`, `isInert`, and the `git status --porcelain` parsing in `gitInfo()` are new, non-trivial, pure logic — exactly the kind of thing a unit test is cheap to write for — and they gate whether a run is allowed to spend real money. A wrong prefix (the file itself calls this out: "A wrong entry there means a bad run is allowed to spend money") or a parsing edge case (e.g. a renamed file's `old -> new` porcelain line, which `isInert` cannot match against any prefix and so treats as material — safe, but untested) has no regression coverage.

**Why it matters**: This is squarely a "branching logic that is security/cost relevant" case per the test-adequacy bar, and it lives in a repo that otherwise takes testing seriously. It's true that `apps/api/scripts/` has never had colocated specs (its sibling scripts — `accept-baseline.ts`, `beta-guard-corpus.ts`, etc. — are also untested CLI entries), so this isn't a new deviation from local convention, but the risk profile of this particular addition (an allowlist that can silently permit a wasted paid run) is higher than a typical thin CLI wrapper.

**Suggested fix**: Extract `isInert` (and ideally the porcelain-line parsing) into a small pure function importable from a `.spec.ts`, even if `main()` itself stays untested. Not blocking, since the module remains consistent with the file's own "thin by design" framing and the surrounding scripts folder's existing pattern.

### 🟡 `checkRecordedDelta` re-reads and re-parses `baseline.json` once per measured manifest entry, `apps/web/src/lib/evals.ts:329, 341-368`

**Problem**: `loadPublished` calls `checkRecordedDelta` inside the `for (const entry of manifest.publishedRuns)` loop, and each call independently does `readJson` + `baselineFileSchema.safeParse` + `summarise` on `baseline.json`. With one measured entry today this is free, but it's O(measured entries) redundant file reads and re-parses for a value that is loop-invariant.

**Why it matters**: Purely a maintainability/perf nit at today's scale (a handful of phases, a few KB manifest) — not a real bottleneck. Flagging because the manifest is explicitly expected to grow every phase, and the fix is small.

**Suggested fix**: Hoist the baseline read/parse above the loop and pass the parsed `RunSummary` into `checkRecordedDelta`, or memoize it.

## Nits

- ⚪ `apps/web/src/lib/evals.ts:404-406`, `isComparable(run, hash)` treats `run === null` as comparable ("neither comparable nor incomparable" per the doc comment), which is correct per spec, but the boolean-returning name reads as a plain yes/no at call sites (`page.tsx:336`). A short inline comment at the `page.tsx` call site referencing why `null` short-circuits to "no marker" would save a future reader the trip back to the doc comment.
- ⚪ `apps/web/src/app/projects/interview-simulator/evals/Markdown.tsx:108` vs `apps/web/src/app/projects/interview-simulator/evals/page.tsx:206,304`, the scroll-wrapped table's `min-w` differs between the markdown-rendered table (`32rem`) and the page's own tables (`38rem`/`42rem`). AC-14 asks for "the same horizontally scrollable wrapper," which this satisfies structurally, but the differing minimum width is a small visual inconsistency worth a glance.
- ⚪ `docs/evals/interview/published.json`, the `baselineHistory[2].detail` field is quite long (a full paragraph-by-paragraph postmortem). It renders fine through `Markdown`, but it's worth confirming this is the intended reading experience embedded mid-page rather than something that would read better as a linked writeup.

## Strengths

- `apps/web/src/lib/evals.spec.ts` is written the right way for this kind of module: nearly every test asserts a *refusal* (bad delta, missing writeup, dirty run, missing comparison facts on a measured/unmeasured entry) rather than only the happy path, which is exactly what a build-time gatekeeper needs proven.
- `Markdown.spec.tsx` doesn't just assert "no rehype-raw configured" — it renders an actual `<script>` payload and checks `window.__pwned` was never set, which is a genuine adversarial test rather than a structural one.
- The `run.ts` preflight's own doc comment explicitly narrates the exact incident (2026-08-31 re-baseline) that motivated the amended AC-15 rule, including why the earlier, stricter interpretation would have been wrong. That kind of "here's the mistake we didn't repeat" commentary is unusually good context for the next person to touch this file.
- `evals.ts`'s `aggregateDimension` is documented as deliberately identical to the eval runner's own `aggregate()`, and the mean rule it implements does in fact match (verified against `scoreboard.md`'s own honesty/grounding/persona numbers for the 22-case run).

## Test coverage

`apps/web/src/lib/evals.spec.ts` and `Markdown.spec.tsx` cover the acceptance criteria they claim to (AC-2, AC-3, AC-4, AC-6, AC-7, AC-9) with real fixtures on disk rather than mocks, including the cross-file rules (dirty results, missing writeup/spec, delta mismatch against baseline, dataset-hash comparability). The gap is entirely on the `apps/api/scripts/interview-eval/run.ts` side: the new `INERT_PREFIXES`/`isInert`/`gitInfo` preflight logic has zero coverage, noted above as Minor rather than Major only because it continues this specific folder's pre-existing untested-script convention.
