# Verify: grounded portfolio agent, phase one · spec 0012 · updated 2026-08-30
_Steps derived from the [context engineering pass](0012-context-engineering-pass.md) acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Start a conversation, advance through three exchanges, and confirm each question and answer reads as a continuation rather than a restart → AC-3
- [ ] With the network tab open, advance a turn and confirm the request body is exactly `{ topicId, conversationId }` and carries no transcript → AC-3
- [ ] Advance to the fifth exchange and confirm the wrap-up question and closing answer still arrive → AC-5
- [ ] Confirm the interviewer's later questions reference the topic's other work by name, and that no such reference asserts a detail beyond a title → AC-2

## Commands

- [ ] `curl -sS -X POST $API/conversation/turn -H 'content-type: application/json' -d '{"topicId":"<slug>","history":[{"role":"tony","text":"x"}]}'` → 400 naming `history`, and no model call is made → AC-3, AC-5
- [ ] `curl -sS -X POST $API/conversation/turn -H 'content-type: application/json' -d '{"topicId":"<slug>","conversationId":"<a fresh uuid never persisted>"}'` → streams a normal opening turn at turnIndex 0, exactly as omitting the field does → AC-3
- [ ] `npm test --workspace=apps/api` → the loadHistory ordering, placeholder-skip, and catalog assembly specs pass → AC-1, AC-2, AC-3
- [ ] `grep -c . apps/api/src/modules/conversation/skills/interviewer.md` and the same for `tony.md` → both files still hold the prompt text; no prompt string has moved into a `.ts` file → AC-1
- [ ] Read `tony.md` and confirm the ownership distinctions, the hedge-rather-than-guess rule, and all three never-claim entries (Linear, Google Docs, any Product Forge number) are present → AC-1
- [ ] `npm run eval:interview --workspace=apps/api` → dataset hash matches the baseline, and the scoreboard reports the delta against it → AC-4

## Value sourcing

One step per row of the spec's Value sourcing table, exercising each value's source at the edge where a wrong source shows.

- [ ] **History**: hold two conversations at once in separate tabs, advance both, and confirm neither transcript leaks into the other's prompts. The source is the row set for one `conversationId`, so a missing filter shows here → AC-3
- [ ] **History ordering**: after two exchanges, inspect the persisted rows and confirm the prompt's prior-conversation block runs interviewer, Tony, interviewer, Tony. Sorting is done in code, so a wrong sort shows as a swapped pair, not an error → AC-3
- [ ] **History, mid-generation**: while a turn is streaming, start a second request on the same conversation and confirm the empty reserved interviewer row never appears in a prompt as a blank turn → AC-3
- [ ] **Story catalog**: pick a topic with exactly one story and confirm the interviewer message says the topic has one story rather than rendering an empty list → AC-2
- [ ] **Story catalog**: confirm the grounding story is not also listed in the catalog above it, which would present one story as two → AC-2
- [ ] **Grounding story**: advance past the story count for a topic and confirm the cycle wraps to the first story, unchanged from before this phase → AC-5
- [ ] **Token count**: run one turn pair and confirm the persisted `tokenCount` includes the cached system prefix (on the order of thousands, not tens), so the daily spend backstop counts what the model actually processed → AC-5

## Acceptance-criteria coverage

- AC-1 — prompt restructure: covered by the two file-level steps and the `tony.md` content read
- AC-2 — story catalog: covered by the manual reference check and the two catalog value-sourcing steps
- AC-3 — server-rebuilt history: covered by the contract 400, the unknown-uuid step, and the four history value-sourcing steps
- AC-4 — measured against the baseline: covered by the eval run step; recorded in [docs/evals/interview/0012-phase-one-context-engineering.md](../../../evals/interview/0012-phase-one-context-engineering.md)
- AC-5 — nothing else moves: covered by the fifth-exchange step, the grounding-story cycle step, and the token-count step

---

# Verify: grounded portfolio agent, phase six · spec 0012 · updated 2026-09-22
_Steps derived from the [retrieval reranking](0012-retrieval-reranking.md) acceptance criteria. `/check` runs these._

## Commands

- [x] `npm test --workspace=apps/api` → the reranker, prompt loader and executor suites pass → AC-1 to AC-9
- [ ] `npm run check:corpus --workspace=apps/api` → passes. **Red until the corpus is re embedded**, because this phase added a spec document → blocks the PR
- [x] `npm run sweep:threshold --workspace=apps/api` with `TYPESAFE_API_KEY` set → prints the cosine and reranked arms side by side, then the three exit bar lines → AC-11
- [x] `npm run build --workspace=apps/api && node -e "import('./dist/modules/conversation/retrieval/rerank-prompt.js').then(m => console.log(m.loadRerankPrompt()))"` from `apps/api` → three non empty sections → AC-12
- [x] `grep -rn "$(sed -n '/^## Task/,/^## /p' apps/api/src/modules/conversation/retrieval/skills/rerank.md | sed -n '3p')" apps/api/src --include=*.ts` → no match, so no prompt text lives in TypeScript → AC-12

