# 0011. Interview simulator eval suite — rationale

## Context

The interview simulator is the portfolio's oldest AI surface and carries its strongest promise: the AI "Tony" never claims more credit than the git verified story allows. That promise is enforced at runtime by a deterministic guard, but nothing measures overall answer quality, and nothing detects a slow regression when a prompt is edited or the underlying model updates. Tests in the repo are fully mocked plumbing checks; they prove the pipeline runs, not that the output is good.

Tony is concurrently taking the AI Engineering Fundamentals course (Master.dev), whose lessons 4 and 5 teach the eval discipline: a golden dataset of cases with expected characteristics rather than expected outputs, code based scorers where properties are checkable, LLM judges where they are not, and a baseline so every change shows a measured delta. This spec applies that discipline to the conversation surface. It is both practical (safe prompt iteration, a data driven answer to the provider split question) and a portfolio artifact in its own right.

Forces: a solo maintainer, so anything requiring an always on service or vendor account is overhead; a public repo, so the dataset and scores are visible; a hard privacy rule that no visitor typed content is persisted or logged anywhere, so eval data must be authored, never harvested; CI currently runs with no API keys at all; and eval runs cost real money, so cadence must be deliberate.

## Options considered

### Option 1: Hand rolled TypeScript harness in the repo (chosen)

A script under `apps/api/scripts/` (the same pattern as the existing `beta-guard-corpus.ts`) that calls `generateTurnPair` with mocked persistence and real model calls, scores with a reused code guard plus judge rubrics, and writes committed JSON and markdown.

**Pros**:
- No new vendor, account, or data leaving the repo; fits the solo maintainer and public repo forces.
- Full control over the multi step pipeline (interviewer, Tony, guard), which generic frameworks model awkwardly.
- Building the harness is itself the portfolio demonstration.
- Follows an existing in repo pattern (the Beta guard corpus script).

**Cons**:
- No dashboard, trace viewer, or run comparison UI; history is files in git.
- Every capability (retries, cost accounting, reports) is code to write and maintain.

### Option 2: promptfoo

Open source eval framework, config driven, HTML reports, GitHub Action available.

**Pros**:
- Mature scorer library and report tooling for free; less harness code.
- No hosted service required; runs local and in CI.

**Cons**:
- Its prompt centric configuration fits single prompt comparisons well but a two model pipeline with an in code deterministic guard awkwardly; the natural integration point becomes a custom provider wrapper, at which point most of Option 1 gets written anyway.
- A config DSL to learn and to keep in sync with the service code.

### Option 3: Braintrust (the course's choice)

Hosted eval platform with dashboard, run history, tracing, and git metadata capture, free tier.

**Pros**:
- Best run comparison and trace UX of the three; exactly matches the course workflow.
- Automatic history and collaboration features with no report code to write.

**Cons**:
- A vendor account and eval data (generated turns, story content) leaving the repo to a third party cloud.
- The dashboard value is highest for teams iterating daily; for a solo, low cadence suite it is mostly unused surface.

### Option 4: Guard only bench (smaller scope)

Skip the LLM judges entirely: run only the deterministic ownership guard over generated answers on adversarial cases. Roughly 80 percent of the honesty value at near zero judge cost, and deterministic enough to gate CI.

**Pros**:
- Cheapest, fully deterministic, could hard gate.
- Smallest build.

**Cons**:
- Measures only what the phrase list already catches; no grounding or persona signal, and no practice with LLM as judge, which is half the point of applying the course.

## Rationale

Option 1 wins on the forces, not on features. The suite's cadence is low (prompt changes are occasional), so Braintrust's dashboard, its strongest asset, would sit idle while adding a vendor dependency to a repo that deliberately has almost none. promptfoo's sweet spot is comparing prompt variants; this suite evaluates a fixed production pipeline end to end, which is exactly what a thin custom harness expresses directly. The deciding fact from the codebase scan: `generateTurnPair` is callable without HTTP or a live database, the ownership guard is already an exported pure function, and the story fixtures exist statically in `seed.ts`, so the harness is genuinely thin. The repo also already contains the pattern (`beta-guard-corpus.ts`), so this is the second instance of a local convention, not a novel invention.

Judge model: `claude-haiku-4-5` was chosen over Sonnet because the rubrics are narrow and rubric driven (three focused yes or no leaning questions scored 0 to 1), which small models handle well, at a fraction of the cost, and it sits apart from the Sonnet 5 generator, reducing same model self preference. If Haiku verdicts prove noisy, upgrading the judge is a one line change and the baseline is re run.

Report only CI was chosen over gates because judge scores are nondeterministic and drift with judge model updates; a red build on judge noise trains the maintainer to ignore the suite. The deterministic honesty layer already gates production at runtime, which is the stronger place for a hard guarantee. A soft gate on the code scorer alone can be revisited once score variance is known.

Engineer decisions recorded from the design interview: full turn pair scope; three scored dimensions (honesty, grounding, persona) with format checks folded into the code layer where deterministic; hand curated dataset of about 20 cases; committed JSON plus markdown scoreboard; manual plus path filtered CI trigger; direct Anthropic only in CI with Bedrock comparison as a local follow-up; caps, single retry, temperature 0 judge for run bounds; repo scoreboard now with a public site page later; no references section; cross check pass requested.

Option 4, the guard only bench, was considered and declined: it is the honest minimal core, but the judges are the course learning payload and the grounding and persona dimensions have no deterministic substitute. Its insight survives in the design anyway: the guard layer is the floor of the honesty score and the only hard signal.

Decisions delegated to the architect and settled here: harness location beside the Beta corpus script; dataset as typed TS importing extracted fixtures rather than JSON (typechecking catches a renamed story title at compile time; runner up was JSON for editability); discrete judge scores (0, 0.5, 1) with written anchors rather than a continuous scale, because LLM judges cannot produce reliable continuous scores and the deltas must be readable against a noise band; honesty as the minimum of guard and judge layers (the guard is a floor, not an average input); judges through an eval only SDK client rather than widening the production provider seam for a temperature parameter; results files named by UTC date and 7 character sha; prices hardcoded with a dated comment rather than fetched (stability over freshness for a cost estimate).

A cross check pass on a second model reviewed the draft and surfaced 20 gaps, all folded in: the fixture extraction (seed.ts exported nothing and had import side effects), no stable story id, the hand built PreparedTurn and the explicit exclusion of story selection from scope, case level retry semantics (generateTurnPair never throws), the named persistence stub surface, the eval only judge client, pinned provider recording, discrete scoring and the noise band, the dataset hash for baseline comparability, the scoreboard as a pure projection, file naming, tsx script mechanics, the Jest rootDir constraint (eval logic lives under src), price table keying, concurrency and cost ceilings, CI env needs, the fork PR secret guard, and the history reaches only the interviewer fact with the injectQuestion answer to it.
