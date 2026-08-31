# 0012 child. searchPortfolio retrieval (phase three)

**Date**: 2026-08-31

## Summary

Phase three gives the Tony persona a search tool over Tony's own committed engineering documents: the specs, the child specs, the findings, and the eval writeups already in this repo. The model decides when to call it, gets back three heading sized sections with the file each came from, and names that document in its answer. The documents are embedded into a hosted vector index (a database that finds text by meaning rather than by keyword) by a script Tony runs deliberately, and the set of documents that went in is hashed and committed, so a score can never quietly depend on an index nobody can reconstruct. Nothing new is written to the database, no new HTTP endpoint is added, and the conversation surface is unchanged apart from the persona now citing where a claim came from.

## Inline rationale

> Premise note, worth reading before the design. This phase was scoped by the umbrella to fix a measured problem, the model inventing technical rationale it was never given, seen twice on the Topstep story. **Retrieval as designed here cannot fix that**, and the spec says so rather than implying otherwise. Every one of the 22 eval stories is employment work (Mailchimp, Product Forge, Topstep, Tensure, Fugue) and none of it lives in a repo Tony owns. A corpus of his own specs has nothing to say about a data model he built at Topstep. Grounding those stories would need Tony to author writeups about employment work, which is a writing project he declined, and which carries a judgement about what is his to publish on every document. The embellishment finding names a cheaper remedy for that problem, a prompt rule against unsourced technical rationale, and it should be taken on its own rather than folded in here.

What retrieval can honestly do is different and still worth building. The story fixtures describe what Tony built at work. They say nothing about how he works: how he specs a decision, what he does when a guard keeps breaking, why a feature was rejected, what a measurement actually showed. Those are real interview questions, the current simulator cannot answer any of them, and the answers are sitting in this repo as committed documents. That is the capability this phase adds.

The corpus was scoped to the decisions and the measurements, and deliberately excludes the nine `rationale.md` files. Those record options that were weighed and rejected. A retrieved passage from one reads exactly like a current decision when it is the opposite, and a model that quotes a rejected option as though it were chosen is a new way to be confidently wrong. That is the same shape as the embellishment problem, so it is designed out rather than mitigated.

Upstash Vector was chosen because the course lesson this phase applies uses it, and because it hosts the embedding model itself: the SDK takes raw text on both write and read, so there is no second AI provider and no third credential. That matters here more than usual. This repo already splits providers per surface in a way that has caused real confusion (Beta on the direct Anthropic API, the conversation on Bedrock), and adding an embedding provider would deepen a split that is already the most misunderstood thing in `apps/api`.

The measurement design carries one thing the course does not need. The eval already hashes the golden case set, so two runs are comparable only when they scored the same cases. Retrieval adds a second input, the contents of the index, and two runs over different corpora are no more comparable than two runs over different cases. So the corpus is hashed the same way and recorded beside the dataset hash, and the eval refuses to run when the committed documents no longer match the manifest. Without that, the index becomes an untracked variable in every future delta, which is precisely the unreproducible baseline this project spent 2026-08-31 correcting.

## Requirements

**User stories**:
- As an engineer evaluating Tony, I want to ask how he approaches a problem and get an answer drawn from his actual specs, so that I learn how he thinks rather than only what he shipped.
- As an engineer who does not trust a confident answer, I want the persona to name the document a claim came from, so that I can open it and check.
- As Tony, I want a retrieval score to be comparable to the last one only when the corpus really was the same, so that the scoreboard cannot drift on an input nobody recorded.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: A corpus manifest at `docs/evals/interview/corpus.json` lists exactly the documents embedded, selected by this glob and nothing looser:
  - `docs/specs/**/index.md`
  - `docs/specs/**/[0-9][0-9][0-9][0-9]-*.md` (child specs)
  - `docs/specs/**/verify.md`
  - `docs/specs/**/findings/*.md`
  - `docs/evals/interview/*.md`, excluding `README.md`

  It excludes every `rationale.md` (rejected options must never be retrievable as decisions), `README.md` (it is instructions for running the suite, not a record of thinking), and everything under `docs/evals/interview/results/` plus the `.json` files there, which are data rather than writing. The manifest records, per document, its repo relative path and a content hash, plus a single `corpusHash` over the whole set, the chunk count, and the date the embed script last ran. The per document hash exists for exactly one purpose, so AC-12's refusal can name which documents changed; comparability is carried by `corpusHash` alone.

  Note one consequence, named rather than discovered later: `findings/2026-08-31-grounding-embellishment.md` is in the corpus, so the persona can retrieve and cite the finding that says retrieval does not fix embellishment. That is correct and is left in.
