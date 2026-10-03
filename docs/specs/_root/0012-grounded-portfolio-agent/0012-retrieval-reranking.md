# 0012 child. Retrieval reranking with a System One model (phase six)

**Date**: 2026-09-21
**Updated**: 2026-09-24 (the measurement design, after the code shipped `off` in #111 and the first full eval ran; then reconciled with what #112 shipped after its pre deploy gate)

## Summary

Phase three gave the Tony persona a search tool over Tony's own committed documents. Which sections come back is decided by a cosine similarity number, `MINIMUM_SIMILARITY = 0.68`, hand tuned once against an index that no longer exists in the same shape. This phase puts a judgement in that place. Retrieval widens to ten candidates behind a low floor, a System One model (TypeSafe's Jev) scores each one for relevance to the question actually asked, and the best three go to the persona. It ships in shadow mode first, deciding nothing while it logs what it would have chosen, and only starts deciding once it clears an objective bar, set out in the Migration plan. When the model is slow or unavailable, retrieval falls back to exactly today's behaviour.

The 2026-09-24 update settles how that bar is measured. Shadow now returns exactly what `off` returns, so it truly decides nothing a visitor can see. The eval takes an explicit reranking arm, defaulting to `off`, and records it with every result, so `off` and `enforce` can be compared at one commit. And `enforce` now needs two things: a wider sweep bar that also checks negatives and questions shaped like real interview questions, and an eval comparison showing `enforce` within the noise band of `off` on every dimension.

## Inline rationale

Why this phase, and why now. Spec 0013's spike measured Jev against Haiku on the credential guard corpus and they tied at zero missed claims out of seventy, so Jev was parked rather than adopted: an early access vendor with no published service level agreement had to beat the incumbent on a path that fails closed, and a tie was not enough. That reasoning was correct for that surface and does not carry here, because the failure modes are opposite. A wrong credential verdict publishes a false claim about a regulated healthcare qualification. A wrong relevance judgement gives the visitor a slightly worse answer. Retrieval is where a new vendor belongs.

There is also a live problem rather than a hypothetical one. `MINIMUM_SIMILARITY` was calibrated once against a six hundred and seven chunk index. The corpus was then re embedded, and re embedding **repartitions**: which paragraphs land together is an accident of their lengths and the packer's arithmetic, so a section that was a tight match can simply stop existing. `scripts/threshold-sweep.ts` exists because of that, and its own comment records that nothing in the repo noticed the last time retrieval quality moved. A similarity threshold is a number that drifts with chunk boundaries. Relevance is a judgement about meaning, and it does not care where the packer put the paragraph break.

One lesson from 2026-09-21 is carried in deliberately. The credential check read only the generated answer, and the bait question carried all the clinical vocabulary, so the most likely reply to it was never checked at all. The reranker therefore judges against the interviewer's question **and** the persona's search query, not the query alone. A search query is the persona's own paraphrase and can drift from what was actually asked.

## Context

> ⚠️ Premise note (2026-09-24): the first real measurements point at the corpus as much as at the reranker. On five real interview turns, and on ten of sixteen eval searches, the reranker kept nothing. The interviewer asks about Tony's employment stories, the corpus holds his own repo documents, and those cannot answer each other, which the umbrella's phase three correction already records. Cosine hands the persona three unrelated chunks in those cases, and the reranker refuses them. So the measurement below may well show that `enforce` costs grounding, and the first full eval already hints at it. Stopping at `shadow`, or never enforcing, is a legitimate outcome of this phase rather than a failure of it, and the bar is written so that outcome can be reached honestly.

**What exists today.** `retrieval/vector-store.ts:search` queries the Upstash index with `TOP_K = 3` and drops anything scoring under `MINIMUM_SIMILARITY = 0.68`. `retrieval/search-knowledge.ts` owns the policy around it: at most two searches per turn (`MAX_SEARCHES_PER_TURN`), query validation, the degrade path, and `filterChunksForStory`, which drops chunks the ownership guard would reject if the persona quoted them. The persona calls all of this as a tool inside `runToolConversation`, so it decides when to search and answers from what comes back.

