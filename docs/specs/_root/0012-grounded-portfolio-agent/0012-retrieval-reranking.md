# 0012 child. Retrieval reranking with a System One model (phase six)

**Date**: 2026-09-21

## Summary

Phase three gave the Tony persona a search tool over Tony's own committed documents. Which sections come back is decided by a cosine similarity number, `MINIMUM_SIMILARITY = 0.68`, hand tuned once against an index that no longer exists in the same shape. This phase puts a judgement in that place. Retrieval widens to ten candidates behind a low floor, a System One model (TypeSafe's Jev) scores each one for relevance to the question actually asked, and the best three go to the persona. It ships in shadow mode first, deciding nothing while it logs what it would have chosen, and only starts deciding once it beats the current number on the twenty labelled queries that already exist. When the model is slow or unavailable, retrieval falls back to exactly today's behaviour.

## Inline rationale

Why this phase, and why now. Spec 0013's spike measured Jev against Haiku on the credential guard corpus and they tied at zero missed claims out of seventy, so Jev was parked rather than adopted: an early access vendor with no published service level agreement had to beat the incumbent on a path that fails closed, and a tie was not enough. That reasoning was correct for that surface and does not carry here, because the failure modes are opposite. A wrong credential verdict publishes a false claim about a regulated healthcare qualification. A wrong relevance judgement gives the visitor a slightly worse answer. Retrieval is where a new vendor belongs.

There is also a live problem rather than a hypothetical one. `MINIMUM_SIMILARITY` was calibrated once against a six hundred and seven chunk index. The corpus was then re embedded, and re embedding **repartitions**: which paragraphs land together is an accident of their lengths and the packer's arithmetic, so a section that was a tight match can simply stop existing. `scripts/threshold-sweep.ts` exists because of that, and its own comment records that nothing in the repo noticed the last time retrieval quality moved. A similarity threshold is a number that drifts with chunk boundaries. Relevance is a judgement about meaning, and it does not care where the packer put the paragraph break.

One lesson from 2026-09-21 is carried in deliberately. The credential check read only the generated answer, and the bait question carried all the clinical vocabulary, so the most likely reply to it was never checked at all. The reranker therefore judges against the interviewer's question **and** the persona's search query, not the query alone. A search query is the persona's own paraphrase and can drift from what was actually asked.

## Context

**What exists today.** `retrieval/vector-store.ts:search` queries the Upstash index with `TOP_K = 3` and drops anything scoring under `MINIMUM_SIMILARITY = 0.68`. `retrieval/search-knowledge.ts` owns the policy around it: at most two searches per turn (`MAX_SEARCHES_PER_TURN`), query validation, the degrade path, and `filterChunksForStory`, which drops chunks the ownership guard would reject if the persona quoted them. The persona calls all of this as a tool inside `runToolConversation`, so it decides when to search and answers from what comes back.

**The instrument already exists.** `scripts/threshold-sweep.queries.ts` holds twenty labelled queries, each naming the repo relative document it is expected to reach, split into positives and negatives. `scripts/threshold-sweep.ts` walks candidate thresholds against them and prints a comparable table. It is read only and never writes to the index. This is ground truth that did not have to be built for this phase, and it is why the exit bar below can be objective rather than a judgement call over logs.

**What constrains the design.** The conversation endpoint is public and unauthenticated. Retrieval sits inside the tool loop, before any token reaches the visitor, and can run twice per turn. Spec 0011's scoreboard rests on runs being reproducible, and spec 0012's contract is that every phase must move or deliberately hold it. The corpus hash in `docs/evals/interview/corpus.json` pins which documents are in the index; it says nothing about how they are ranked, which this phase changes.

## Requirements