## Staged rollout (the spec's migration plan, in order)

- [x] `RETRIEVAL_RERANK_MODE` unset → run a turn that searches → no `rerank` log line, and the Upstash request asks for `topK: 3` not `10` → AC-1, AC-5
- [x] Set `RETRIEVAL_RERANK_MODE=shadow` on Render → run a turn that searches → one `rerank` line per search carrying `cosinePaths` and `rerankedPaths`, and the answer still cites a cosine chosen document → AC-5, AC-9
- [x] Read a shadow `rerank` line → it carries no query text and no chunk text, only counts and repo file paths → AC-9
- [ ] Watch the shadow disagreement rate across a day → the two path lists differ often enough to be worth enforcing → migration step 2
- [x] Run the sweep's reranked arm → all three exit bar lines read PASS before going further → migration step 3
- [x] Set `RETRIEVAL_RERANK_MODE=enforce` → a turn returns the reranked selection in rerank order, capped at three, with no padding → AC-4, AC-5
- [ ] Two full eval passes at the same commit → a noise band, then publish the phase entry with its delta → migration step 4
- [x] Rollback drill: set `RETRIEVAL_RERANK_MODE=off` → next turn behaves exactly as before the phase → migration rollback

## Failure paths (each must cost a weaker answer, never a turn)

- [x] Unset `TYPESAFE_API_KEY` with mode `enforce` → answers still cite documents, `rerank` line reads `fellBack: true, cause: "reranker not configured"` → AC-6
- [x] Point `TYPESAFE_BASE_URL` at an unroutable host **before the first rerank call of the process** (the client is built once per process, so setting it later is ignored, which produced a false pass on 2026-09-23) → the search completes within ~1.5s and falls back, and the turn is not lost → AC-6
- [x] Confirm exactly one Upstash query is issued on a fall back, not two → the widened set is a superset, so the cosine selection needs no second round trip → AC-6

## Value sourcing (one step per row of the spec's table)

- [x] mode: set `RETRIEVAL_RERANK_MODE` to `ENFORCE` (wrong case) and to `on` → both read as `off` rather than throwing → AC-5
- [x] provider configured: the key presence check alone decides, and a missing key never throws out of the executor → AC-6
- [x] candidate count and floor: with mode on, the Upstash request carries `topK: 10`; nothing scoring under `0.40` reaches the reranker → AC-1
- [ ] which chunks may be shown: a chunk the ownership guard rejects is never sent to the reranker, checked against a guard tripping section → AC-2
- [x] the shared state: it carries `interviewerQuestion` and `searchQuery` as separate named fields, and the question is what was actually asked rather than the persona's paraphrase → AC-3
- [ ] the per candidate question: each candidate's section rides in its own question's instructions, never in the shared state → AC-3
- [x] the model: the request pins `jev-1.13.0`; setting `TYPESAFE_DEFAULT_MODEL` does not move it → AC-7
- [ ] the cut: a candidate scoring exactly `0.5` is kept; `0.49` is not → AC-4
- [x] spend: reranker tokens appear on the `rerank` log line and the day's `dailyUsageCounter` token total is unchanged by them → AC-8

## Acceptance-criteria coverage

- AC-1 widened query only when on — the unset-mode rollout step and the candidate count value-sourcing step
- AC-2 guard filter before reranking — the guard tripping chunk step
- AC-3 one request, one question per candidate, both inputs — the shared state and per candidate steps
- AC-4 keep threshold, order, cap, no padding — the enforce rollout step and the exact `0.5` step
- AC-5 three modes, unset means off — the three rollout steps plus the wrong-case step
- AC-6 fails open — the whole failure paths section
- AC-7 pinned dated model id — the model value-sourcing step
- AC-8 separate spend counter — the spend value-sourcing step
- AC-9 one log line, no query or chunk text — the shadow line steps
- AC-10 eval runs the reranker rather than stubbing it — covered by the eval pass steps; the harness forces `enforce` whenever `RETRIEVAL_STRICT` is set
- AC-11 reranked arm in the sweep — the sweep command step
- AC-12 prompt on disk, none in TypeScript — the build and grep steps