- **AC-2**: Documents are split into chunks at markdown heading boundaries. A chunk carries its own heading text, its `headingPath` (the chain of parent headings above it, joined, so a chunk under `## Requirements` in a spec reads with that context), and the source document's repo relative path. Text appearing before the first heading in a file becomes its own chunk with the document title as its heading.

  A chunk longer than **2000 characters** is split further at paragraph boundaries. A single paragraph longer than 2000 characters is emitted whole rather than split mid sentence, and the embed script prints it so the oversized document can be fixed at the source.
- **AC-3**: An embed script, run deliberately by Tony and never automatically, reads the corpus, writes every chunk to the Upstash index, rewrites `corpus.json`, and prints what changed. It is the only thing that writes to the index.

  The write is a **full replace**, not an incremental upsert: the script clears the index namespace it owns and writes the whole corpus fresh. Upsert alone would leave vectors from deleted documents and from chunks whose boundaries moved, and those ghosts are invisible to AC-12, which recomputes over the documents that exist now and never sees what is actually in the index.

  `corpus.json` is rewritten **only after every write in the batch succeeds**. A partial failure leaves the previous manifest in place. That direction is deliberate: an under claiming manifest fails AC-12 loudly on the next run, while an over claiming one would certify an index state that never existed and quietly defeat the whole check.
- **AC-4**: `searchKnowledge` is exposed to the Tony persona generation as a model callable tool, wired inside `ConversationService.generateTurnPair` so the eval harness exercises the same path production does. The interviewer generation does not receive it.
- **AC-5**: One call returns at most three chunks. Each result carries the chunk text, its heading, and its source document path. The text is already bounded by AC-2's 2000 character chunk cap and is returned whole; there is no second truncation. Nothing else about the index reaches the model.

  A result whose similarity score is below **0.7** is dropped before returning, so a query with no real match returns fewer than three results or none at all rather than the three least bad vectors in the index. That threshold is a starting value to calibrate against the real corpus during build, and the calibrated number replaces it here.
- **AC-6**: When the answer uses a retrieved chunk, it names the source document in natural language (for example, "that is written up in my spec on the eval suite"). The persona never presents retrieved material as recalled from memory. The prompt does the path to name mapping; code passes the raw `sourcePath` and does not prettify it.

  When an answer draws on chunks from more than one document, attribution is **per claim**, not one blended citation for the whole answer. The eval scorer expectation added in the build plan checks that specifically: an answer using two sources and citing one is a failure, not a partial pass.
- **AC-7**: `searchKnowledge` may be called at most **twice per turn**, capped in code and not by prompt instruction. The counter is a variable local to one `generateTurnPair` invocation and resets every turn; nothing about it is persisted or carried across turns or requests. A third call returns a result saying no further searches are available, and the turn completes normally.
- **AC-8**: In production, a retrieval failure (the index unreachable, an error, or no useful match) never fails the turn and is never mentioned to the visitor. The persona answers from the story alone. Every failure is logged with its cause.
- **AC-9**: In an eval run, a retrieval failure fails the run loudly. A run must never silently become a non retrieval run and report scores as though nothing changed.

  "Retrieval failure" means precisely this: a `searchKnowledge` call was attempted and threw, or reported the index unreachable. A turn where the model simply chose not to search is **not** a failure and needs no handling; that is the design working. An empty result set after the AC-5 threshold is also not a failure, it is a normal outcome the persona handles per AC-8.
