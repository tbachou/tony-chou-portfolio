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
