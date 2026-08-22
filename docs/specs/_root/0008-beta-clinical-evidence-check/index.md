# 0008. Beta clinical evidence check

**Date**: 2026-08-22
**Status**: Rejected, deliberately not built (2026-08-22)

> **Not built, and not pending.** A curation sweep run the same day this spec was written found that the corpus it depends on does not exist in usable form: one permissively licensed source for `finger_pulley`, none for `elbow_tendinopathy`, and three for `shoulder_impingement` that answer a different question than the one this spec checks. Fourteen build tasks to compare a handful of integers against roughly four ranges is not a system, it is a footnote. The evidence is in [rationale.md](rationale.md) under "Curation sweep". Beta was declared complete on the same date, so nothing here is waiting on anything. Read this spec as a record of why the idea was investigated and dropped, not as work outstanding.

## Summary

Beta's clinical knowledge lives as prose that Tony hand wrote in `drafter.md`, and nothing in the system connects any of it to a published source. This spec adds an offline checker that compares the numbers in a drafted plan against ranges taken from a small, licence filtered corpus of real papers and guidelines that Tony curates and reviews. It runs in the harness only: no visitor sees it, no database is involved, and no model call happens inside a verdict. One small production change comes first, turning the drafter's `timeWindow` from a sentence into two integers, so the checker never has to read model written prose. The first thread checks one thing end to end, the week the final stage begins.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:

- As the author of Beta's clinical content, I want to know which of the plan's numbers I can trace to a published source, so that "conservative" is something I can show rather than assert.
- As the author of Beta's clinical content, I want the check to stay silent when my corpus simply has nothing to say, so that a thin corpus does not look like a broken planner.
- As the maintainer, I want the check to run from a fresh clone with no credentials, so that it stays cheap to run and impossible to skip.

**Acceptance criteria** (the contract):

- **AC-1**: Claims are read only from integer fields of the validated drafter object. No claim is ever derived by parsing prose, from the coach or from the drafter.
- **AC-2**: Every `Source` carries a licence of `CC0`, `CC-BY`, or `CC-BY-SA`. Any other value, including every non commercial variant, fails the corpus check.
- **AC-3**: Every `Passage` names a `sourceId` that resolves, carries a `range` that satisfies its shape rules, and carries a non empty `citation`, `url`, and `locator`. Any failure fails the corpus check.
- **AC-4**: A claim resolves to exactly one of `supported`, `contradicted`, or `no_evidence`. `no_evidence` is recorded distinctly and is never counted as a defect in the plan.
- **AC-5**: When matched passages disagree, the check compares against the convex hull of their ranges (lowest `min`, highest `max`) and sets `conflict: true`.
- **AC-6**: Ranges are extracted at curation time and committed. The check makes no model call, so the same corpus and the same capture produce identical verdicts on every run.
- **AC-7**: A verdict, a report, and any log line contain only integers, enum values, and passage ids. No plan text, profile text, or visitor typed content appears in any of them.
- **AC-8**: The harness reads committed capture files and makes no screener, drafter, or coach model call.
- **AC-9**: A run emits a JSON report and prints a summary table.
- **AC-10**: The check passes its gate only when it reproduces the expected verdict of every gold case and produces zero contradictions that no gold case declared.
- **AC-11**: The check runs offline. No network, no credentials, and no database connection are needed to run it from a fresh clone.
- **AC-12**: Passage lookup selects candidates by `injury` and `claimType`, and by nothing else.
- **AC-13**: The first thread checks exactly one claim per plan: `finalStageStartWeek`, the week the last stage begins. Every `timeline` passage must answer that same question.
- **AC-14**: The only change to production code is `timeWindow`'s representation (AC-15). No database change, no new environment variable, no new endpoint, and no change to Beta's behaviour or timing.
- **AC-15**: The drafter schema carries `startWeek` and `endWeek` as integers, and the sentence a visitor reads ("Weeks 1-2") is rendered from them in code. Visitor visible output is byte identical to today's.
- **AC-16**: The capture format is versioned and keyed by profile id, and carries the full request DTO beside the screener and drafter results, so a multi profile run keeps every plan and the runner can revalidate through `parseDraftPlan`.
- **AC-17**: At least one capture fixture is committed, so the gate runs from a fresh clone. Live `--record` output stays gitignored.
- **AC-18**: The gold set contains at least one case expecting `supported` and at least one expecting `contradicted`, and the gate fails if either is missing or unreproduced. An empty corpus therefore cannot pass.
- **AC-19**: Exit code is 0 only when AC-10 and AC-18 both hold. A `no_evidence` verdict never affects the exit code; an unparseable or invalid claim does.
- **AC-20**: `Passage.injury` values are validated against the real injury enum, with a colocated test asserting the checker's own list equals `INJURY_AREAS`.