**The instrument already exists.** `scripts/threshold-sweep.queries.ts` holds twenty labelled queries, each naming the repo relative document it is expected to reach, split into positives and negatives. `scripts/threshold-sweep.ts` walks candidate thresholds against them and prints a comparable table. It is read only and never writes to the index. This is ground truth that did not have to be built for this phase, and it is why the exit bar below can be objective rather than a judgement call over logs.

**What constrains the design.** The conversation endpoint is public and unauthenticated. Retrieval sits inside the tool loop, before any token reaches the visitor, and can run twice per turn. Spec 0011's scoreboard rests on runs being reproducible, and spec 0012's contract is that every phase must move or deliberately hold it. The corpus hash in `docs/evals/interview/corpus.json` pins which documents are in the index; it says nothing about how they are ranked, which this phase changes.

**What the first measurements showed (2026-09-24).** Against the 708 chunk index, the sweep's reranked arm reached the expected document on 9 of 10 positives against cosine's 8, and rejected all 10 negatives against cosine's 8. On real turns in `/check`, and on 10 of 16 searches in the first full eval, it kept nothing. That eval ran `enforce` only, because the harness then forced it: honesty 0.96, grounding 0.91, persona 0.96, against a baseline of 0.93, 0.98 and 0.96 recorded three weeks earlier on a 679 chunk index. Grounding sits just outside its ±0.06 band, and with both the index and the reranker changed since the baseline, the drop cannot be attributed to either. Separately, three independent audit passes on 2026-09-23 found that `shadow` could return a chunk `off` never fetches, which the first version of the Defined terms below caused.

## Requirements

