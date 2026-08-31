# 0012 child. Public evals page (phase two)

**Date**: 2026-08-30

## Summary

Phase two publishes the measurement record. A new public page at `/projects/interview-simulator/evals` renders the committed contents of `docs/evals/interview/`: the current scores with their delta and noise band verdict, the history of every published run, the history of the baseline itself and why it moved, and the narrative writeup for each phase. Everything is read from the repo at build time, so a number on the page cannot drift from the number in the record, and every number links back to the exact file it came from, pinned to the commit the page was built from. A new small file, `published.json`, names which run counts as published, so an exploratory or dirty run can never appear. This phase changes no model facing code and therefore takes no eval measurement of its own, which the spec records as a deliberate exemption rather than an omission. It does one eval run for a different reason: the accepted baseline was measured from a working tree with uncommitted changes, and the page cannot enforce a no dirty runs rule on everything except its own reference point.

## Inline rationale

> Premise note: the page argues that the discipline is real, and today the record it renders is one measured phase that moved nothing. A page whose proof is a single flat row reads thin, and the temptation will be to dress the persona bump up or wait for phase three. Both are wrong. The credible thing on this page is the method, not the movement: a committed baseline with a measured noise band, a dataset hash that makes two scores comparable or not, a re baseline recorded with its reason, and a phase writeup that says plainly that nothing moved. That is why the composition leads with why this exists and why baseline history is a first class section rather than a footnote. Build the page so it is still honest and still interesting when the next three phases also land inside the noise band.

The umbrella already decided that the measured improvement story is the deliverable and the agent is only its subject. That story currently exists only as files in `docs/evals/interview/`, which means it is reachable by someone who clones the repo and browses to the right directory. The audience is engineers who read repos, but even they arrive at a link before they arrive at a clone. Phase two is what turns the record into something linkable.

The load bearing choice is that the page reads the committed record at build time instead of restating it. A hand written page would put the numbers in two places and let them disagree, which is the exact failure the suite exists to argue against. Reading the record also means a new phase publishes itself: commit the files, push, and the deploy renders them.

The second load bearing choice is `published.json`. Sorting `results/` by filename is not good enough. There are three files for commit `0d048e0` today, two of them dirty, and the newest by name is one of the dirty ones. Publishing must be a deliberate act, and it must also carry the facts that cannot be recovered later: `baseline.json` only ever holds the current baseline, so once the suite re baselines (as it did on 2026-08-30, from 20 cases to 22), the delta and verdict a past phase was measured against are gone unless they were written down.

Course principles applied and skipped are recorded in this phase's writeup rather than here, because this phase applies none of the model facing lessons. Its discipline is a different one: publish the measurement, do not launder it.

## Requirements