## Decision

**Chosen option**: Option 1: an offline evidence check over a hand curated corpus, with lookup by metadata.

Beta gains a harness only checker that compares the drafter's integers against committed, human reviewed ranges drawn from licence filtered open access sources, selected by injury and claim type rather than by vector similarity. One supporting change makes the drafter's timeline an integer pair rather than a sentence.

## Rationale

Reasoning and the options weighed: see [rationale.md](rationale.md).

## Feature design

**Production change** (the only one, AC-15): in the drafter tool schema, `timeWindow: string` becomes `startWeek: integer` and `endWeek: integer`. The display string is rendered in code, exactly as `DoseSpec` is already rendered so the coach cannot alter a dose. `parseDraftPlan` validates both as positive integers with `startWeek <= endWeek`.

**Data model** (committed files, no database, no migration):

| Entity | Key | Fields |
|---|---|---|
| `Source` | `id` (slug) | `citation` (authors, year, title, journal), `url`, `licence` (`CC0` \| `CC-BY` \| `CC-BY-SA`), `licenceVerifiedAt` (ISO date), `injuries[]` |
| `Passage` | `id` (slug) | `sourceId` (FK), `text` (max 300 characters), `locator`, `injury`, `claimType`, `range`, `rangeExtractedBy` (`<model-id>@<ISO date>`) |
| `Range` | embedded | `kind` (`weeks`), `min` (integer or null), `max` (integer or null), `qualifier` |

`Range` rules, enforced by the corpus check: `min` and `max` are non negative integers or null, never both null, and `min <= max` when both are present. `qualifier` is human facing metadata only. It is never read by lookup or comparison, and the corpus check says so, because otherwise a builder will filter on it.

Built per run and never persisted:

| Entity | Fields |
|---|---|
| `Claim` | `field` (`finalStageStartWeek`), `startWeek`, `endWeek`, `value` (the integer compared, `startWeek` in thread one), `injury` |
| `Verdict` | `verdict`, `matchedPassageIds[]`, `rangeUsed`, `conflict`, `nonMonotonic` |
| `Report` | `generatedAt`, `claims[]`, `verdicts[]`, summary counts |

**Comparison semantics** (all deterministic, no model call):

- `supported` when `min <= value <= max`, inclusive at both ends.
- `contradicted` when `value` is strictly outside that range.
- A null `min` reads as negative infinity and a null `max` as positive infinity, so an open ended range can never produce `contradicted`.
- Matching several passages takes the convex hull, lowest `min` and highest `max`. This is not a set union: a gap inside the hull is not a contradiction.
- `conflict` is true when more than one passage matched and their `(min, max)` pairs are not all equal.
- Stage windows are read as absolute weeks from the start of the plan, exactly as written, never summed or re derived. `parseDraftPlan` deliberately does not enforce stage ordering, because `drafter.md` calls windows guidance rather than promises, so a plan whose windows overlap or run backwards records `nonMonotonic` as an observation in the report and never as a contradiction.

**File layout**:

| Path | What |
|---|---|
| `apps/api/evidence/sources.json` | committed `Source` array |
| `apps/api/evidence/passages.json` | committed `Passage` array |
| `apps/api/evidence/gold-cases.json` | `{ id, capturePath, field, expectedVerdict, expectedPassageIds[] }` |
| `apps/api/evidence/captures/` | committed capture fixtures (AC-17) |
| `scripts/check-corpus.mjs` | repo root, dependency free, run in CI beside `check-skills` |
| `apps/api/scripts/beta-evidence.ts` | the runner |

JSON rather than TypeScript, and the checker at repo root, because `check-skills.mjs` is a dependency free `.mjs` and a TypeScript corpus would drag `tsx` into a root level CI check.

**Interface surface** (scripts, no HTTP):

| Command | Package | Key inputs | Key outputs | Exit |
|---|---|---|---|---|
| `npm run evidence` | `apps/api` | `--replay <file or dir>` (required), `--only <profileId>`, `--out` (defaults to `apps/api/.corpus/evidence-report.json`, gitignored) | JSON report, printed summary | per AC-19 |
| `npm run check:corpus` | root | none | pass, or the list of failures | 0 or 1 |