**User stories**:
- As a visitor, I want the persona to cite the document that actually answers my question, so that a relevant section is not lost because a packer put a paragraph break in an awkward place.
- As Tony, I want relevance decided by a judgement about meaning rather than by a number I have to re tune after every re embed, so that retrieval quality stops drifting silently.
- As an engineer maintaining the suite, I want the change measured against ground truth before it decides anything, so that "it feels better" is never the reason it shipped.
- As Tony, I want `off` and `enforce` measured at the same commit and recorded as such, so that a scoreboard delta can be attributed to the reranker rather than to whatever else moved.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: Retrieval requests `RERANK_CANDIDATE_K = 10` candidates behind a lowered floor `RERANK_CANDIDATE_FLOOR = 0.40`. When reranking is off, `TOP_K = 3` and `MINIMUM_SIMILARITY = 0.68` apply exactly as today and the widened query is never issued.
- **AC-2**: `filterChunksForStory` runs **before** reranking, so no reranking question is ever spent on a chunk the ownership guard would reject, and the reranker chooses only from chunks that can actually reach a visitor.
- **AC-3**: One request scores every surviving candidate, carrying one `Noul` question per candidate over a single state. The state holds the interviewer's question and the persona's search query. The model judges relevance to both.
- **AC-4**: Candidates scoring at or above `RERANK_KEEP_THRESHOLD = 0.5` are kept in descending score order, capped at three. When fewer than three clear it, fewer are returned; the persona is never padded with chunks the reranker rejected. When **none** clear it, the executor returns the existing `NO_MATCH_RESULT`, not a fourth model facing string: from the persona's side this is the same "nothing to cite" case it already handles.
- **AC-5**: `RETRIEVAL_RERANK_MODE` takes `off`, `shadow`, or `enforce`. `off` is byte identical to the read path before phase six. `shadow` computes and logs the reranked selection but returns the cosine selection, which is exactly what `off` returns for the same index results (see Defined terms), so shadow changes nothing a visitor can see. `enforce` returns the reranked selection. Unset means `off`. *(Revised 2026-09-24: the first version let shadow return a chunk `off` never fetches.)*
- **AC-6**: The check **fails open**. A timeout at `RERANK_TIMEOUT_MS = 1500`, a provider error, a malformed response (including any answer that is not a Noul probability between 0 and 1), a missing key, or a blank interviewer question returns the cosine selection for that search, which is what `off` would have returned. No failure path removes results the visitor would otherwise have seen, no failure path throws out of the executor, and no provider response, however slow or broken, may end the process.
- **AC-7**: Reranking is pinned to `jev-1.13.0`, an explicit dated model id, held in an exported constant. Not a moving alias: the keep threshold is tuned against one version, and the provider's own models page says to pin the version whenever a threshold has been tuned against it. This is the version spec 0013's spike measured.
- **AC-8**: Reranker token usage is recorded per search on the AC-9 log line, never added to `dailyUsage.incrementOp`. "Counter" here means a recorded figure, not a persisted running total: there is no new table and no schema change. The Anthropic daily cap keeps meaning exactly what it means today, which is the point.
- **AC-9**: Each search logs one line: the agent (`reranker`), the model id, mode, candidate count, kept count, duration, token usage, and whether it fell back. In `shadow` it also logs the two selections' document paths so disagreement is countable. Neither the query nor any chunk text is ever logged.
- **AC-10**: The eval harness takes the reranking arm explicitly, `--rerank off|shadow|enforce`, defaulting to `off`, which is what production runs. A manual dispatch of the eval workflow chooses the arm; pull request runs use the default. Any arm other than `off` runs the reranking preflight before anything is spent, and refuses to start if a one candidate probe falls back. *(Revised 2026-09-24: the first version forced `enforce` whenever `RETRIEVAL_STRICT_ENV` was set, which left no way to measure `off` at the same commit. Its worry, a default that silently stubs the reranker, is now answered by putting the arm on the record (AC-14) rather than by forcing one arm.)*
- **AC-11**: `scripts/threshold-sweep.ts` scores both arms against the same labelled queries (the twenty originals plus the AC-13 probe sets) and prints them side by side. Its exit bar lines cover positives (reaches the expected document at least as often as cosine, beats it on at least one query, loses no labelled positive) and negatives (rejects at least as many as cosine). It also reports, for each query, whether the narrow query's result equals the cosine selection recomputed from the widened query, the assumption the cosine selection rests on.
- **AC-12**: The reranker's prompt lives as a markdown file on disk under `retrieval/skills/`. `loadConversationSkill` cannot load it as it stands: its directory list and its name union are both closed. Generalise it (or add a sibling loader) to carry a second rooted directory and the new name, rather than filing a retrieval prompt next to `tony.md`. No prompt text lives in TypeScript.
- **AC-13**: `scripts/threshold-sweep.queries.ts` gains two labelled sets of negatives, each query expecting no document. **Story shaped**: questions of the kind the interviewer actually asks about Tony's employment stories, which this corpus cannot answer. **Clinically adjacent**: questions near Beta or near Tony's occupational therapy background that are not about Beta's engineering; for these, a Beta document returned by the reranked arm is a failure even when the other checks pass. One returned by cosine is reported as a finding about the path production runs today, not held against the reranker, whose job is to remove it. Tony reviews the labels before they gate anything. *(Revised 2026-09-24: the first version failed the bar on a Beta document from either arm, which would have blocked `enforce` over cosine's own leak; the live sweep showed cosine returning Beta rehab chunks for "How do you balance rest and training when coming back from an injury?" while the reranker returned nothing.)*
- **AC-14**: Every eval result records its rerank arm in its metadata, plus `RERANK_MODEL_ID` when the arm is not `off`, plus a per case count of rerank fall backs. A run with no arm recorded predates phase six and counts as `off`. The two places that compare runs treat the arm differently, on purpose. The **api scoreboard** reports a run of another arm than the baseline as not comparable: its delta is against the committed baseline, usually from another commit, and a number spanning two arms and two commits would credit the reranker with whatever else moved. The **publish loader** checks every recorded delta whenever the dataset and corpus hashes match, whatever the arm, because the enforce against off delta at one commit is exactly the number this phase publishes (migration step 6); and a different arm alone never excuses a missing delta, so a "not comparable" claim naming a twin on the same hashes is refused. An `enforce` run in which any search fell back, or whose scored cases do not all record a fall back count, is recorded, but is not eligible as a phase entry, because it measured a mix of two arms or cannot show that it did not. *(Revised 2026-09-24: the first version said the loader never compares runs whose arms differ. The pre deploy gate showed that reading let a regressed enforce run through twice, once as a "not comparable" claim and once as a false delta of 0.)*

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
- The cost profile makes the second stage viable at all. At about $0.0003 per search of ten candidates (roughly 7,000 input tokens at $0.042 per million, with output free), a judgement per candidate is affordable in a way a general purpose model is not. *(Corrected 2026-09-24: the first draft said three millionths of a dollar per call, 10 to 100 times too low.)*

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