**User stories**:
- As a visitor, I want the persona to cite the document that actually answers my question, so that a relevant section is not lost because a packer put a paragraph break in an awkward place.
- As Tony, I want relevance decided by a judgement about meaning rather than by a number I have to re tune after every re embed, so that retrieval quality stops drifting silently.
- As an engineer maintaining the suite, I want the change measured against ground truth before it decides anything, so that "it feels better" is never the reason it shipped.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: Retrieval requests `RERANK_CANDIDATE_K = 10` candidates behind a lowered floor `RERANK_CANDIDATE_FLOOR = 0.40`. When reranking is off, `TOP_K = 3` and `MINIMUM_SIMILARITY = 0.68` apply exactly as today and the widened query is never issued.
- **AC-2**: `filterChunksForStory` runs **before** reranking, so no reranking question is ever spent on a chunk the ownership guard would reject, and the reranker chooses only from chunks that can actually reach a visitor.
- **AC-3**: One request scores every surviving candidate, carrying one `Noul` question per candidate over a single state. The state holds the interviewer's question and the persona's search query. The model judges relevance to both.
- **AC-4**: Candidates scoring at or above `RERANK_KEEP_THRESHOLD = 0.5` are kept in descending score order, capped at three. When fewer than three clear it, fewer are returned; the persona is never padded with chunks the reranker rejected. When **none** clear it, the executor returns the existing `NO_MATCH_RESULT`, not a fourth model facing string: from the persona's side this is the same "nothing to cite" case it already handles.
- **AC-5**: `RETRIEVAL_RERANK_MODE` takes `off`, `shadow`, or `enforce`. `off` is byte identical to today. `shadow` computes and logs the reranked selection but returns the cosine selection. `enforce` returns the reranked selection. Unset means `off`.
- **AC-6**: The check **fails open**. A timeout at `RERANK_TIMEOUT_MS = 1500`, a provider error, a malformed response, or a missing key returns the cosine selection for that search. No failure path removes results the visitor would otherwise have seen, and no failure path throws out of the executor.
- **AC-7**: Reranking is pinned to `jev-1.13.0`, an explicit dated model id, held in an exported constant. Not a moving alias: the keep threshold is tuned against one version, and the provider's own models page says to pin the version whenever a threshold has been tuned against it. This is the version spec 0013's spike measured.
- **AC-8**: Reranker token usage is recorded per search on the AC-9 log line, never added to `dailyUsage.incrementOp`. "Counter" here means a recorded figure, not a persisted running total: there is no new table and no schema change. The Anthropic daily cap keeps meaning exactly what it means today, which is the point.
- **AC-9**: Each search logs one line: mode, candidate count, kept count, duration, and whether it fell back. In `shadow` it also logs the two selections' document paths so disagreement is countable. Neither the query nor any chunk text is ever logged.
- **AC-10**: The eval harness runs the reranker rather than stubbing it, because the scoreboard entry this phase publishes is only meaningful if the eval exercises what ships. The harness forces `enforce` whenever `RETRIEVAL_STRICT_ENV` is set, decoupled from whatever the deployment happens to be running, exactly as retrieval strictness is already decoupled today. Without this the default (`off`) would silently stub the thing this criterion exists to require.
- **AC-11**: `scripts/threshold-sweep.ts` gains a reranked arm, scoring both paths against the same twenty labelled queries and printing them side by side.
- **AC-12**: The reranker's prompt lives as a markdown file on disk under `retrieval/skills/`. `loadConversationSkill` cannot load it as it stands: its directory list and its name union are both closed. Generalise it (or add a sibling loader) to carry a second rooted directory and the new name, rather than filing a retrieval prompt next to `tony.md`. No prompt text lives in TypeScript.

## Options considered

### Option 1: Fix in place, re tune the threshold

Keep the single stage design. Re run `threshold-sweep.ts` after every re embed and move `MINIMUM_SIMILARITY` to whatever the table says.

**Pros**:
- No new vendor, no new key, no new failure mode, no added latency.
- The sweep script already does the measuring; this is just using it.
- Fully deterministic, so the eval stays exactly as reproducible as it is now.

**Cons**:
- It treats the symptom. A single number cannot separate "similar wording" from "answers the question", which is the distinction retrieval actually needs.
- It is a maintenance ritual with no trigger. Nothing fires when a re embed moves quality, which is precisely how the last drift went unnoticed.
- Recall and precision are traded with one dial. Lowering the floor to catch a missed document admits noise into every other query.

### Option 2: Two stage, cosine for recall and a System One model for precision, shadow first

Widen the cheap stage and add a judgement stage behind it. Ship in shadow, measure against the labelled queries, enforce only when it wins.

