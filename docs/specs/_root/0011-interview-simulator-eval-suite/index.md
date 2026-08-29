# 0011. Interview simulator eval suite

**Date**: 2026-08-29
**Status**: Accepted

## Summary

This adds an offline eval suite (a scored test bench that calls the real model) for the interview simulator, the `/conversation` surface. A hand curated golden dataset of about 20 cases runs through the same production code path that generates a turn pair, and each result is scored on three dimensions: honesty about ownership, grounding in the real story, and persona quality. Scores land in a committed scoreboard so every prompt or model change can be compared against a baseline. It never blocks CI; it reports.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As Tony, I want a repeatable scored run of the interview simulator so that I can change prompts or models with evidence instead of vibes.
- As Tony, I want the honesty guarantees (never overclaim credit) measured continuously so that a regression in the prompts or the model shows up as a score drop, not a surprise on the live site.
- As a hiring manager reading the repo, I want to see a real eval discipline (golden dataset, scorers, baseline history) so that the portfolio demonstrates professional AI engineering practice.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `npm run eval:interview --workspace=apps/api -- --cases N` runs the golden dataset (capped at N when given) through the production `generateTurnPair` path in `conversation.service.ts` (real model calls, persistence mocked, no HTTP server, no database) and writes a results JSON file plus a regenerated scoreboard markdown. The script runs with `tsx`, loads `.env` the way `beta-guard-corpus.ts` does, and exits 1 before any model call if no API key is present (except CI skip mode, AC-8).
- **AC-2**: The golden dataset holds about 20 hand curated cases. Each case has: id, topic slug, story title (stories have no stable id; the pair of topic slug and story title keys into the extracted seed fixtures), prior history, isFinal flag, difficulty (`simple` | `medium` | `hard` | `edge`), category, `expectedCharacteristics` (properties the output should have, not a fixed expected output), and an optional `injectQuestion` override. At least 3 cases are `edge` tier crafted to bait overclaims. Because case history reaches only the interviewer prompt (Tony never sees it), bait cases either work indirectly through the generated question or pin the question with `injectQuestion`; each bait case states which.
- **AC-3**: Honesty scoring is two layered. Layer one is code based: the existing `evaluateTonyResponse` from `ownership-guard.ts` runs on the raw Tony output; a guard failure scores 0 and a guard pass scores 1.0. Layer two is an LLM judge pass for overclaims the phrase list misses. The case's honesty score is the minimum of the two layers.
- **AC-4**: A grounding judge scores each Tony turn against the case's story summary (no invented facts, projects, numbers, or dates) on a discrete scale of 0, 0.5, or 1 with written rubric anchors, using `claude-haiku-4-5` at temperature 0 through an eval only Anthropic SDK client (the production provider seam has no temperature parameter and is not changed), with the verdict returned through a forced tool call.
- **AC-5**: A persona judge scores on the same judge settings and scale: the Tony turn reads as a candid first person interview answer of sensible length with no AI mannerisms, and the interviewer turn asks one clear relevant question.
- **AC-6**: The results JSON records, per case, each dimension's score, the judge's one line reason, the generated interviewer question, and the raw generated turns; and per run: the date, git commit (with dirty flag), the resolved provider and generator model actually used, judge model, case count, a hash of the dataset (case list plus the referenced fixture fields), token totals, and estimated cost (null for any model missing from the price table). The scoreboard shows aggregate scores per dimension (unweighted mean, 2 decimals), a per difficulty breakdown, and the delta against the committed baseline, marked not comparable when the dataset hash differs.
- **AC-7**: A run is bounded: `--cases N` caps case count, `--concurrency` (default 2) bounds parallel cases, judge calls carry a 30 second timeout, and `--max-cost` (default 2 USD) aborts the run when the running estimate exceeds it. A case whose generation stream emits `turn_error` is retried once, then marked `generation_error`. A judge call that errors twice, times out, or returns an unparseable verdict marks that dimension `judge_error`; the dimension is excluded from that dimension's aggregate, the rest of the case still counts, and all errored cases are listed in the report.
- **AC-8**: A `.github/workflows/evals.yml` job runs on `workflow_dispatch`, and on same repo pull requests that touch the conversation module, its prompts, the ownership guard, the extracted fixtures, or the eval files. It sets the dummy `DATABASE_URL` (postinstall prisma generate needs it), pins `AI_PROVIDER=anthropic`, caps PR triggered runs (`--cases 8`; dispatch runs the full set), uses the `ANTHROPIC_API_KEY` repository secret, writes the scoreboard into the job summary, uploads the results JSON as an artifact, and never fails the build because of scores. Fork pull requests are excluded by a same repo guard, and when the key is absent the runner exits 0 with a skipped notice in the summary.
- **AC-9**: The committed baseline changes only by a deliberate local run followed by a commit of the updated baseline file. CI never commits or pushes anything. The initial baseline is established from two identical full runs; the observed per dimension spread is published in the scoreboard as the noise band, and any later delta within the band is marked not significant.
- **AC-10**: Nothing in the dataset, results, or logs contains visitor derived content. Every case is authored in the repo; generated model text in results is fine.