Shadow mode plus an objective exit bar is what makes this a measurement rather than a preference. The twenty labelled queries exist, name their expected documents, and are already wired to a script that prints a comparable table. The bar is therefore checkable by a machine: the reranked arm must reach the expected document at least as often as `0.68` does, must beat it on at least one query, and must lose no labelled positive. That is a stronger standard than "the logs look right", and it is available at no build cost. *(Widened 2026-09-24: all twenty queries turned out to be ones the corpus answers, unlike the questions the eval and production actually ask, so the bar now also gates negatives and probes shaped like real questions, and adds an eval comparison of the two arms. See the Migration plan.)*

Failing open is the deliberate inverse of the credential check, and the contrast is the point. That check suppresses an answer when it cannot decide, because publishing a false claim about a healthcare credential is worse than serving a canned reply. Here the unavailable path costs a slightly less well grounded answer, and removing results the visitor would otherwise have seen would be a worse outcome than shipping today's behaviour. Same mechanism shape, opposite default, for a reason that is written down.

Option 5 deserves a direct answer, because it is the strongest argument against this spec and it was missing from the first draft. Reusing Haiku would remove the second vendor entirely, reuse a hardened code path, and rest on a measured tie rather than a hope. It loses on latency, and only on latency. Roughly 1.2 seconds against roughly 0.2, inside the tool loop, up to twice per turn, before the visitor sees a single token. Up to 2.4 seconds added to every turn that searches is not a grounding improvement, it is a worse product that happens to retrieve better. The cost shape matters too: judging ten candidates individually costs about $0.0003 a search with Jev and roughly twenty four times that at Haiku's input price (corrected 2026-09-24). If Jev's latency ever fails to hold under load, Option 5 is the fallback design and not a rewrite, because the two stage shape and the shadow gate are provider agnostic.

The reranker reads the question as well as the query because of what today's gate found. Both layers of the credential check read only the generated answer while the bait question carried the subject, so the likeliest reply to the question the guard existed for was never examined. A search query is a paraphrase the persona wrote; judging relevance against it alone optimises for the paraphrase rather than the question.

## Feature design

**Defined terms** (the cross check found the first of these asserted three times and never specified, which is the load bearing one):

