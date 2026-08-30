# 0012 child. Context engineering pass (phase one)

**Date**: 2026-08-29

## Summary

Phase one applies lesson 06 of the course to the existing conversation engine. The two prompt skill files get a real structure, the interviewer finally learns what stories exist in the active topic, and conversation history is rebuilt from the database instead of trusted from the client. The change is measured by a full eval run against the committed 0011 baseline. No schema change, no new endpoint, no visible feature; the deliverables are better grounding, a closed security hole, and the first delta on the scoreboard.

## Inline rationale

The course's own data says context engineering is the highest leverage first move: information physically missing from the context cannot be prompted around. Today the interviewer sees only the one cycled story, so its questions cannot reference the rest of the topic's material, and the server trusts up to 4000 characters per turn of client echoed transcript on a public endpoint, which is both a grounding risk and a tamper hole. Doing this before retrieval keeps the measurement clean: whatever the scoreboard shows after this phase is attributable to context shape alone. Compaction, the third piece of lesson 06, is deliberately skipped: a conversation is bounded at 5 pairs (about 10 short turns) and cannot outgrow the window.

## Requirements

**User stories**:
- As Tony, I want the prompts structured and the interviewer aware of the topic's full material so that generated questions and answers are grounded in what actually exists.
- As Tony, I want the server to stop trusting client echoed transcript so that a visitor cannot inject fabricated history into the prompts.
- As an engineer reading the repo, I want this phase's effect measured against the committed baseline so the improvement claim is checkable.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `interviewer.md` and `tony.md` are restructured to the lesson 06 shape: role, capabilities, output constraints, behavioral guidelines, 2 to 3 short few shot examples, with dynamic per request context appended last by the user message builders. They remain markdown skill files loaded by `skill-loader.ts`; no prompt text moves into code. The ownership rules, hedge requirements, and never claim list in `tony.md` survive the restructure unchanged in meaning.
- **AC-2**: The interviewer user message includes a compact catalog of the active topic's stories (title plus the engagement line per story, one line each) alongside the current grounding story, so questions can reference material beyond the cycled story without inventing any.
- **AC-3**: History is rebuilt server side from persisted `ConversationTurn` rows for the request's `conversationId`, ordered by turnIndex with the interviewer turn before the Tony turn within a pair. The request contract becomes `{ topicId, conversationId? }.strict()`; `historyTurnSchema`, `HISTORY_MAX_TURNS`, and `HISTORY_TURN_MAX_LENGTH` are removed from `packages/shared/contracts.ts`, and the web client stops sending the transcript. A syntactically valid `conversationId` with no persisted rows behaves exactly like omitting it (a new conversation), preserving current semantics.
- **AC-4**: The phase is measured: a full eval run after the change is compared against the committed baseline (dataset unchanged, so the hash matches and the delta is comparable), the scoreboard is regenerated, and a short writeup is committed under `docs/evals/interview/` recording the delta (or its absence, stated plainly if inside the noise band) and the course principles applied and skipped (compaction skipped, bounded conversation).
- **AC-5**: Nothing else moves: the ownership guard, SSE event shapes, rate limits, daily caps, and `TURN_PAIR_CAP` are unchanged, and `apps/web` plus `apps/api` ship in one push (the contract change makes stale clients fail closed with a 400, acceptable for a single deployment).

## Feature design

**Data model sketch**: no schema change. `ConversationTurn` gains a new read path (history rebuild by `conversationId`); the existing index on the unique constraint `(conversationId, turnIndex, role)` serves it.