**Pros**:
- Each stage does what it is good at. Cosine is cheap and has good recall; the model is the only thing that can judge meaning.
- Shadow mode makes the decision to enforce an evidence based one, using ground truth that already exists.
- Failing open means the worst outcome is today's behaviour, which is a shipped and working system.
- The cost profile makes the second stage viable at all. At roughly three millionths of a dollar per call, a judgement per candidate is affordable in a way a general purpose model is not.

**Cons**:
- A second paid provider on the request path, early access, with no published service level agreement or rate limits.
- Adds latency inside the tool loop, up to twice per turn, before any token reaches the visitor.
- Ranking becomes non deterministic in a way a cosine score is not, which is a new source of eval noise.
- Two mechanisms to keep aligned instead of one.

### Option 3: Replace the threshold outright

Delete `MINIMUM_SIMILARITY`, let the model decide relevance with no numeric floor underneath it.

**Pros**:
- One mechanism, one mental model, and the magic number that drifts is gone rather than merely demoted.
- Removes the possibility of the two stages disagreeing about what is relevant.

**Cons**:
- Every search then depends on an external vendor with nothing deterministic beneath it. There is no fallback to fall back **to**.
- It removes a working mechanism before its replacement has run in production even once, which is the sequencing mistake spec 0013 explicitly declined to make with Option 4 and was later proved right about.
- Without a floor the cheap stage returns its ten best regardless of how bad they are, so the model is asked to reject noise that a number could have removed for free.

### Option 4: Offline only, build nothing into the request path

Extend the sweep script to score a reranked arm, look at the numbers, and spec the integration separately later.

**Pros**:
- Zero production risk and zero added latency.
- Answers the "does it win" question at the lowest possible cost.

**Cons**:
- The sweep measures retrieval in isolation against twenty queries. It cannot show what reranking does to a real turn, which is what the scoreboard measures and what the umbrella's contract is about.
- It defers rather than decides, and the shadow mode in Option 2 already provides the same safety with a real signal attached.

### Option 5: The same two stage design, judged by Haiku instead

Identical shape to Option 2, but the relevance judgement goes through the `forceToolCall` path already built and trusted for the credential check, rather than a second vendor.

**Pros**:
- No new provider, no new key, no new startup concern, no early access exposure. Two of Option 2's four listed cons disappear outright.
- Reuses a code path this repo has already hardened, including its timeout and error classification.
- Spec 0013's spike found the two tied at zero missed claims on a comparable judgement task, so there is measured reason to think the quality is equivalent.

**Cons**:
- Latency, and it is decisive here rather than marginal. Measured at roughly 1.2 seconds against Jev's roughly 0.2, inside the tool loop, up to twice per turn, before any token reaches the visitor. That is up to 2.4 seconds added to a turn in exchange for better grounding, against roughly 0.4.
- A per candidate judgement over ten candidates is a different cost shape from one verdict per answer. The economics that make "score every candidate" reasonable are the ones Option 2 has and this does not.
- It puts more load on the provider that also generates every answer, so a slow period degrades generation and retrieval together rather than one of them.

## Decision

**Chosen option**: Option 2: two stage retrieval, cosine for recall and a System One model for precision, shipped in shadow mode first.

Retrieve ten candidates above a `0.40` floor, run `filterChunksForStory`, score every survivor with one `Noul` each in a single request against the interviewer's question plus the search query, keep those at or above `0.5` in score order capped at three. Three modes behind `RETRIEVAL_RERANK_MODE`, failing open to the cosine selection, pinned to a dated model id, with its own spend counter and a reranked arm in the sweep script.

**Implementation skills**: `typesafe-ai` (`typesafe-ai/skills`, installed globally per spec 0014, listed in `skills-lock.json`) for the request shape and primitive semantics · `nestjs-best-practices` (`kadajett/agent-nestjs-skills`) for the module and injection pattern.

## Rationale

The diagnosis settles the shape. The current mechanism is not underperforming because its number is wrong; it is underperforming because a single similarity score cannot express the distinction retrieval needs. That is the same category of problem the ownership guard hit with character matching, and the same answer applies: keep the cheap deterministic stage for what it is genuinely good at, and add a stage that can make the judgement. Option 1 re tunes a dial that will drift again on the next re embed, and nothing in the repo will notice, because nothing noticed last time.