- **The candidate set**: the result of the widened query, `RERANK_CANDIDATE_K = 10` at `RERANK_CANDIDATE_FLOOR = 0.40`, after `filterChunksForStory` has run over it. This is what the reranker judges, and nothing else.
- **The cosine selection**: what `off` returns, recomputed from the widened query without a second one. Take the widened query's results *before* the guard filter, keep those scoring at or above `MINIMUM_SIMILARITY (0.68)` in descending order, cap at `TOP_K (3)`, then run `filterChunksForStory` over what is left. This is what `off`, `shadow`, and every failure path return. The order is the point: the first version of this term filtered all ten first and then took three, which could promote a guard passing chunk ranked fourth or lower that `off` never fetches. Three independent audit passes found that on 2026-09-23 (revised 2026-09-24). The term rests on one assumption, that the index's top three out of ten equal its answer when asked for three. Under approximate nearest neighbour search (an index lookup that may trade exactness for speed) that is likely but not guaranteed, so the sweep measures it (AC-11). That assumption, with no second query, is why failing open costs nothing, and it is the reason the floor is lowered rather than removed.
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
| any failure, and `shadow` | what the caller receives | the cosine selection: the widened results' top three above 0.68, then `filterChunksForStory`, which is what `off` returns, with no second query |
| any search | the log line | mode, candidate count, kept count, duration, fell back, and in shadow the two document path lists (AC-9) |
| any search | spend | the reranker's own counter, not `dailyUsage.incrementOp` (AC-8) |
| any search | the guard counters on the retrieval log line | the cosine path's top three before the guard, compared by membership with the filtered candidate set, so `suppressed` and `allSuppressed` mean what they mean in `off` |
| an eval run | the rerank arm | the `--rerank` flag, default `off`; the eval workflow's manual dispatch passes it through as an input (AC-10) |
| an eval run | the recorded arm and model | the results metadata, filled from the flag and, for a non `off` arm, `RERANK_MODEL_ID` (AC-14) |
| an eval case | its rerank fall back count | `stats.rerankFallbacks` from the executor, surfaced through a new optional `onRetrievalStats` observer on `generateTurnPair`, called beside `logRetrieval`. The harness passes one; production passes none (AC-14) |
| a sweep run | the negatives verdict | the original ten negatives plus the AC-13 probe sets; a query counts as rejected when its selection is empty (AC-11) |
| a sweep run | the superset check | the narrow `search` result compared with the recomputed cosine selection, per labelled query (AC-11) |

**Key invariants**:
- `shadow` and every failure path return exactly what `off` returns for the same index results, subject to the top three assumption the sweep measures.
- No failure path returns fewer results than the cosine selection would have returned, and no provider response can end the process.
- The guard counters on the retrieval log line mean the same thing in every mode.
- An eval result always names its rerank arm. A published delta is checked whenever the hashes match, whatever the arm, and a different arm alone never excuses a missing one.
- The reranker never sees a chunk `filterChunksForStory` rejected.
- `off` is byte identical to today, including issuing no widened query.
- Nothing the reranker returns was absent from the candidate set; it selects and orders, it never generates.
- The query text and the chunk text are never logged.

**Security model**: unchanged, and narrower than it looks. The route stays public and anonymous with two validated scalars. The state sent to the reranker is the interviewer's question, the persona's search query, and a chunk of Tony's own committed documents. Every one of those is model generated or repo authored; no visitor typed content exists on this path, which is the same property spec 0013 relies on. The reranker cannot introduce text, so a compromised judgement changes which committed section is quoted, never what it says.

**Configuration required**:
- `TYPESAFE_API_KEY`: the provider key. Absent means the reranker is unconfigured and every search takes the cosine path.
- `RETRIEVAL_RERANK_MODE`: `off` (default) · `shadow` · `enforce`. Three states rather than a boolean, mirroring `BETA_OUTPUT_GUARD_MODE`, which already proved the shape in this repo. Change it in `render.yaml`, not only in the Render dashboard: `render.yaml` pins it as a value, and a Blueprint sync can reset a change made only in the dashboard.
- `--rerank off|shadow|enforce`: the eval harness's arm (AC-10), default `off`. An eval setting, not a production one.