**User stories**:
- As an engineer evaluating Tony, I want to open one link and see whether this agent is actually measured, so that the claim is checkable without cloning a repo.
- As an engineer who does not trust a self reported scoreboard, I want every number to link to the committed file it came from at a fixed commit, so that I can verify it myself.
- As Tony, I want publishing a phase to be a deliberate act on committed data, so that an exploratory or dirty run can never appear on a public page.
- As a reader who lands mid page, I want to know that first person text on this page was written by a model under test, so that a deliberately provoked false claim is never read as something Tony said.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: A public page exists at `/projects/interview-simulator/evals`, statically generated at build with no runtime data fetch and no dependency on the API. Its sections appear in this order: why this exists, latest scores, run history, baseline history, per phase writeups.
- **AC-2**: `docs/evals/interview/published.json` exists with the shape in Data model sketch and is validated at build by a zod schema. The build fails, loudly and with the offending path named, when the file is missing or malformed, when an entry points at a `resultsFile`, `writeupFile`, or `specPath` that does not exist, when a referenced results file has `meta.gitDirty` true, or when a recorded `delta` is checkable (its entry's `datasetHash` equals the current `baseline.json` hash) and disagrees with the delta recomputed from that baseline.
- **AC-2b**: The same validation runs as a standalone script, `npm run check:evals`, wired into CI, so a bad manifest fails a named check before a deploy is attempted. The build still refuses to render rather than degrading, but the script is what a person sees first.
- **AC-3**: The latest scores section is built from the last `measured: true` entry in `publishedRuns`, never from `scoreboard.md` and never from the newest file in `results/`. It shows the three dimension means, the delta, the noise band, and the per dimension verdict, plus the run's date, commit, generator and judge model, case count, scored case count, judge error count, and dataset hash. A dimension mean is the mean over cases whose `dimensions.<dim>.status` is `scored`; judge errors are excluded from the denominator and reported as their own count, matching how `scoreboard.md` already reports them.
- **AC-4**: A run history table renders one row per entry in `publishedRuns`. Each row's delta, noise band, and verdict are read from the entry as recorded at the time, never recomputed. A `measured: true` row whose `datasetHash` differs from the latest measured row's is visibly marked as not comparable; a `measured: false` row has no scores and no comparability marker, and shows its phase and writeup only.
- **AC-5**: A baseline history section renders from `baselineHistory` in the manifest (date, case count, reason, optional longer detail). `docs/evals/interview/README.md` no longer carries the table itself and instead points at `published.json` as the structured source and at the page as the rendered one.
- **AC-6**: Per phase writeups render from their committed markdown through `react-markdown` (pinned to major version 10) with `remark-gfm` (major version 4), so GFM tables render. Raw HTML embedded in a writeup is not rendered (no `rehype-raw`). Every heading in a writeup shifts down one level (`h1` becomes `h2`, through `h5` becomes `h6`), so the page keeps exactly one `h1` and the outline below it stays sane. A table rendered from writeup markdown gets the same horizontally scrollable wrapper as the page's own tables (AC-14).
- **AC-7**: Every published run links to its results JSON, every writeup to its markdown file, and every phase to its child spec, as GitHub blob URLs pinned to the build commit. Relative link targets inside rendered markdown are rewritten to the same pinned blob base: both anchor `href` and image `src`, in writeups and in `baselineHistory[].detail`, all resolved against `docs/evals/interview/`. The commit resolves from `VERCEL_GIT_COMMIT_SHA`, else `git rev-parse HEAD`; if neither resolves, links target `main` and the page states that they are unpinned.
- **AC-8**: A disclaimer banner sits above the content and is visible on every viewport, stating that first person text on the page was written by a language model under test and is not a claim by Tony Chou. Its wording carries the sense of the `_readMeFirst` field that every results file already contains.
- **AC-9**: Only aggregate values and run metadata reach the rendered page. No per case field (`interviewerQuestion`, `tonyRaw`, `tonyEmitted`, judge reasons, `honestyLayers`) is rendered, and none is serialized into the page payload.
- **AC-10**: A parent page exists at `/projects/interview-simulator` introducing the simulator in a few paragraphs and linking to the live simulator on the home page, to this evals page, and to specs 0011 and 0012. It is a stub by design and does not attempt a full case study.
- **AC-11**: The evals page is reachable from the home page interview section, from the parent page, and from the projects list, the last by adding an `interview-simulator` entry to `PROJECTS` in `apps/web/src/lib/projects.ts` with the evals page in its `subPages`.
- **AC-12**: Both new routes export `Metadata` with a canonical URL and have an `opengraph-image.tsx`, and both appear in `sitemap.ts`, which happens automatically once AC-11's `PROJECTS` entry exists.
- **AC-13**: This phase takes no eval measurement of its own (the clean re baseline in AC-15 is a re baseline, not a phase measurement), and that is recorded rather than silent: its PR carries the `skip-evals` label, and a short writeup `docs/evals/interview/0012-phase-two-public-evals-page.md` is committed stating that no run was made, why the phase cannot move the scores, and which course principles were applied and skipped. Its manifest entry sets `measured: false`. The umbrella's AC-1 exemption is noted in the umbrella `index.md`.
- **AC-14**: The page follows the site's terminal conventions: composed from `TerminalWindow`, bracket style text links, colors only from design tokens, nothing hardcoded. Every wide table scrolls inside its own horizontally scrollable container so the page body never scrolls sideways.
- **AC-15** (amended 2026-08-31, see below): The baseline the page publishes is **reproducible from the commit it names**. Before the page ships, `baseline.json` is replaced by a run whose recorded commit actually contains the dataset and the model facing code that produced it, and the move is recorded in the baseline history with its reason. Where a replacement run carries `meta.gitDirty` true, the baseline history must state what was uncommitted and why it cannot have changed the result, checked rather than asserted. This is a re baseline, not a phase measurement.

  _Amendment rationale._ This criterion originally required a fresh run "on a committed tree", treating `gitDirty` as the thing to fix. That was the wrong test, and following it would have cost a paid run for nothing. The flag answers "can this run be tied to a named commit?", not "are these scores right?", and the two come apart in both directions. The baseline it condemned (`0d048e0`) was genuinely broken, but not because a flag was set: the uncommitted part was the eval dataset itself, so its own commit holds 20 cases while it reports 22, and re running there reproduces something else. The run that replaced it is also flagged dirty, and is fine, because what was uncommitted (`skills-lock.json` and a spec markdown) is read by nothing the suite executes. The rule now tests reproducibility directly and requires the evidence to be written down, so a future phase re baselines on the merits instead of on a boolean.
- **AC-16**: The page is statically generated only: it exports `dynamic = 'force-static'` with no `revalidate`, and the loader is never reachable from a request time path. Every file read resolves from a single module level base path constant rather than a path assembled inline, so the read sites stay analysable.

## Options considered

**Option 1: a statically generated page over a committed publish manifest.** The page reads `docs/evals/interview/` at build, and a small hand edited `published.json` names which run is published and records the comparison facts that a later re baseline destroys. Pros: the numbers cannot drift from the record, publishing is deliberate, and a wrong number is a build failure. Cons: a new file to maintain by hand, a forgotten manifest entry is invisible to the build, and a bad edit blocks every site deploy.

**Option 2: derive everything from the files, no manifest.** Sort `results/` by `meta.date`, skip anything with `gitDirty`, and read the writeups for narrative. Pros: nothing to maintain, one source. Cons: no way to know which phase a run belongs to, and no way to recover a past run's delta and verdict once the baseline moves, which is exactly what happened on 2026-08-30. The page would either omit history or reconstruct it wrongly.

**Option 3: serve the record from the API.** A public endpoint on Render reads the files or the database and the page fetches it. Pros: the page could show a run the moment it lands, with no deploy. Cons: a network dependency, a caching story, and a public endpoint to rate limit, all for data that changes a few times a year.

**Option 4: hand write the page in JSX, as the Streamflow walkthrough was written.** Pros: no new dependency, full control of the prose, matches an existing pattern in the repo. Cons: the numbers get transcribed by a human into a second place, which is the failure the whole suite exists to argue against. A page making that argument cannot itself be a hand copy.

## Decision

**Chosen option**: Option 1: A statically generated page over a committed publish manifest

The evals page reads `docs/evals/interview/` at build time through a validated manifest that names which runs are published, renders the writeups as markdown, and links every number back to its file at the build commit.

**Implementation skills**: `react-markdown` (`mikkelkrogsholm/dev-skills`, `.agents/skills/react-markdown/`, symlinked from `.claude/skills/react-markdown`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `tailwindcss-advanced-layouts` (`josiahsiegel/claude-plugin-marketplace`, `.claude/skills/tailwindcss-advanced-layouts/`) · `tailwindcss-mobile-first` (`josiahsiegel/claude-plugin-marketplace`, `.claude/skills/tailwindcss-mobile-first/`) · `writing-for-agents` (`mattpocock/skills`, `.claude/skills/writing-for-agents/`)

## Feature design

**Data model sketch**: no database change, and no database involvement at all. The one new persisted artifact is a committed JSON file.

`docs/evals/interview/published.json`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `publishedRuns` | array | yes | one entry per phase, in ascending phase order |
| `publishedRuns[].phase` | integer | yes | unique across entries |
| `publishedRuns[].phaseTitle` | string | yes | e.g. `Context engineering pass` |
| `publishedRuns[].date` | ISO date string | yes | when the phase was published |
| `publishedRuns[].measured` | boolean | yes | false for a phase that takes no measurement |
| `publishedRuns[].resultsFile` | repo relative path | when `measured` | e.g. `results/2026-08-30-bf4c88e.json`, resolved against `docs/evals/interview/` |
| `publishedRuns[].writeupFile` | repo relative path | yes | e.g. `0012-phase-one-context-engineering.md` |
| `publishedRuns[].specPath` | repo relative path | yes | the child spec, from the repo root |
| `publishedRuns[].delta` | `{honesty, grounding, persona}` numbers | when `measured` | against the baseline in force then |
| `publishedRuns[].noiseBand` | `{honesty, grounding, persona}` numbers | when `measured` | as published then |
| `publishedRuns[].verdict` | `{honesty, grounding, persona}` enum | when `measured` | `significant` or `not-significant` |
| `baselineHistory` | array | yes | ordered oldest first |
| `baselineHistory[].date` | ISO date string | yes | |
| `baselineHistory[].cases` | integer | yes | |
| `baselineHistory[].reason` | string | yes | the one line reason |
| `baselineHistory[].detail` | markdown string | no | the longer explanation, rendered through the same markdown pipeline |

Scores are deliberately **not** stored in the manifest. They are computed by the loader from the results file, so there is nothing to transcribe and nothing to drift, and no float equality check has to be invented to compare a stored copy with a recomputed one. The mean rule is fixed by AC-3: mean over cases whose `dimensions.<dim>.status` is `scored`, judge errors excluded from the denominator and counted separately.

`delta`, `noiseBand`, and `verdict` are recorded rather than derived, because `baseline.json` holds only the current baseline and a past phase's comparison cannot be reconstructed after a re baseline. Where a recorded `delta` still can be checked (the entry's `datasetHash` matches the current baseline's), the build checks it and fails on a mismatch, comparing at four decimal places rather than by exact equality. Where it cannot, the recorded value stands on its own and the page shows it as recorded at the time.

**State transitions**: none. A manifest entry is written once, when a phase publishes, and is not revised afterwards.

**API surface**: no HTTP endpoints, no route handlers, no API dependency. The surface is a build time module, `apps/web/src/lib/evals.ts`, server only:

| Function | Inputs | Outputs | Errors |
|---|---|---|---|
| `loadPublished()` | none, reads `docs/evals/interview/published.json` | the validated manifest | throws at build on a zod failure, a missing referenced file, a dirty results file, or a checkable delta mismatch |
| `loadRun(entry)` | a published entry | the run's `meta`, the per dimension means, the scored case count and judge error count, nothing else | throws at build on a malformed results file |
| `loadWriteup(entry)` | a published entry | the raw markdown string | throws at build when the file is missing |
| `blobUrl(repoPath)` | a repo relative path | a GitHub blob URL at the resolved commit | never throws, falls back to `main` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| render latest scores | the three dimension means | computed in `loadRun` from `cases[].dimensions` in the entry's results file, over cases with `status` `scored` only |
| render latest scores | scored case count, judge error count | counted in `loadRun` from the same `status` field |
| render latest scores | delta, noise band, verdict per dimension | `entry.delta`, `entry.noiseBand`, `entry.verdict`, recorded at publish time; delta additionally checked at build against `baseline.json` when the dataset hashes match |
| render latest scores | date, commit, generator model, judge model, case count, dataset hash | `meta` in the entry's results file |
| render latest scores | which run is latest | the last `publishedRuns` entry with `measured: true` |
| run history | one row per published run | `publishedRuns` order |
| run history | the not comparable marker | `meta.datasetHash` of each row compared with the latest row's |
| run history | a phase that took no measurement | `measured: false`, rendered as a row with no scores and a short reason from its writeup title |
| baseline history | date, case count, reason, detail | `baselineHistory` entries |
| writeup section | the narrative body | the markdown at `writeupFile`, read at build |
| any provenance link | the blob base | `https://github.com/tbachou/tony-chou-portfolio/blob/<sha>/`, `<sha>` from `VERCEL_GIT_COMMIT_SHA`, else `git rev-parse HEAD`, else the literal `main` |
| a relative link or image inside rendered markdown | its absolute target | resolved against `docs/evals/interview/`, then joined to the blob base; the same rule for writeups and for `baselineHistory[].detail` |
| the current baseline | the reference every delta is measured against | `baseline.json`, replaced by the reproducible re baseline required by AC-15 |
| page metadata | canonical URL | `siteUrl` from `apps/web/src/lib/site.ts` |
| sitemap | the two new routes | the `PROJECTS` entry and its `subPages` in `apps/web/src/lib/projects.ts` |
| disclaimer banner | its wording | authored in the page, carrying the sense of `_readMeFirst` in the results files |

**Key invariants**:
- Every number on the page is either computed from a committed results file or recorded in the manifest. Nothing is computed from the live system, and nothing is typed twice.
- A run that is not named in `publishedRuns` does not appear, whatever exists in `results/`. A **published run** must be clean: the build rejects a manifest entry whose results file has `gitDirty` true, because a published row is a public claim and the cheapest way to keep it checkable is to refuse the ambiguous case outright. The **baseline** is held to the stronger and more specific rule in AC-15, reproducibility from its recorded commit, with any dirty delta enumerated and shown to be inert. The two differ on purpose: the build enforces the first mechanically, while the second needs a judgement that is recorded in the baseline history for a reader to check.
- Every value the page shows for a past run reflects what was true when that run was published, not what would be true if it were recompared against today's baseline.
- Case level content never leaves the loader. `loadRun` returns `meta` plus means only, so the model authored turns cannot reach the page payload even by accident.
- Exactly one `h1` on the page, whatever the writeups contain.

**Security model**: the page is public and read only, with no visitor input of any kind, so there is no authorization model to design. The privacy question is the one that matters: `results/*.json` contains model authored turns, including deliberately provoked false claims about a real regulated qualification. Those files are already public in a public repo, but publishing them on a portfolio page is a different act from committing them, so the page shows aggregates and metadata only (AC-9), and the disclaimer banner (AC-8) governs the model authored text that does appear inside the writeups. No visitor typed content exists anywhere in this data, which is a property of the conversation engine, not of this page. No new secrets.

**Configuration required**: none. `VERCEL_GIT_COMMIT_SHA` is set automatically by Vercel on every build and is not a secret; the loader falls back to git and then to `main` so local development and any non Vercel build still work.

**Critical test scenarios** (vitest, colocated, matching the `apps/web` convention):
- Happy path: the loader reads a fixture manifest with two entries, one measured and one not, and returns the latest measured run plus both history rows, verifies **AC-3**, **AC-4**.
- Failure case: an entry whose `datasetHash` matches the current baseline but whose recorded `delta` disagrees with the delta recomputed from it throws, naming the entry and both values; an entry whose hash does not match passes untouched, verifies **AC-2**.
- Failure case: a manifest entry pointing at a missing `writeupFile`, and one whose results file has `gitDirty` true, each throw at build, verifies **AC-2**, and the dirty rule in Key invariants.
- Edge case: a results file containing a case whose `dimensions.honesty.status` is not `scored` is excluded from that dimension's denominator and counted as a judge error, and the resulting mean matches what the eval runner reports, verifies **AC-3**.
- Edge case: a run whose `datasetHash` differs from the latest measured run is marked not comparable, and a `measured: false` row carries no scores and no marker, verifies **AC-4**.
- Edge case: `loadRun` on a real results file returns no key from the case level shape, checked by asserting the returned object's keys, verifies **AC-9**.
- Edge case: with no `VERCEL_GIT_COMMIT_SHA` and no git available, `blobUrl` returns a `main` URL and the page renders its unpinned notice, verifies **AC-7**.
- Rendering: a writeup fixture containing a GFM table, an `h1` and an `h3`, a relative link to `../../specs/...`, a relative image, and a raw `<script>` tag renders the table inside a scrollable wrapper, shifts both headings down one level, rewrites the link and the image source to pinned blob URLs, and escapes the script rather than executing it, verifies **AC-6**, **AC-7**, **AC-14**.

## Build plan

Build approach: no project approach is recorded (AGENTS.md still says TBD), so this follows the noted default of Tracer Bullet, as phase one did. Tasks 1 and 2 stand up a thin thread end to end, a validated manifest through a loader to a rendered number on a real route, before anything is thickened. Each task ends with typecheck, lint, and tests green.

0. Re baseline onto a reproducible run: accept a full set run whose recorded commit contains what it measured as the new `baseline.json`, regenerate `scoreboard.md` from it, and record the move in the baseline history with its reason and its evidence. A run that already exists and meets the bar is used as is; a new paid run is made only when none does. Do this first, because every later task reads the baseline, satisfies **AC-15**.
1. Write `published.json` with the phase one entry only, plus the zod schema, the loader, the mean rule, and the build time validation (missing files, dirty results, checkable delta mismatch), in `apps/web/src/lib/evals.ts` with colocated vitest tests, and expose the same validation as `npm run check:evals` wired into CI, satisfies **AC-2**, **AC-2b**.
2. Add the `/projects/interview-simulator/evals` route rendering only the latest scores section from the loader, forced static with no revalidate and a single module level base path, composed from `TerminalWindow` with tokenized colors and a scrollable table container, satisfies **AC-3**, **AC-9**, **AC-14**, **AC-16**, and part of **AC-1**.
3. Add the commit resolution and `blobUrl` helper and attach provenance links to the latest scores section, satisfies **AC-7**.
4. Add the run history table with the recorded delta, noise band, verdict, and the not comparable marker, satisfies **AC-4**.
5. Move the baseline history rows out of `README.md` into `baselineHistory`, point the README at the manifest and the page, and render the section, satisfies **AC-5**.
6. Add `react-markdown` (major 10) and `remark-gfm` (major 4), render the per phase writeups and the baseline detail markdown with the one level heading shift, the table scroll wrapper, relative link and image rewriting, and no raw HTML, satisfies **AC-6**, and completes **AC-7**.
7. Add the disclaimer banner and the why this exists intro, putting the five sections in their final order, satisfies **AC-8**, completes **AC-1**.
8. Add the stub parent page at `/projects/interview-simulator`, the `PROJECTS` entry with its `subPages`, and the link from the home page interview section, satisfies **AC-10**, **AC-11**.
9. Add `Metadata` with canonical URLs and an `opengraph-image.tsx` for both routes, and confirm both appear in the generated sitemap, satisfies **AC-12**.
10. Write the phase two writeup, add its `measured: false` manifest entry, note the umbrella AC-1 exemption in the umbrella `index.md`, and label the PR `skip-evals`, satisfies **AC-13**.

## Consequences

**Positive**:
- The measurement record becomes a link, which is what the umbrella has been building toward. Publishing a future phase is committing files, not editing a page.
- Scores are computed from the committed results file rather than transcribed, so the most likely wrong number cannot exist. The deltas that must be recorded by hand are checked against the baseline wherever that check is still meaningful.
- The manifest gives the record something it did not have: a durable statement of what each phase was measured against, which survives every future re baseline.
- The dirty baseline is caught and replaced. That defect predates this phase and would have kept propagating into every future delta; the page's own rule is what surfaced it.
- The simulator gains a project page and a projects list entry, closing a gap where the site's most distinctive feature was the only one with no case study route.

**Negative / tradeoffs**:
- The manifest is hand edited, so publishing a phase gains a step that can be forgotten or mistyped. The build catches a wrong number and a missing file; it cannot catch a phase that was simply never added.
- Two new dependencies enter `apps/web` for one page. They are small and stable, and they still have to be kept current.
- A build still fails when the eval record is inconsistent, which means a bad manifest edit blocks every deploy of the site, not just this page. `npm run check:evals` narrows the blast radius by failing a named CI check first, but the underlying tradeoff stands and is deliberate: the page refuses to render a hole.
- The page ships with one measured phase and no movement to show. It will look sparse until phase three, and the honest framing is the only thing carrying it until then.
- The stub parent is a deliberate half measure. It will read as thin next to the Streamflow case study, and it creates an obligation to finish it later.

**Neutral**:
- `scoreboard.md` stays exactly as it is, regenerated by the eval runner for the terminal reader. The page and the scoreboard are two projections of the same committed data, so neither can contradict the other.
- One full eval run of spend this phase, roughly 29 cents, for the clean re baseline. No scoreboard movement to report, because nothing model facing changed.
- `apps/web` tests run on vitest, not the Jest that root `AGENTS.md` names; this phase follows the workspace's actual convention.

## Follow-up

- [ ] Finish the stub parent into a real `/projects/interview-simulator` case study once phase three lands and there is more of a story to tell.
- [ ] Root `AGENTS.md` says tests are Jest, but `apps/web` runs vitest with colocated `.spec` files. Worth correcting so a build does not reach for the wrong runner.
- [ ] Consider a small check that fails CI when a new `docs/evals/interview/NNNN-*.md` writeup exists with no matching `publishedRuns` entry, which is the one drift the build time validation cannot see.
- [ ] The `react-markdown` skill installed for this phase is not yet in `apps/web/AGENTS.md`. It is area specific (it governs one module in one workspace), so it belongs in that workspace's `## Agent skills` list, not root.
- [ ] That skill also landed in `.agents/skills/react-markdown` with a symlink from `.claude/skills/`, unlike every other installed skill, which sits directly in `.claude/skills/`. Worth deciding whether to normalise the layout before committing a symlink into a public repo.
- [ ] The skill instructs the agent to fetch the react-markdown README before writing code. That is a live web fetch during `/develop`; fine, but it means the build step is not fully offline.
- [ ] Phase three should re read this page's assumptions before publishing: retrieval will add a fourth dimension or new case categories, and the manifest's fixed three dimension shape will need widening.