**State transitions**: unchanged from spec 0002.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/conversation/turn` | POST | `topicId: string` (req), `conversationId?: uuid` | unchanged SSE stream (`turn_start`, `token`, `turn_end`, `turn_error`) | public | 400 invalid `topicId` or unknown request field (history now rejected by `.strict()`), 409 concluded or duplicate slot, 429 rate limited |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| generate a pair | conversation history in both prompts | `ConversationTurn` rows for the request's `conversationId`, ordered by turnIndex then role, formatted by the existing `formatHistory` |
| generate a pair | story catalog in the interviewer message | the resolved topic's `stories` (already loaded by `resolveTopic`): `title` plus `engagement` per story |
| generate a pair | grounding story | unchanged: `topic.stories[turnIndex % stories.length]` |
| generate a pair | prompt structure | `interviewer.md` and `tony.md` via `skill-loader.ts`, restructured per AC-1 |
| measure | delta and noise band verdict | the 0011 eval module against the committed `baseline.json` |

**Key invariants**:
- Prompt content reaching the model is composed only of repo authored skill files, seeded fixture data, and model generated prior turns; no client supplied free text exists anywhere in the pipeline after this phase.
- The catalog lists only stories mapped to the active topic; the grounding story selection itself is untouched (that changes in phase three).
- The eval harness calls the same production path, so the restructure is automatically under test; a harness break is a loud signal, not a silent measurement of the wrong thing.

**Security model**: strictly narrows the public surface: the only remaining visitor inputs are a topic slug and an optional uuid, both validated before any model call. Removing the client echoed transcript closes the existing prompt injection and impersonation hole on `/conversation/turn`. No new secrets, no auth changes.

**Configuration required**: none.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: a multi pair conversation produces prompts whose history matches the persisted rows exactly, with the catalog present in the interviewer message, verifies **AC-2**, **AC-3**.
- Failure case: a request carrying the old `history` field is rejected 400 by the `.strict()` contract before any model call, verifies **AC-3**, **AC-5**.
- Edge case: a valid unknown `conversationId` starts a fresh conversation at turnIndex 0, verifies **AC-3**.
- Measurement: the post change eval run compares against the baseline with a matching dataset hash and the writeup states the per dimension delta, verifies **AC-4**.
- Unit level (Jest, mocked per repo convention): history rebuild ordering, catalog assembly, and message builder output updated in `conversation.service.spec.ts`, supporting **AC-1**, **AC-2**, **AC-3**.

## Build plan

Build approach: no project approach is recorded (AGENTS.md says TBD), so this follows the noted default of Tracer Bullet. Each task ends with typecheck, lint, and tests green.

1. Server rebuilt history: add the rebuild read in `conversation.service.ts`, change the contract in `packages/shared/contracts.ts` to `{ topicId, conversationId? }.strict()` removing the history schema and caps, update the web client (`api.ts`, `ConversationPanel.tsx`) to stop sending the transcript, update colocated tests; then a sanity eval run (scores should hold within the noise band, since the same history content now comes from the database), satisfies **AC-3**, **AC-5**, part of **AC-4**.
2. Restructure `interviewer.md` and `tony.md` to the lesson 06 shape, preserving the ownership and never claim content in meaning; update message builder tests, satisfies **AC-1**.
3. Add the story catalog to `buildInterviewerUserMessage` from the already loaded topic stories, satisfies **AC-2**.
4. Full eval run, regenerate the scoreboard, commit the results and the phase writeup with applied and skipped course principles, satisfies **AC-4**.

## Consequences

**Positive**:
- The public endpoint's attack surface shrinks to two validated scalars, closing a real injection hole as a side effect of better context discipline.
- The first scoreboard delta of the umbrella exists, establishing the per phase measurement habit cheaply.
- The request contract simplification removes payload validation code rather than adding any.

**Negative / tradeoffs**:
- The prompt restructure may move scores in either direction; if the delta is negative and outside the noise band, the restructure is revised before the phase closes, which may take more than one eval run's cost.
- The catalog adds tokens to every interviewer call (a few lines per story); accepted as the cost of grounding.
- Stale browser tabs open across the deploy fail their next request with a 400 until reload; accepted for a single push deployment.

**Neutral**:
- Two eval runs (sanity plus final) cost real model spend, bounded by the suite's `--max-cost`.
- `evals.yml` already path filters on the prompt files, so the PR for this phase triggers a capped CI eval run automatically.

## Follow-up

- [ ] If the sanity run after task 1 moves scores outside the noise band, stop and investigate before the restructure lands; the history source swap should be behaviorally neutral.