- **AC-10**: The runtime uses an Upstash read only token. The write token exists only where the embed script runs and is never present in the deployed API's environment.
- **AC-11**: Each results file records the `corpusHash` in `meta`, beside the existing `datasetHash`. Two runs are comparable only when both hashes match, and the publish loader in `apps/web/src/lib/evals.ts` enforces that the same way it already enforces the dataset hash.

  The hash is specified, not left to the build. A document's content hash is SHA-256 over its **raw file bytes**, deliberately not over its chunked output, so the hash does not change when the chunker's cap or splitting rule changes. `corpusHash` is SHA-256 over `stableStringify` of the `{ path, hash }` array sorted by path, reusing the existing helper in `apps/api/src/modules/conversation/eval/dataset-hash.ts` rather than writing a second one. The embed script and the eval runner call the same function.
- **AC-12**: Before a run, the eval recomputes the corpus hash from the committed documents and refuses to run when it disagrees with `corpus.json`, naming the documents that changed (this is what the per document hashes are for). A stale index is a refusal, not a silent difference. A document matched by the AC-1 glob that cannot be read is a hard failure of the embed script, never a silent omission from the corpus.
- **AC-13**: No visitor content and no retrieval query text is written to any log or database, holding the umbrella's AC-4. Retrieval logging records the fact of a call, the result count, the latency, and the source paths returned, never the query.

  One thing this criterion does not cover and should be honest about: query text leaves the process and reaches Upstash, which embeds it server side and handles it under its own retention policy. Nothing in this repo controls that. Before build, Upstash's data handling terms for query text are read and the finding recorded here; if they are unacceptable, the design changes rather than the criterion.
- **AC-14**: **Four to six** golden cases are added that ask about Tony's own projects and process, the questions retrieval can actually answer: how he specs a decision, what he does when a guard keeps breaking, why a feature was rejected, what a measurement actually showed. At least one is written to reliably trigger a search, so a suite run exercises the retrieval path rather than passing AC-9 vacuously by never calling the tool.

  They are scored on the **existing three dimensions**, and attribution correctness folds into `grounding`'s judge rubric. No fourth score column is added: `baseline.json`, `scoreboard.md`, the noise band, and the publish loader are all built around three dimensions, and a fourth ripples further than this phase should reach.

  The dataset hash changes, so the suite re baselines per spec 0011 AC-9 and the move is recorded in the baseline history with its reason.
- **AC-15**: A full eval run lands before and after the change per the umbrella's AC-1, and the phase writeup names which course principles were applied and which were skipped per the umbrella's AC-2.

## Options considered

### Option 1: Always inject a relevant document section into the prompt

Search on the current story and question before generation, put the best match in the context, no tool call.

**Pros**:
- One model call per turn, so no extra latency or cost from a second generation.
- Deterministic: the same question always retrieves the same material, which is easier to measure.

**Cons**:
- Pays retrieval on every turn whether the question needs it or not, and most turns do not.
- The model cannot follow up on what it finds, which is the main thing retrieval is for.
- Diverges from the course lesson this phase exists to apply, which builds retrieval as a tool.

### Option 2: A model called tool over a hosted vector index (chosen)

`searchKnowledge` is offered to the Tony generation. The model decides when to search, gets three heading sized chunks with their sources, and cites the document it used.

**Pros**:
- The decision to search is observable in the eval record, so it can be measured rather than assumed.
- Costs nothing on turns that do not need it.
- Matches the course's lesson 08 shape exactly, which is the point of the phase.
- Source paths come back with the chunks, which is what makes attribution possible at all.

**Cons**:
- A tool call is a second generation, which is the real cost, and it adds latency to a streamed turn.
- The model may not call the tool when it should, which is a failure mode injection does not have.
- For a corpus this small, the technical case over Option 1 is not overwhelming. Said plainly: the tool shape is chosen partly because exercising the tool call pattern is the point of the course ladder, and the umbrella's product is the measured progression itself. That is a legitimate reason here, and it should be stated rather than dressed up as a purely technical win.

### Option 2a: the same design, but anchored on a git commit rather than a corpus hash

Everything in Option 2, except that reproducibility is tracked by recording the commit the docs tree was at when the embed script ran, instead of hashing the corpus.

**Pros**:
- Reaches for a primitive that already exists rather than building a second hash pipeline, which is the standing preference in this repo and the instinct that deleted 355 lines of home grown path handling the same week.
- Nothing to keep in step between two implementations, since git computes it.