**Critical test scenarios** (each maps to an acceptance criterion):
- Mode `off` issues no widened query and returns the same chunks as today, verifies **AC-1**, **AC-5**.
- Mode `shadow` returns the cosine selection while logging a different reranked one, verifies **AC-5**, **AC-9**.
- Mode `enforce` returns the reranked selection in score order, verifies **AC-4**, **AC-5**.
- A chunk `filterChunksForStory` rejects is never scored, verifies **AC-2**.
- A timeout, a provider error, and a malformed response each return the cosine selection and throw nothing, verifies **AC-6**.
- Two candidates clear the keep threshold and exactly two are returned, with no padding, verifies **AC-4**.
- One request carries one question per surviving candidate, verifies **AC-3**.
- The log line carries no query text and no chunk text, verifies **AC-9**.
- The sweep script prints both arms against the labelled queries and the probe sets side by side, verifies **AC-11**.
- When a top three chunk is guard rejected, `shadow` and a failing `enforce` search return exactly what `off` returns, verifies **AC-5**, **AC-6**.
- A provider that stalls its body after the headers falls back within the timeout and leaves the process alive, verifies **AC-6**.
- An answer above 1, below 0, or of the wrong type falls back, verifies **AC-6**.
- The eval defaults to `off`, records the arm, records the model id only for a non `off` arm, and runs the preflight only for a non `off` arm, verifies **AC-10**, **AC-14**.
- The publish loader checks a recorded delta across arms when the hashes match, refuses a "not comparable" claim naming a same hash twin of another arm, and reads a run with no arm as `off`; the api scoreboard reports a run of another arm than its baseline as not comparable, verifies **AC-14**.
- An `enforce` run with any fall back, or with a scored case that records no count, is recorded but is not eligible as a phase entry, verifies **AC-14**.
- The sweep prints the negatives bar, the Beta check (judging the reranked arm, with a cosine leak reported separately) and the superset check, and the probe sets are present and labelled, verifies **AC-11**, **AC-13**.
- The prompt loads from disk and no prompt text appears in a `.ts` file, verifies **AC-12**.

## Migration plan

**Strategy**: feature flagged, three modes, evidence gated.

**Phases**:
1. Ship with `RETRIEVAL_RERANK_MODE` unset, which is `off`. Nothing changes for a visitor. **Done 2026-09-24, #111.**
2. Build the 2026-09-24 update (Build plan tasks 11 to 17). It also ships `off`, so it changes nothing for a visitor either.
3. Set `shadow` on Render: `TYPESAFE_API_KEY` in the dashboard and `RETRIEVAL_RERANK_MODE: 'shadow'` in `render.yaml`, together, so the service restarts once. Shadow now decides nothing a visitor can see. Watch the disagreement rate and the fall back count.
4. **Sweep bar**, objective, printed by the sweep: the reranked arm reaches the expected document at least as often as cosine, beats it on at least one positive, loses no labelled positive, rejects at least as many negatives (the original ten plus the AC-13 probe sets), and returns no Beta document for a clinically adjacent probe. The superset check holds on every query, or its mismatches are understood and recorded here.
5. **Eval bar**, objective, at one commit: two full runs with `--rerank off` and two with `--rerank enforce`. Each pair's spread is its noise band, as spec 0011 AC-9 defines it (the per dimension spread between two identical full runs). `enforce` passes only if, on every dimension, its mean is no lower than `off`'s mean minus the larger of the two bands, and neither `enforce` run fell back on any search. Save the `off` pair as the baseline (`--save-baseline --noise-from <the other off run>`): that makes the same commit `off` run the one the publish loader checks the phase entry's delta against, where a baseline from another commit or corpus would leave it unchecked. This is the step that decides whether the grounding drop seen on 2026-09-24 belongs to the reranker; an 8 case `off` pull request eval on #112 also read grounding 0.88, an early hint, from a partial run, that the drop may not.
6. On passing both bars, set `enforce` and publish the phase entry with its delta against the `off` arm at the same commit, which the loader checks against the baseline saved in step 5. Below either bar, the phase stops at `shadow` or `off`, and this spec records why. Per the premise note, that is a legitimate outcome.

**Rollback**: set `RETRIEVAL_RERANK_MODE=off`, in `render.yaml` as well as the dashboard. No deploy needed, though changing an environment variable on Render restarts the service. Reverting the commit also works and is not faster.

**Risks**: the reranker could be worse than the threshold, which the sweep is there to catch before enforce. Latency could exceed budget under load, which the timeout bounds at `1500` ms per search and two searches per turn. The eval noise band could widen enough to hide a real delta, which step five of the plan would reveal and which is a finding worth publishing either way. The probe labels are hand written and could be wrong, which is why Tony reviews them before they gate. The eval bar costs four full runs per decision, about $2.30 at the $0.57 a run seen on 2026-09-24. Two runs per arm is a thin sample, so a result near the band's edge should be read as not yet decided, not as a pass.

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