**Value sourcing**:

| Action | Value produced | Source |
|---|---|---|
| read claim | `Claim.startWeek`, `endWeek` | the drafter object's new integer fields (AC-15) |
| read claim | `Claim.value` | `startWeek` of the final stage, per AC-13 |
| read claim | `Claim.field` | fixed constant `finalStageStartWeek` in thread one |
| read claim | `Claim.injury` | `request.injuryArea` in the v2 capture (AC-16) |
| look up | `matchedPassageIds` | `Passage` rows whose `injury` and `claimType` equal the claim's |
| look up | `rangeUsed` | convex hull of `Passage.range` across the matched set |
| look up | `conflict` | more than one match and their `(min, max)` pairs differ |
| compare | `verdict` | deterministic comparison above; empty match set yields `no_evidence` |
| report | `nonMonotonic` | stage windows in the validated plan, compared in order |
| report | `generatedAt` | process clock at run time |
| gate | pass or fail | `gold-cases.json` plus the AC-18 floor |
| corpus check | licence validity | `Source.licence` against the AC-2 allowed set |
| corpus check | injury validity | the checker's own list, asserted equal to `INJURY_AREAS` by a colocated test (AC-20) |

**Key invariants**:

- No model call occurs inside a verdict (AC-6). Model judgement enters only at curation time, through a diff Tony reviewed.
- No claim is ever produced by reading prose (AC-1). This is what AC-15 exists to make true.
- `no_evidence` and `contradicted` are never merged, summed, or reported as one number (AC-4).
- A verdict never holds free text (AC-7).

**Security model**: no authentication surface, because there is no endpoint. The compliance angle is content licensing rather than personal data: only `CC0`, `CC-BY`, and `CC-BY-SA` are admitted, enforced in CI by AC-2. Spec 0004's AC-6 and spec 0005's AC-I7 hold by construction, because the harness runs on synthetic profiles and a verdict carries no text. Committed capture fixtures are synthetic by origin, and their `goals` free text field is replaced by a fixed placeholder before commit so no free text ships even from a synthetic source.

**Configuration required**: none. No new environment variable, credential, or service.

**Critical test scenarios**:

- Happy path: a claim inside a curated range returns `supported` and names the passage, verifies **AC-4**, **AC-12**.
- Determinism: the same corpus and capture run twice produce identical verdicts, verifies **AC-6**.
- Conflict: two passages with different week ranges yield the convex hull and `conflict: true`, verifies **AC-5**.
- Open ended range: a passage with a null `max` never yields `contradicted`, verifies **AC-4**.
- Empty match: an injury the corpus does not cover returns `no_evidence`, not `contradicted`, verifies **AC-4**.
- Empty corpus: a run against an empty corpus fails the gate rather than passing trivially, verifies **AC-18**.
- Licence failure: a non commercial source fails `check:corpus` in CI, verifies **AC-2**.
- Enum drift: adding a value to `INJURY_AREAS` without updating the checker fails the colocated test, verifies **AC-20**.
- Leakage: no report field contains plan or profile text, verifies **AC-7**.
- Offline: a fresh clone with no `.env` and no network runs the gate on the committed fixture, verifies **AC-11**, **AC-17**.
- Rendering: the plan a visitor receives is byte identical before and after the schema change, verifies **AC-15**, **AC-14**.

## Build plan

Tracer Bullet, the project default (specs 0002 and 0004 assumed the same). One claim goes through every layer before any layer widens. Two enabling changes come first because the thread cannot exist without them, and the gold cases are authored before the comparator that grades against them, per the standing rule that a green suite is not evidence.