**Cons**:
- A commit says when, not what. Embedding from a tree with uncommitted edits, which is the normal state mid work, records a commit that does not describe the corpus that was actually indexed. That is precisely the failure this project spent 2026-08-31 correcting on the baseline.
- It cannot name which document changed, so AC-12's refusal would say the corpus moved without saying where, which is the difference between an actionable refusal and an annoying one.
- The eval already hashes its other input the same way, so a commit here would make the two inputs to one comparison decision use two different mechanisms.

Rejected, but only after weighing it: the deciding fact is that a commit cannot describe an uncommitted tree, and the embed script is run by hand mid work exactly when that is true.

### Option 3: Retrieval over authored writeups of the employment work

Build the same machinery, but over documents Tony writes about the Mailchimp, Product Forge, and Topstep work, so it can ground the existing eval stories.

**Pros**:
- The only option that can move the two grounding cases the umbrella pointed this phase at.
- Grounds the majority of the corpus, since almost every story is employment work.

**Cons**:
- It is a writing project, which Tony declined, and the writing is the whole cost.
- Every document needs a judgement about what is his to publish rather than the client's, which is a slow and error prone gate on a public repo.
- Nothing can be built until the writing exists, so the phase would stall on an unrelated task.

## Decision

**Chosen option**: Option 2: a model called tool over a hosted vector index of the decision documents

Retrieval is exposed as a tool the Tony persona calls on demand, backed by an Upstash Vector index built from Tony's committed specs, findings, and eval writeups, with the corpus hashed and recorded so every measurement stays reproducible.