Tasks 1 to 10 shipped in #111 (2026-09-24).

**The 2026-09-24 update**, Tracer Bullet again. The thin thread is one eval run recorded with its arm and compared against a run of the other arm; the sweep work thickens it after.

11. Make `shadow` and every fall back return what `off` returns. In `search-knowledge.ts`, compute the cosine selection as `filterChunksForStory(cosineSelection(wide))`, reusing the membership test the guard counters already use rather than a second guard pass, and keep the filtered candidate set as the reranker's input only. Update the `cosineSelection` comment in `vector-store.ts`. Satisfies **AC-5**, **AC-6**.
12. Give the eval harness its `--rerank` flag in `scripts/interview-eval/run.ts`, defaulting to `off` and replacing the forced `enforce`, and run the reranking preflight only for a non `off` arm. Pass it through a `workflow_dispatch` input in `.github/workflows/evals.yml`. Satisfies **AC-10**.
13. Record the arm, the model id for a non `off` arm, and each case's fall back count in the results: the metadata type in `eval/eval-types.ts`, the new optional `onRetrievalStats` observer on `generateTurnPair` in `conversation.service.ts`, and its use in `scripts/interview-eval/harness.ts`. Satisfies **AC-14**.
14. Extend the comparability rule in `apps/web/src/lib/evals.ts` to the arm, beside the corpus hash rule, reading a missing arm as `off`, and make an `enforce` run with any fall back ineligible as a phase entry. Show the arm on the scoreboard (`eval/scoreboard.ts`). Satisfies **AC-14**.
15. Add the agent and the model id to the rerank log line: the `RerankLogEntry` type and the `onRerank` call in `search-knowledge.ts`. Satisfies **AC-9**.
16. Add the AC-13 probe sets to `scripts/threshold-sweep.queries.ts`. Draft the story shaped probes from the stories in `apps/api/prisma/fixtures.ts` and the golden cases in `scripts/interview-eval/golden.ts`, and seed the clinically adjacent probes with the two the clinical auditor proposed ("How did you keep the Smith agent from giving unsafe answers?" and "How did your OT background shape your mentoring?"). Tony reviews every label before the set gates anything. Then extend `scripts/threshold-sweep.ts` with the negatives bar lines, the Beta check for clinically adjacent probes, and the superset check. Satisfies **AC-11**, **AC-13**.
17. Colocated mocked tests for every new critical test scenario, each landing with its task.

Tasks 11 to 17 shipped in #112 (2026-09-24). Its pre deploy gate changed task 14 as built: the arm does not excuse the loader from checking a delta (see AC-14).

18. Make the sweep's Beta check judge the reranked arm, and report a cosine leak separately as a finding about production. Satisfies **AC-13**.

## Consequences

**Positive**:
- Relevance becomes a judgement about meaning rather than a number that drifts with chunk boundaries, which removes the failure mode nobody noticed last time.
- Recall and precision stop sharing one dial, so catching a missed document no longer admits noise into every other query.
- The decision to enforce is gated on ground truth that already exists, at no extra build cost.
- The worst failure is today's behaviour, which is shipped and working.
- `shadow` is a clean observer, so its disagreement numbers compare the reranker with the path production actually runs.
- Every scoreboard number names its rerank arm and model, so a delta can be traced to what produced it.

**Negative / tradeoffs**:
- A second paid provider on the request path, early access, without a published service level agreement.
- Added latency inside the tool loop, up to two searches per turn, before the first token.
- Ranking becomes non deterministic where a cosine score was not, which is a new source of eval noise and is why phase four of the migration re establishes a band rather than assuming the old one holds.
- Two mechanisms where there was one, and a mode flag whose three states each need testing.
- Deciding `enforce` now costs four full eval runs at one commit, about $2.30 at today's rate, plus Tony's review of the probe labels.
- Pull request evals run `off` by default, so they no longer exercise the reranker. A change to reranking code is measured only when someone dispatches the eval with an arm.
- The widened query starts as soon as the mode is `shadow`, not when it reaches `enforce`, so the larger Upstash payload is paid throughout the measurement phase, before any evidence gated decision. That is the cost of measuring honestly, and it is bounded by the same daily Upstash quota retrieval already lives inside.