Option 3 is rejected on sequencing rather than merit, and the precedent is recent and local. Spec 0013 declined to delete its deterministic layer in the same change that added the model layer. The implementation branch did it anyway, and the pre deploy gate then found a claim that routed nowhere and would have reached a visitor unchecked had the deterministic layer been gone. Keeping a floor underneath a new vendor is cheap insurance, and this repo has already paid once for the other choice.

Shadow mode plus an objective exit bar is what makes this a measurement rather than a preference. The twenty labelled queries exist, name their expected documents, and are already wired to a script that prints a comparable table. The bar is therefore checkable by a machine: the reranked arm must reach the expected document at least as often as `0.68` does, must beat it on at least one query, and must lose no labelled positive. That is a stronger standard than "the logs look right", and it is available at no build cost.

Failing open is the deliberate inverse of the credential check, and the contrast is the point. That check suppresses an answer when it cannot decide, because publishing a false claim about a healthcare credential is worse than serving a canned reply. Here the unavailable path costs a slightly less well grounded answer, and removing results the visitor would otherwise have seen would be a worse outcome than shipping today's behaviour. Same mechanism shape, opposite default, for a reason that is written down.

Option 5 deserves a direct answer, because it is the strongest argument against this spec and it was missing from the first draft. Reusing Haiku would remove the second vendor entirely, reuse a hardened code path, and rest on a measured tie rather than a hope. It loses on latency, and only on latency. Roughly 1.2 seconds against roughly 0.2, inside the tool loop, up to twice per turn, before the visitor sees a single token. Up to 2.4 seconds added to every turn that searches is not a grounding improvement, it is a worse product that happens to retrieve better. The cost shape matters too: judging ten candidates individually is affordable at three millionths of a dollar a call and is a different proposition at Haiku's pricing. If Jev's latency ever fails to hold under load, Option 5 is the fallback design and not a rewrite, because the two stage shape and the shadow gate are provider agnostic.

The reranker reads the question as well as the query because of what today's gate found. Both layers of the credential check read only the generated answer while the bait question carried the subject, so the likeliest reply to the question the guard existed for was never examined. A search query is a paraphrase the persona wrote; judging relevance against it alone optimises for the paraphrase rather than the question.

## Feature design

**Defined terms** (the cross check found the first of these asserted three times and never specified, which is the load bearing one):

- **The candidate set**: the result of the widened query, `RERANK_CANDIDATE_K = 10` at `RERANK_CANDIDATE_FLOOR = 0.40`, after `filterChunksForStory` has run over it.
- **The cosine selection**: the candidate set re filtered to `score >= MINIMUM_SIMILARITY (0.68)`, in descending score order, capped at `TOP_K (3)`. This is what `off` returns, what `shadow` returns, and what every failure path falls back to. It needs **no second query**, because the widened set is a strict superset of the narrow one: same index, same query, a lower floor and a larger k. That superset property is why "failing open costs nothing" is true rather than merely hoped for, and it is the reason the floor is lowered rather than removed.
- **The reranked selection**: candidates scoring at or above `RERANK_KEEP_THRESHOLD = 0.5`, in descending rerank score order, capped at three, and `NO_MATCH_RESULT` when none clear.

**Data model sketch**: no schema change. Nothing about a rerank is persisted. The selection lives for the duration of one search.

**State transitions**: none. One pass over one candidate set per search.

**API surface**: no change. `POST /conversation/turn` keeps its contract of two validated scalars and the same SSE events. Reranking sits inside the existing `searchKnowledge` executor, which is a tool the model calls, not an HTTP surface.

**Value sourcing**:

| Action | Value produced | Source |
|---|---|---|
| decide whether to rerank | mode | `RETRIEVAL_RERANK_MODE`, unset means `off` |
| decide whether to rerank | provider configured | a `TYPESAFE_API_KEY` presence check, same shape as `isRetrievalConfigured()` |
| widen the query | candidate count | `RERANK_CANDIDATE_K = 10`, a new constant beside `TOP_K` |
| widen the query | candidate floor | `RERANK_CANDIDATE_FLOOR = 0.40`, a new constant beside `MINIMUM_SIMILARITY` |
| narrow the candidates | which chunks may be shown | the existing `filterChunksForStory`, unchanged, run before reranking (AC-2) |
| score a candidate | the question put to the model | a markdown prompt file on disk beside the retrieval module, loaded through the existing skill loader (AC-12) |
| score a candidate | the shared state | `{ interviewerQuestion, searchQuery }`, named JSON fields, sent ONCE for the whole request. The question comes from `interviewerResult.text`, already in scope in `generateTurnPair`, and must be threaded into the executor |
| score a candidate | the per candidate question | each `Noul`'s own instructions carry that candidate's `section` text. It cannot live in the shared state, which is shared by definition and would then be the same for every candidate |
| score a candidate | the model | an exported dated model id constant beside the reranker, never a moving alias (AC-7) |
| keep a candidate | the cut | `RERANK_KEEP_THRESHOLD = 0.5`, in score order, capped at `TOP_K` |
| any failure | what the caller receives | the cosine selection computed from the same candidate set, so the fallback costs no second query |
| any search | the log line | mode, candidate count, kept count, duration, fell back, and in shadow the two document path lists (AC-9) |
| any search | spend | the reranker's own counter, not `dailyUsage.incrementOp` (AC-8) |

**Key invariants**:
- No failure path returns fewer results than the cosine selection would have returned.
- The reranker never sees a chunk `filterChunksForStory` rejected.
- `off` is byte identical to today, including issuing no widened query.
- Nothing the reranker returns was absent from the candidate set; it selects and orders, it never generates.
- The query text and the chunk text are never logged.

**Security model**: unchanged, and narrower than it looks. The route stays public and anonymous with two validated scalars. The state sent to the reranker is the interviewer's question, the persona's search query, and a chunk of Tony's own committed documents. Every one of those is model generated or repo authored; no visitor typed content exists on this path, which is the same property spec 0013 relies on. The reranker cannot introduce text, so a compromised judgement changes which committed section is quoted, never what it says.

**Configuration required**:
- `TYPESAFE_API_KEY`: the provider key. Absent means the reranker is unconfigured and every search takes the cosine path.
- `RETRIEVAL_RERANK_MODE`: `off` (default) · `shadow` · `enforce`. Three states rather than a boolean, mirroring `BETA_OUTPUT_GUARD_MODE`, which already proved the shape in this repo.

**Critical test scenarios** (each maps to an acceptance criterion):
- Mode `off` issues no widened query and returns the same chunks as today, verifies **AC-1**, **AC-5**.
- Mode `shadow` returns the cosine selection while logging a different reranked one, verifies **AC-5**, **AC-9**.
- Mode `enforce` returns the reranked selection in score order, verifies **AC-4**, **AC-5**.
- A chunk `filterChunksForStory` rejects is never scored, verifies **AC-2**.
- A timeout, a provider error, and a malformed response each return the cosine selection and throw nothing, verifies **AC-6**.
- Two candidates clear the keep threshold and exactly two are returned, with no padding, verifies **AC-4**.
- One request carries one question per surviving candidate, verifies **AC-3**.
- The log line carries no query text and no chunk text, verifies **AC-9**.
- The sweep script prints both arms against the same twenty queries, verifies **AC-11**.
- The prompt loads from disk and no prompt text appears in a `.ts` file, verifies **AC-12**.

## Migration plan

**Strategy**: feature flagged, three modes, evidence gated.

**Phases**:
1. Ship with `RETRIEVAL_RERANK_MODE` unset, which is `off`. Nothing changes for a visitor. Merge is safe on its own.
2. Set `shadow` on Render. Reranking computes and logs; the cosine selection still decides. Watch the disagreement rate.
3. Run the extended sweep. The exit bar is objective: the reranked arm must reach the expected document at least as often as `0.68` does, must beat it on at least one of the twenty queries, and must lose no labelled positive. Below that bar the phase stops here and the spec records why.
4. On passing the bar, set `enforce`, then run two full eval passes at the same commit to establish a noise band and publish the phase entry with its delta.

**Rollback**: set `RETRIEVAL_RERANK_MODE=off`. No deploy needed, though changing an environment variable on Render restarts the service. Reverting the commit also works and is not faster.

**Risks**: the reranker could be worse than the threshold, which the sweep is there to catch before enforce. Latency could exceed budget under load, which the timeout bounds at `1500` ms per search and two searches per turn. The eval noise band could widen enough to hide a real delta, which phase four of the plan would reveal and which is a finding worth publishing either way.

## Build plan