## Decision

**Chosen option**: Option 1: Hand rolled TypeScript harness in the repo

A standalone script suite under `apps/api` calls the production turn generation code with mocked persistence and real model calls, scores the output with one reused code guard and two LLM judge rubrics on `claude-haiku-4-5`, and writes committed JSON plus a markdown scoreboard. It runs on demand and on prompt touching pull requests, report only.

**Implementation skills**: `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`) · `github-actions-templates` (`wshobson/agents`, `.claude/skills/github-actions-templates/`) · `github-actions-hardening` (`wshobson/agents`, `.claude/skills/github-actions-hardening/`)

## Feature design

**Data model sketch** (files, no database tables; evals deliberately never touch the Prisma schema):
- `apps/api/prisma/fixtures.ts` (new): the topic and story seed arrays, extracted from `seed.ts` as exported consts with no import side effects (`seed.ts` currently keeps them private and imports the Prisma client and better-auth at module load). `seed.ts` imports the arrays from here.
- `apps/api/scripts/interview-eval/golden.ts`: the dataset, typed `EvalCase[]`. Fields per AC-2. Cases key into the fixtures by topic slug plus story title; the harness synthesizes full `StoryModel`/`TopicModel` shapes from the fixture data with deterministic fake ids (`eval-story-<n>`).
- `apps/api/scripts/interview-eval/run.ts`: the CLI entry (flag parsing, env loading, orchestration). Thin; all testable logic lives in the module below.
- `apps/api/src/modules/conversation/eval/` (new): the pure eval logic with colocated `.spec.ts` (Jest's rootDir is `src`, so specs under `scripts/` would never run): scorer aggregation, baseline delta and noise band math, dataset hashing, scoreboard rendering, the price table (`Record<modelId, {inputPer1M, outputPer1M}>` in USD with a dated comment).
- `apps/api/scripts/interview-eval/scorers/`: `honesty.ts`, `grounding.ts`, `persona.ts`, plus `judge-client.ts`, an eval only `@anthropic-ai/sdk` client (temperature 0, forced tool call, 30s timeout, one retry).
- `docs/evals/interview/baseline.json`: the accepted baseline run (committed).
- `docs/evals/interview/results/<YYYY-MM-DD>-<7 char sha>[-dirty][-N].json`: run outputs, UTC date, `-dirty` when the tree was dirty, `-N` counter on filename collision.
- `docs/evals/interview/scoreboard.md`: a pure projection regenerated from `results/` plus `baseline.json`, never hand edited.

**State transitions**: none. Each run is stateless; the only durable state is the committed baseline and results files.

**What is and is not under test**: the harness hand builds a `PreparedTurn` (synthetic conversationId, turnIndex from the case, fixed interviewerTurnId) and passes the case's chosen story directly, so `prepareTurn` and the production story selection (`groundingStory`) are deliberately out of scope; the suite evaluates generation and guarding, not selection. The interviewer question is generated fresh each run (variance the noise band absorbs) unless the case pins it with `injectQuestion`; the generated question is always recorded in results.

**API surface** (no HTTP endpoints; the surface is commands):
| Command | Inputs | Outputs | Auth | Key errors |
|---|---|---|---|---|
| `npm run eval:interview --workspace=apps/api -- [flags]` | `--cases N`, `--concurrency N` (default 2), `--max-cost USD` (default 2), `--out <dir>` | results JSON, scoreboard.md | `ANTHROPIC_API_KEY` env | missing key exits 1 before any call (CI skip mode exits 0); `--max-cost` exceeded aborts with partial results marked aborted |
| `evals.yml` workflow | `workflow_dispatch` (full set) or same repo PR path filter (`--cases 8`) | job summary, artifact | repo secret | score drops never fail the job; missing key skips green |

**Value sourcing** (every value the run produces names its source):
| Action | Value produced / displayed | Source |
|---|---|---|
| run a case | topic, story content, requiredFraming | `apps/api/prisma/fixtures.ts` via the case's topic slug plus story title; synthesized into model shapes with deterministic fake ids |
| run a case | `PreparedTurn` fields (conversationId, turnIndex, interviewerTurnId) | synthetic constants plus the case's turnIndex and isFinal |
| run a case | interviewer and Tony turns | `generateTurnPair` with the real generation path, an emit collector capturing SSE events, and persistence stubbed: `conversationTurn.create` returns `{id}`, `.update` and `.delete` resolve, `$transaction` resolves its array, daily usage increment resolves (stubs cast to the service types, the `beta-guard-corpus.ts` precedent) |
| run a case | generator provider and model | the harness pins `AI_PROVIDER=anthropic` and records the resolved provider and model from the service config; it refuses to run under a bedrock configuration without an explicit `--provider` flag |
| honesty layer 1 | guard verdict and reason | `evaluateTonyResponse(tonyText, story)` from `ownership-guard.ts`, unchanged; pass maps to 1.0 |
| honesty layer 2, grounding, persona | discrete score (0, 0.5, 1) plus one line reason | `judge-client.ts` on `claude-haiku-4-5`, temperature 0, forced tool call whose input schema is the verdict shape; rubric anchor text lives in each scorer file |
| write results | git commit sha, dirty flag | `git rev-parse` and `git status --porcelain` at run time |
| write results | dataset hash | hash of the serialized case list plus the referenced fixture fields, computed in the eval module |
| write results | token totals and estimated cost | `inputTokens`/`outputTokens` on each response, summed; priced by the eval module's table; `costUsd: null` when a model id is missing from it |
| scoreboard | aggregates, delta, noise band, significance | computed by the eval module from `results/` and `baseline.json`; delta marked not comparable on dataset hash mismatch, not significant when within the noise band |
| CI | API key | `ANTHROPIC_API_KEY` GitHub Actions repository secret (new); unavailable to fork PRs by design |

**Key invariants**:
- The harness calls the same `generateTurnPair` the controller calls. No parallel reimplementation of prompt assembly; if the service refactors, the harness breaks loudly rather than silently measuring the wrong thing.
- The production provider seam is not modified for evals; judge calls live entirely in eval only code.
- Judges never see `expectedCharacteristics` phrased as the answer key for generation; the generator sees only what production sends it.
- Report only: no score, however bad, fails CI (AC-8). The deterministic guard still protects production at runtime independently of this suite.
- Baseline moves only by human commit (AC-9); the scoreboard is a pure projection, never hand edited.
- No visitor derived content anywhere in the suite (AC-10).

**Security model**: no user facing surface. The API key in CI is a repository secret exposed only to the eval workflow, which runs on `pull_request` (never `pull_request_target`), carries `permissions: contents: read`, excludes fork PRs by a same repo guard, and SHA pins third party actions (per the github-actions-hardening skill). Dataset and results are public repo content authored by Tony.

**Configuration required**:
- `ANTHROPIC_API_KEY`: already used locally by the api; newly added as a GitHub Actions repository secret for the eval workflow.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: full run over the dataset produces results JSON and scoreboard with three scored dimensions per case, verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**.
- Failure case: a judge times out twice on one dimension of one case; the run completes, that dimension is `judge_error` and excluded from its aggregate, the case's other dimensions count, the report lists it, verifies **AC-7**.
- Guard case: an `edge` tier bait case (question pinned by `injectQuestion`) whose generated answer contains "I built" with no hedge scores 0 honesty regardless of judge opinion, verifies **AC-2**, **AC-3**.
- CI case: a same repo PR touching `tony-persona.ts` triggers a capped run that ends green with the scoreboard in the job summary; a fork PR does not run the job, verifies **AC-8**.
- Unit level (Jest, fully mocked per repo convention): aggregation, delta and noise band math, dataset hashing, and scoreboard rendering covered by colocated `.spec.ts` in `src/modules/conversation/eval/`.

## Build plan

Build approach: no project approach is recorded yet (AGENTS.md says TBD), so this follows the noted default of Tracer Bullet, a thin end to end thread first, then thickening. Each task ends with typecheck, lint, and tests green.

1. Extract the seed arrays to `apps/api/prisma/fixtures.ts` (exported, side effect free) and re import them from `seed.ts`; verify seeding still works against the dev database, satisfies the fixture source of **AC-2**.
2. Thin thread: harness skeleton that runs ONE hardcoded case through `generateTurnPair` (real model, stubbed persistence per the value sourcing table, emit collector), pins `AI_PROVIDER=anthropic`, and writes a minimal results JSON; add the `eval:interview` npm script (tsx, dotenv) with `--cases` plumbing, satisfies **AC-1**, part of **AC-7**.
3. Wire honesty layer 1 into the thread: run `evaluateTonyResponse` on the captured Tony text, pass maps to 1.0, satisfies part of **AC-3**.
4. Add `judge-client.ts` (eval only SDK client: temperature 0, forced tool call, 30s timeout, one retry, `judge_error` handling) and the grounding scorer with discrete rubric anchors, satisfies **AC-4**, part of **AC-7**.
5. Add the honesty layer 2 judge and the persona judge, plus case level `generation_error` retry handling, `--concurrency`, and `--max-cost`, satisfies rest of **AC-3**, **AC-5**, rest of **AC-7**.
6. Author the golden dataset: about 20 cases across the fixture stories, difficulty tiers and categories per AC-2, at least 3 bait edge cases with their bait mechanism stated (`injectQuestion` or indirect), satisfies **AC-2**, **AC-10**.
7. Build the eval module in `src/modules/conversation/eval/` (aggregation, dataset hash, delta and noise band, scoreboard rendering, price table) with colocated Jest specs; wire run.ts to it for full reporting, satisfies **AC-6**, test coverage of **AC-6** and **AC-7**.
8. Establish the baseline: two identical full local runs, record the spread as the noise band, commit `baseline.json` and the first scoreboard, satisfies **AC-9**.
9. CI: add `.github/workflows/evals.yml` (workflow_dispatch plus same repo PR path filter, dummy DATABASE_URL, pinned AI_PROVIDER, PR case cap, skip green without key, job summary, artifact upload, contents read only, SHA pinned actions); Tony adds the `ANTHROPIC_API_KEY` repository secret manually, satisfies **AC-8**.

## Consequences

**Positive**:
- Prompt and model changes to the interview simulator become measurable; the Bedrock vs direct model question can be answered with data by pointing the harness at the other provider locally (the explicit `--provider` flag).
- The ownership guard gets an adversarial test bed (bait cases) it never had.
- The committed scoreboard, with an honest noise band, is a visible artifact of eval discipline for anyone reading the repo.

**Negative / tradeoffs**:
- Each full run costs real money (bounded by `--max-cost`, default 2 USD) and a few minutes; the discipline only pays if runs actually happen on prompt changes.
- Judge scores are model opinions: they drift when the judge model updates, and only deltas outside the published noise band mean anything. The deterministic honesty layer is the only hard signal.
- A hand rolled harness means no dashboard or trace UI; history lives in committed files.
- The harness couples to `generateTurnPair`'s signature and stub surface; service refactors must update the harness (deliberate, see invariants).
- Story selection (`prepareTurn`/`groundingStory`) is not evaluated; a selection bug would not show up here.

**Neutral**:
- The dataset and scoreboard live in the public repo; that is the point, but it also documents the surface's weak spots publicly.
- A future public site page visualizing score history reads `docs/evals/interview/` at build time; nothing here blocks or requires it.
- Extracting `fixtures.ts` slightly touches the seeding path (import moves only, no behavior change).

## Follow-up

- [ ] The Tony and interviewer prompts are hardcoded in `tony-persona.ts`, while root AGENTS.md says agent prompts live as markdown skill files beside their module. Decide whether to migrate them (a small refactor that also makes the eval's path filter cleaner) in a separate change.
- [ ] Once a few runs exist, design the public site evals page (chosen as a later feature during this spec's interview).
- [ ] A Bedrock comparison mode (local only, AWS credentials, `--provider bedrock`, same dataset) to settle the Sonnet 4.6 vs Sonnet 5 question for the interviewer.
- [ ] The steered interview feature (guided plus free text visitor questions) and the `searchPortfolio` RAG tool are their own `/architect` runs; this suite should gain cases for them when they land.
- [ ] If judge variance proves the noise band too wide to read deltas, consider frozen question replay mode (replay recorded interviewer questions for tighter change detection) before upgrading the judge model.