**Neutral**:
- No schema change, no new endpoint, no change to the visitor facing surface beyond which document the persona cites.
- The corpus hash keeps meaning exactly what it meant: which documents are in the index, not how they are ranked.

## Follow-up

- [ ] **Needs its own spec.** If the reranker beats the threshold decisively, revisit whether `MINIMUM_SIMILARITY` earns its place at all. Deleting it is Option 3, the argument for keeping it is sequencing rather than merit, and the evidence exists only after real running time. It is a separate decision with its own blast radius, not a task inside this phase's build plan.
- [x] The corpus hash pins which documents are indexed and says nothing about ranking. Consider whether a published phase entry should also record the reranker's model id, so a scoreboard number names every input that produced it. *Decided 2026-09-24: yes, with the arm (AC-14).*
- [ ] `RERANK_KEEP_THRESHOLD` is a tuned number of the same species as the one this phase exists to replace. It is gentler, because a wrong cut costs a chunk rather than silently drifting, but it should be swept rather than assumed, and the sweep script is the place.
- [ ] Spec 0013's parked Jev harness (`apps/api/scripts/jev-spike/`) names four conditions that would re open it. If this phase enforces, one of them has been met in a different surface and that README should say so rather than reading as though Jev was rejected outright.
- [ ] **Needs its own spec.** A `tony.md` rule for Beta clinical material, from the clinical auditor's should consider on 2026-09-23: describe Beta as software, never give an exercise, dose, timeline or symptom rule as guidance, and never speak as a clinician. A prompt change moves the eval, so it is its own measured change, kept out of this phase so it cannot confound the comparison of the two arms.
- [ ] The calibration table above `MINIMUM_SIMILARITY` in `vector-store.ts` still describes the 607 chunk index. Refresh it from the sweep against the index that ships.
- [ ] Report the stall to TypeSafe: a body that stalls after its headers leaves an unhandled rejection inside `@typesafe-ai/sdk` 0.6.0, which ended the process until `bufferedFetch` was added in #111. Remove `bufferedFetch` once the SDK is fixed.
- [ ] A mid run fall back in `enforce` is recorded (AC-14) but does not fail the case. Whether a strict eval should fail on it, as it does on a retrieval failure, is open.
- [ ] Hardening items the 2026-09-23 gate rated LOW: `RerankResult.cause` is bounded only on the log line, not where it is built; timeout and retry are configured in two places; a mistyped mode reads as `off` with no warning; the API key is not trimmed; `onRerank` runs inside the search's try; the sweep's fall back warning describes the wrong column; the sweep label hardcodes 3; index rows with no source path break the guard counters' top three assumption.
- [ ] Let a phase entry name the run its delta is measured against, so a cross arm delta is checked against that run directly rather than depending on the baseline saved in migration step 5. Converged finding of two independent passes in #112's gate.
- [ ] The public evals page marks rows comparable on the dataset hash alone (`isComparable`), ignoring the rerank arm and the corpus hash.
- [ ] Tighten eligibility beyond hand edits: an `off` run must record zero fall backs and no `rerankModel`, and `rerankModel` should count toward comparability. A relabelled mixed run passes today, at the same trust level as any other hand edit.
- [ ] Runs made between #111 and #112 forced `enforce` but record no arm, so they read as `off`. None are committed; any that are later must be relabelled or dropped.
- [ ] Pull request evals default to `off`. Tie that default to the arm `render.yaml` runs before production moves off `off`, or a pull request eval will measure the arm production does not run.
- [ ] The sweep's bar logic has no unit tests (scripts are not collected), and the three arm values are written out in five places.
- [ ] Tony: review the twelve probe labels, then set `PROBES_REVIEWED`. The Smith probe is the debatable one: the reranker kept the credential check spec, which does describe guarding an AI's answers, just not Smith's.