1. Change the drafter schema: `timeWindow` becomes `startWeek` and `endWeek` integers, rendered to the same display string in code, with `parseDraftPlan` validating both, satisfies **AC-15**, **AC-1**
2. Change the capture format to v2: versioned, keyed by profile id, carrying the request DTO, with `--replay` reading by key, satisfies **AC-16**, **AC-8**
3. Commit one capture fixture with `goals` replaced by a placeholder, satisfies **AC-17**, **AC-11**
4. Define the corpus files and commit the first `timeline` passages for a single injury, each licence checked by hand, satisfies **AC-2**, **AC-12**, **AC-13**
5. Write `scripts/check-corpus.mjs` (licence, resolvable `sourceId`, `range` shape, required citation fields, injury validity) and wire it into CI beside `check-skills`, plus the colocated enum equality test, satisfies **AC-2**, **AC-3**, **AC-20**
6. Author the gold case set, including at least one expecting `supported` and one expecting `contradicted`, satisfies **AC-10**, **AC-18**
7. Write the claim reader producing `finalStageStartWeek` from the validated drafter object, satisfies **AC-1**, **AC-13**
8. Write the lookup: filter by `injury` and `claimType`, take the convex hull, set `conflict`, satisfies **AC-5**, **AC-12**
9. Write the comparator: three way verdict, inclusive bounds, null as infinity, satisfies **AC-4**, **AC-6**
10. Write the report emitter, JSON plus printed summary, carrying no visitor text, recording `nonMonotonic`, satisfies **AC-7**, **AC-9**
11. Write the runner that reads committed captures and runs the thread with no network, satisfies **AC-8**, **AC-11**
12. Wire the gate and exit codes: every gold case reproduced, zero undeclared contradictions, the AC-18 floor met, satisfies **AC-10**, **AC-18**, **AC-19**
13. Widen the corpus to `finalStageStartWeek` across all three injuries Beta serves, satisfies **AC-12**
14. Confirm the production diff is limited to `timeWindow`'s representation, satisfies **AC-14**

## Consequences

**Positive**:

- Beta gains its first layer that reasons about clinical validity. `beta-output-guard.ts` deliberately refuses to, and says so in its own header, so this fills a documented gap.
- The corpus is a reviewable artifact. Clinical content stops being prose in a prompt file and becomes rows with a citation, a licence, and a range a reader can check.
- The timeline stops being prose in the product too. `timeWindow` joins `DoseSpec` as a structured field the coach cannot alter, which is a safety improvement independent of this checker.
- Costs almost nothing to run: no embedding call, no database, no credentials, and committed captures replace live model calls.
- Determinism makes calibration cheap. A verdict cannot drift between runs, which is the property that made R2 and R8 so expensive to pin down.

**Negative / tradeoffs**:

- **This is not the RAG system the project set out to build.** No vector store, no embedding model, no semantic retrieval. Calling it retrieval augmented would oversell it.
- **The widest hull policy makes `contradicted` monotonically harder to reach as the corpus grows.** Every added passage can only widen the hull, so better coverage weakens detection, which inverts the intended trajectory. The evidence tier follow up is the only lever against it and is deliberately deferred. Watch the contradiction rate as coverage grows.
- Curation is slow and does not scale past what one clinician can personally review.
- `no_evidence` will dominate early, so the first reports say little.
- It now touches production code. Small, behaviour preserving, and visitor output is byte identical, but AC-14 is no longer "nothing changed".
- Metadata lookup will need revisiting past a few hundred passages per bucket, where two enum filters stop narrowing usefully.

**Neutral**:

- No database migration, no environment variable, and no deployment coordination. The schema change ships like any other code change and reverts with one commit.
- Adds a second check script beside `check-skills.mjs`. The pattern is now established rather than novel, which argues for a shared runner later.
- The capture format change touches `beta-guard-corpus.ts`, a harness script rather than request path code, which is why it does not count against AC-14.
- The corpus deliberately excludes creator produced rehab content, including Hooper's Beta, on copyright grounds regardless of clinical quality.

## Follow-up

- [ ] Record an evidence tier on `Source` (guideline, cohort, case report). Promoted from optional: it is the only lever against the hull widening problem named in Consequences, and it needs deciding before the corpus grows much.
- [ ] Decide whether the check ever runs on the request path. Production shadow was chosen in principle but deferred, on the finding that an unadvertised surface collects near zero data. Revisit when `planCount` justifies it.
- [ ] Revisit retrieval if the corpus outgrows metadata lookup. `pgvector` on Prisma Postgres, S3 Vectors, and a committed local index were all weighed and remain open; the corpus and reviewed ranges port to any of them unchanged.
- [ ] Widen beyond timelines: loading doses (`DoseSpec`) and return to climbing criteria each need their own thread, their own predicate, and their own gold cases.
- [ ] The eval measures the checker, not Beta. A capture is one live model sample, so a passing gate says the comparison logic is right, not that Beta's timelines are. Do not let a green gate be read as clinical validation.
- [ ] Specs 0004 and 0005 carry no prior art section. If one is added, Hooper's Beta belongs in it as adjacent prior art that Beta does not compete with.
- [ ] `drafter.md` still holds the clinical rules as prose. Once coverage is real, decide whether those rules cite corpus passages directly.