**Implementation skills**: `upstash` (`upstash/skills`, `.claude/skills/upstash/`) · `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

The `upstash` skill was installed for this phase and covers the Vector SDK, including the behaviour that is easiest to get wrong from memory: with a hosted embedding model, `upsert` and `query` take raw text rather than vectors. Four general RAG skills were found and deliberately declined (`langchain-ai/langchain-skills@langchain-rag`, and `embedding-strategies`, `rag-implementation`, `similarity-search-patterns`, `hybrid-search-implementation` from `wshobson/agents`): they describe LangChain loaders, OpenAI embeddings, choosing an embedding model, and hybrid keyword search, none of which this design uses.

## Feature design

**Data model sketch**:

No Prisma schema change and no migration. Retrieval adds no table, no column, and no row. Two artifacts exist outside the database:

| Artifact | Where | Shape | Written by |
|---|---|---|---|
| Vector index | Upstash, hosted | chunk id, embedded text, metadata (`sourcePath`, `heading`, `headingPath`) | the embed script only |
| Corpus manifest | `docs/evals/interview/corpus.json`, committed | `corpusHash`, `chunkCount`, `embeddedAt`, and per document `{ path, hash }` | the embed script only |

**State transitions**: none. The index has no lifecycle beyond being rebuilt wholesale by the embed script.

**API surface**:

No new HTTP endpoint. `/conversation/turn` is unchanged in shape, per the umbrella's AC-5. The new surface is one model callable tool and one command.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `searchKnowledge` | model tool, Tony generation only | `query: string` (req) | up to 3 × `{ text, heading, sourcePath }` | n/a, internal to generation | index unreachable (degrade in production, fail in eval), cap exceeded (returns a no further searches result) |
| `npm run embed:corpus` | CLI, run by Tony | none | rewritten `corpus.json`, upserted index, a printed diff | local only, needs the write token | corpus file unreadable, Upstash write rejected |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `searchKnowledge` | chunk text | Upstash query result, embedded from the committed document |
| `searchKnowledge` | `heading`, `headingPath` | chunk metadata, set by the embed script at upsert time from the markdown structure |
| `searchKnowledge` | `sourcePath` | chunk metadata, the repo relative path of the document the chunk came from |
| persona answer | the document name spoken in the answer | derived from `sourcePath` by the Tony prompt, which is given the path and told to name it naturally |
| eval results file | `meta.corpusHash` | read from the committed `corpus.json` by the eval runner |
| eval preflight | the recomputed corpus hash to compare against | computed by the runner from the committed documents named in `corpus.json`, using the same hash function as the embed script |
| eval results file | `meta.datasetHash` | unchanged, existing `hashDataset` over the golden cases |
| publish loader | comparability of two published runs | both `datasetHash` and `corpusHash` equal, enforced in `apps/web/src/lib/evals.ts` |

**Key invariants**:
- The index contents always correspond to the documents named in `corpus.json`. The eval enforces this by recomputing the hash and refusing on a mismatch (AC-12); nothing else can detect drift.
- Only the embed script writes to the index. The deployed API physically cannot, because it holds a read only token (AC-10).
- No `rationale.md` is ever embedded. A rejected option must never be retrievable as though it were a decision.
- A retrieval failure changes what the visitor is told (nothing) but never whether the turn succeeds; in the eval it changes whether the run happens at all.

**Security model**:

The conversation endpoint stays public and unauthenticated, rate limited as it already is. Retrieval adds no new authorization surface because it exposes no new data: every document in the corpus is already public in a public repo, so a retrieved passage reveals nothing a visitor could not read directly.

Two things are worth naming. First, query text leaves the process and reaches Upstash, which embeds it server side. Today that text is model generated from the story and the conversation, and visitors cannot type free text at all (the umbrella's AC-4 holds until phase five deliberately decides screening). When phase five ships, this becomes a real trust boundary question and must be re examined there. Second, the write credential is the one thing that could corrupt the corpus, so it never enters the deployed environment.

**Configuration required**:
- `UPSTASH_VECTOR_REST_URL`: the index endpoint. Present in the API environment and locally.
- `UPSTASH_VECTOR_REST_TOKEN`: a **read only** token, used by the running API and by the eval harness.
- `UPSTASH_VECTOR_REST_TOKEN_WRITE`: the write token, present only where the embed script runs (Tony's machine). Never set on Render.

Prerequisite before coding: create the Upstash Vector index and choose its embedding model in the Upstash dashboard, since the model is fixed at index creation and changing it later means re embedding the whole corpus.

**Critical test scenarios**:
- Happy path: a question about how Tony specs a decision triggers one `searchKnowledge` call, three chunks come back, and the answer names the source document, verifies AC-4, AC-5, AC-6.
- Failure case: Upstash is unreachable during a production turn; the visitor gets a story grounded answer with no error and the failure is logged, verifies AC-8. The same failure during an eval run aborts the run, verifies AC-9.
- Reproducibility: a document is edited without re running the embed script; the eval refuses to start and names the changed file, verifies AC-12.
- Cap: a turn where the model tries to search three times gets a no further searches result on the third and still completes, verifies AC-7.
- Corpus boundary: no chunk in the index has a `sourcePath` ending in `rationale.md`, verifies AC-1.

## Build plan

Ordered as a Tracer Bullet, a thin thread through every layer first, then thickened. No build approach is recorded in `AGENTS.md`, so this is the reasoned default and the assumption is noted in Follow-up.

1. Create the Upstash index and choose its embedding model; add the three environment variables locally and the read only token on Render. Prerequisite for everything below.
2. **The thread.** Embed a handful of documents by hand, add a minimal vector store wrapper and a `searchKnowledge` tool, wire it into `ConversationService.generateTurnPair` for the Tony generation only, and confirm one real conversation retrieves a chunk and names its source. Satisfies AC-4, AC-5 in thin form.
3. Thicken the corpus: the real document selection, heading based chunking with the length cap, and the embed script that upserts everything and writes `corpus.json`. Satisfies AC-1, AC-2, AC-3.
4. Attribution: teach the Tony prompt to name the source document naturally, and add the eval scorer expectation that a retrieved claim is attributed. Satisfies AC-6.
5. Guards: the per turn cap in code, the production degrade path, the logging fields, and the read only token check. Satisfies AC-7, AC-8, AC-10, AC-13.
6. Eval integration: real retrieval in the harness with a loud failure, `corpusHash` in the results meta, the staleness recompute and refusal, and the comparability rule in the publish loader. Satisfies AC-9, AC-11, AC-12.
7. New golden cases about Tony's own projects and process; run the suite, re baseline per 0011 AC-9, and record the move with its reason. Satisfies AC-14.
8. Full run before and after, the phase writeup naming applied and skipped course principles, and the manifest entry that publishes it. Satisfies AC-15.

## Consequences

**Positive**:
- The simulator can answer how Tony works, not only what he shipped, from documents that already exist and cost nothing to write.
- Attribution makes a claim checkable, which is the argument the whole 0012 umbrella is making, applied to the conversation itself rather than to a page about it.
- The corpus hash closes a reproducibility hole before it opens, rather than after a baseline has already been poisoned by it.
- The phase applies course lesson 08 faithfully, including the tool shape, which is the stated purpose of the ladder.

**Negative / tradeoffs**:
- It does not fix the embellishment finding, and the umbrella currently implies it will. That expectation has to be corrected in the umbrella rather than quietly left.
- A tool call is a second generation, so a turn that searches costs roughly twice as much and takes noticeably longer on a streamed response.
- The eval now depends on a third party free tier. A hard failure is the right behaviour, but it means Upstash being down blocks a measurement.
- A new credential pair to manage, and an index whose embedding model cannot be changed without re embedding everything.
- Query text reaches a third party that retains it under its own policy, which nothing here controls. AC-13 requires that policy be read before build rather than assumed acceptable.
- The full replace in AC-3 makes every embed run rewrite the whole index rather than the changed part. At this corpus size that is seconds; it would need revisiting long before the corpus reached thousands of documents.
- The manual embed script will be forgotten at some point. AC-12 turns that into a loud refusal rather than a wrong number, which is the best available outcome but is still friction.

**Neutral**:
- No schema change, no migration, no new endpoint. The deployment story is two environment variables.
- The corpus grows on its own as specs are written, so the thing that makes retrieval more useful over time is work that was happening anyway.
- Phase four's steering design assumed a story tagged suggestion. Retrieval changes what material an answer can draw on, so that assumption needs the re check the umbrella's rationale already flags.

## Follow-up

- [ ] Calibrate the AC-5 similarity threshold against the real corpus during build and replace the 0.7 starting value in this spec with the measured one.
- [ ] Correct the umbrella's phase three line: retrieval cannot ground the employment stories, and the embellishment finding needs its own remedy.
- [ ] Take the finding's cheaper remedy separately: a prompt rule against unsourced technical rationale, measured against `edge-bait-profile-momentum` and `hard-profile-data-model`.
- [ ] No build approach is recorded in `AGENTS.md`; this plan assumes Tracer Bullet. Record the project default or correct this ordering.
- [ ] Re check phase four's settled steering decisions against this design, specifically what a story tagged suggestion means once answers can draw on retrieved documents.
- [ ] Decide whether the evals page should render the corpus manifest, so a reader can see which document set produced a score.
- [ ] Optional, not now: the official `@upstash/mcp-server` would give an agent live access to the real index, which helps when debugging why a retrieval returned nothing. Connecting an MCP server is a user config step. Its Vector support is mentioned in Upstash's docs but was not confirmed during discovery, so check that first.
- [ ] `/sync` or `/audit` should add the `upstash` skill to the `## Agent skills` section of `apps/api/AGENTS.md` (it governs one area, not the whole repo), and record the four declined RAG skills on that section's `Declined:` line so they are not offered again.

## References

**Project sources**:
- `~/source/ai-engineering-fundamentals`, lesson 08 (RAG): the three patterns framing (context, tool, RAG), the `searchKnowledge` tool shape, and the Upstash Vector choice including its hosted embedding.
- Spec 0011, interview simulator eval suite: the dataset hash and comparability rules this phase extends to the corpus.
- Spec 0012 umbrella: AC-3 (owned content only), AC-4 (no visitor content persisted), AC-5 (one conversation engine).
- `docs/specs/_root/0012-grounded-portfolio-agent/findings/2026-08-31-grounding-embellishment.md`: the measured problem this phase was pointed at, and why it is not the right remedy for it.
- `apps/api/AGENTS.md`: the per surface AI provider split, which is why avoiding a second provider matters here.

**Practices and standards**:
- Retrieval as a model called tool rather than always on context injection.
- Hashing every input a measurement depends on, so comparability is checkable rather than assumed.
- Least privilege credentials: a read only token at runtime, the write token only where writes happen.