Tracer Bullet, matching the default noted in the root `AGENTS.md` (no scope header exists; specs 0002, 0004 and 0013 all defaulted to it). The thin thread is one search going end to end through the reranker in shadow before anything is widened or tuned.

1. Add the prompt as a markdown file at `retrieval/skills/rerank.md`, and generalise `skill-loader.ts` to reach it: today its directory list and its `ConversationSkillName` union are both closed, so it cannot load a retrieval prompt without a change. Widen both, or add a sibling loader rooted at `retrieval/skills/`. Files: `apps/api/src/modules/conversation/skill-loader.ts`, `apps/api/src/modules/conversation/retrieval/skills/rerank.md`. Satisfies **AC-12**.
2. Add the reranker as its own module: the dated model id constant, the mode reader, the candidate scoring call with one `Noul` per candidate over one state, a `1500` ms timeout, no retry, and a result type that always carries a usable selection. Satisfies **AC-3**, **AC-6**, **AC-7**.
3. Thread the interviewer's question into the `searchKnowledge` executor. It is already in scope in `generateTurnPair` and is currently not passed down. Satisfies **AC-3**.
4. Wire the reranker into the executor after `filterChunksForStory`, in `shadow` only, returning the cosine selection and logging both. This is the thin thread: one search end to end with nothing changed for a visitor. Satisfies **AC-2**, **AC-5**, **AC-9**.
5. Widen the candidate query behind the mode check, so `off` still issues today's query exactly. Satisfies **AC-1**.
6. Add `enforce`: return the reranked selection, in order, capped, with no padding. Satisfies **AC-4**, **AC-5**.
7. Add the separate spend counter. Satisfies **AC-8**.
8. Extend `scripts/threshold-sweep.ts` with a reranked arm over the same twenty labelled queries, printing both side by side. Satisfies **AC-11**.
9. Wire the eval harness to run the reranker rather than stub it, and add the key to the eval workflow. Satisfies **AC-10**.
10. Add colocated mocked tests for every critical test scenario above.

## Consequences

**Positive**:
- Relevance becomes a judgement about meaning rather than a number that drifts with chunk boundaries, which removes the failure mode nobody noticed last time.
- Recall and precision stop sharing one dial, so catching a missed document no longer admits noise into every other query.
- The decision to enforce is gated on ground truth that already exists, at no extra build cost.
- The worst failure is today's behaviour, which is shipped and working.

**Negative / tradeoffs**:
- A second paid provider on the request path, early access, without a published service level agreement.
- Added latency inside the tool loop, up to two searches per turn, before the first token.
- Ranking becomes non deterministic where a cosine score was not, which is a new source of eval noise and is why phase four of the migration re establishes a band rather than assuming the old one holds.
- Two mechanisms where there was one, and a mode flag whose three states each need testing.

- The widened query starts as soon as the mode is `shadow`, not when it reaches `enforce`, so the larger Upstash payload is paid throughout the measurement phase, before any evidence gated decision. That is the cost of measuring honestly, and it is bounded by the same daily Upstash quota retrieval already lives inside.

**Neutral**:
- No schema change, no new endpoint, no change to the visitor facing surface beyond which document the persona cites.
- The corpus hash keeps meaning exactly what it meant: which documents are in the index, not how they are ranked.

## Follow-up

- [ ] **Needs its own spec.** If the reranker beats the threshold decisively, revisit whether `MINIMUM_SIMILARITY` earns its place at all. Deleting it is Option 3, the argument for keeping it is sequencing rather than merit, and the evidence exists only after real running time. It is a separate decision with its own blast radius, not a task inside this phase's build plan.
- [ ] The corpus hash pins which documents are indexed and says nothing about ranking. Consider whether a published phase entry should also record the reranker's model id, so a scoreboard number names every input that produced it.
- [ ] `RERANK_KEEP_THRESHOLD` is a tuned number of the same species as the one this phase exists to replace. It is gentler, because a wrong cut costs a chunk rather than silently drifting, but it should be swept rather than assumed, and the sweep script is the place.
- [ ] Spec 0013's parked Jev harness (`apps/api/scripts/jev-spike/`) names four conditions that would re open it. If this phase enforces, one of them has been met in a different surface and that README should say so rather than reading as though Jev was rejected outright.
