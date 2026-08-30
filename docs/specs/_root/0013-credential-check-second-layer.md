# 0013. A second layer for the clinical credential check

**Date**: 2026-08-30
**Status**: Proposed

## Summary

The interview persona must never claim a current occupational therapy licence, because Tony no longer holds one. Today that rule is enforced by pattern matching on the generated answer, and eight rounds of adversarial review showed pattern matching cannot reliably tell a claim from a denial. This spec adds a second check that reads the sentence: one cheap model call, asking a single yes or no question, run only when the answer mentions the subject. The pattern matcher stays as a fast first filter. The new check fails closed, so when it cannot answer, the visitor gets a scripted honest reply instead of an unverified one.

## Context

`apps/api/src/modules/conversation/ownership-guard.ts` inspects every answer the Tony persona generates before a single token reaches a visitor. Most of what it enforces is easy: a handful of first person phrases about work Tony did not do. One rule is not easy. Tony was a licensed occupational therapist for six years, no longer practices, holds no current licence, and his C/NDT certification is expired. A generated answer that claims otherwise misrepresents a real, regulated healthcare qualification. It is the only rule in the file with that property, and `skills/tony.md` leads its never claim list with it.

Between 2026-08-29 and 2026-08-30 that rule was hardened across eight rounds of adversarial review, each round running the real guard and capturing wrong verdicts. Every round found genuine defects, and after the first, most of the defects were introduced by the previous round's fix. The record is preserved in the KNOWN CEILING block at the top of `CURRENT_CLINICAL_CREDENTIAL`. The regressions landed in the same two places every time: two open ended enumerations of natural language, one listing the words that mean a sentence is a denial, the other listing the words that mean an "OT" is not a claim. Neither list can be completed. Concrete examples of what only execution found: a curly apostrophe (the default typography of the model whose output this reads) defeated every branch matching "I'm"; two spaces instead of one bypassed the guard entirely; the token `ot` with no boundary guard blocked the honest sentence "My remote branch is up to date"; a window bridged "I have" to a licence across the word "not", blocking "I have not held an occupational therapy license since 2019", which is the most natural true sentence about the lapsed licence.

The underlying problem is that deciding whether an English sentence asserts or denies a credential is reading comprehension. "I'm still a licensed OT" and "I'm no longer a licensed OT" differ by one word and mean opposite things. A matcher over characters has no access to that difference, so each patch trades a bypass for a false positive or the reverse.

Two things bound how much this matters. First, the persona currently answers these questions correctly on its own: eval cases added on 2026-08-30 ask "are you still licensed?" and "could you still treat patients?", and the model replied "no, I'm not currently licensed, I don't practice, and that certification has lapsed" without the guard firing. The prompt rule in `skills/tony.md` is doing the work. Second, the guard has never fired on a licensure claim in production or in any recorded eval run. So this is defence in depth for a failure that has not been observed, chosen because the consequence of the failure is high rather than because the failure is likely.

There is also a structural constraint. `evaluateTonyResponse` is pure and synchronous, and spec 0011 defines it as honesty layer one in the eval suite: a failure there scores zero authoritatively, and the whole scoreboard, its noise band, and its reproducibility rest on that determinism.

## Requirements

**User stories**:
- As a visitor, I want any answer about Tony's clinical background to be true, so that nothing I read misrepresents a real healthcare qualification.
- As Tony, I want the licensure rule enforced by something that can read a sentence, so that hardening it stops costing a round of regressions every time.
- As an engineer maintaining the suite, I want the eval's honesty layer one to stay deterministic and cheap, so that the scoreboard remains reproducible.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A credential check runs on the raw generated Tony answer only when the deterministic guard has already passed it AND the prefilter in **Feature design** matches. When the guard blocks the answer, or the prefilter does not match, no model call is made and behaviour is byte identical to today.
- **AC-2**: The check asks one narrow question, does this answer claim a current clinical credential, and returns a boolean plus a category from the closed enum in **Feature design** through a forced tool call. A true verdict, or a category outside that enum, replaces the answer with `CREDENTIAL_GUARD_FALLBACK` before any token is emitted.
- **AC-3**: The check fails closed, and **never throws**. A timeout at 3 seconds, a provider error, or an unparseable tool call are caught inside the check and returned as a failure verdict, which suppresses the answer exactly as a true verdict does. Throwing would be caught by `generateTurnPair`'s existing handler, which deletes the reserved turn and emits `turn_error` instead of the fallback, so a throwing check would not fail closed at all. No path lets an unverified answer through once the prefilter has matched.
- **AC-4**: `evaluateTonyResponse` stays pure and synchronous. Spec 0011's honesty layer one is unchanged, the eval harness makes no extra model call, and the committed noise band stays comparable.
- **AC-5**: `CREDENTIAL_CHECK_ENABLED=false` disables the check; any other value, including unset, leaves it enabled. When disabled the surface behaves exactly as it does today, including no model call and no added latency.
- **AC-6**: Tokens the check consumes are counted toward the daily spend total through the existing counter, using `totalInputTokens` so cached prompt tokens are included. The existing daily cap check still runs before generation, so a capped day stops the turn rather than degrading the answer.
- **AC-7**: Each run logs the verdict, a reason category, and the story id. The generated answer text is never logged, and no visitor typed content exists on this path to log.
- **AC-8**: The check's prompt lives as a markdown skill file on disk beside the module, loaded the way the existing conversation prompts are. No prompt text moves into TypeScript.
- **AC-9**: The check is pinned to the direct Anthropic path and an explicit model id constant, not the `AI_PROVIDER` token and not `ANTHROPIC_MODEL`, so neither its provider nor its model can drift with configuration.
- **AC-10**: If the direct Anthropic path is not configured at startup, the service refuses to start rather than suppressing every clinical answer at request time. A deployment cannot silently serve canned replies because a key is absent.
- **AC-11**: The eval harness makes no model call for the check. The checker is a constructor dependency, the harness supplies a disabled one, and `CapturingProvider`'s unrecognised-call tripwire covers `forceToolCall` as well as `streamMessage`, so a future wiring change fails loudly instead of silently spending.

## Options considered

### Option 1: Keep hardening the pattern matcher

Continue the approach of the last eight rounds: add branches, tighten boundaries, extend the word lists, and lock each confirmed failure as a regression test.

**Pros**:
- No new model call, no added latency, no added cost, no new failure mode.
- Fully deterministic and reproducible, which keeps the eval suite simple.
- The existing 100 plus regression tests already encode a great deal of hard won knowledge.

**Cons**:
- Eight rounds of evidence say it does not converge. Every round after the first was dominated by defects the previous round's fix introduced.
- The two enumerations at the centre of the regressions are open ended by nature, so each addition is itself either a new bypass or a new blind spot.
- It cannot represent the distinction it is being asked to make, because assert versus deny is not a property of the characters.

### Option 2: Replace the pattern matcher with a model call

Delete the credential branches entirely and ask a model on every Tony answer whether it claims a current credential.

**Pros**:
- One mechanism instead of two, so no chance of the layers disagreeing.
- Reading comprehension applied to a reading comprehension problem.
- Removes the enumerations that cause the regressions.

**Cons**:
- A model call and its latency on every answer, on a public endpoint with a daily spend cap.
- Replaces a deterministic check with a probabilistic one, so the guarantee weakens even as accuracy improves.
- Throws away the deterministic block for the cases pattern matching genuinely handles well, and would break spec 0011's honesty layer one.

### Option 3: Pattern matcher as a first filter, model call as a second layer

Keep the deterministic guard exactly as it is for what it already blocks. When it passes an answer that mentions the clinical subject at all, ask a small model one narrow question before releasing the answer.

**Pros**:
- The deterministic block stays for everything it catches today, and layer one stays pure so the eval suite is untouched.
- The model call is scoped to a narrow binary question and gated by a prefilter, so cost and latency are paid only when the subject arises, which is rare.
- Failing closed converts an unanswerable case into a scripted honest reply rather than an unverified claim.

**Cons**:
- Two mechanisms to understand and keep aligned, and a new dependency inside the request path.
- Failing closed means a provider outage degrades answers on this topic to a canned reply.
- The prefilter becomes a new place a miss is silent: an answer it does not match is never seen by the second layer.

### Option 4: Second layer, and delete the credential branches from the pattern matcher

Add the second layer as in Option 3, and at the same time remove the credential branches from `ownership-guard.ts` entirely. The pure guard keeps its ownership and never claim phrase rules; the credential question belongs solely to the model call.

**Pros**:
- The two open ended enumerations that caused every regression are deleted, not merely frozen, so they cannot rot or be extended by a future patch.
- One mechanism owns the credential question, so the two layers can never disagree about the same sentence.
- The pure guard gets materially smaller and easier to reason about, and layer one stays deterministic for what it still covers.

**Cons**:
- It removes a working deterministic block before the replacement has run in production even once. The obvious phrasings are currently caught with certainty and for free.
- With the flag off, or the check disabled at startup, there would be no credential enforcement at all rather than a weaker one.
- It discards the regression tests that encode eight rounds of findings, which are the best record of how this fails.

## Decision

**Chosen option**: Option 3: Pattern matcher as a first filter, model call as a second layer.

Keep the deterministic guard as a fast first filter, and add a separate asynchronous credential check that the conversation service calls after the guard passes, gated by an over inclusive keyword prefilter, pinned to the direct Anthropic path on Haiku 4.5, failing closed, and controllable by an environment flag.

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Rationale

The Context establishes two forces that point at Option 3 together. The first is that the pattern matcher cannot make the distinction it is being asked to make, which rules out Option 1: the eight round record is not a run of unlucky patches, it is what happens when a mechanism is applied outside what it can express. The second is that spec 0011's honesty layer one must stay deterministic, which rules out Option 2: replacing the guard would make the eval suite's authoritative layer probabilistic, and the noise band and the whole measured improvement story rest on that layer being reproducible.

Option 3 satisfies both because the two layers do different jobs. The pattern matcher keeps blocking the obvious phrasings deterministically, which is genuinely what it is good at, and stays pure so the eval harness continues to call it unchanged. The model call handles only the case pattern matching cannot reach, and only when the subject actually comes up.

Three of the smaller choices deserve their reasons stated. Failing closed follows from what is being protected: this is a regulated healthcare credential, and a canned reply during an outage is a much smaller harm than a published false claim of medical licensure. The prefilter is deliberately over inclusive because its cost asymmetry is the opposite of the guard's: a false positive costs one cheap model call, while a false negative silently skips the safety check entirely, so being generous is correct even though the same instinct would be wrong in the guard itself. Pinning to the direct Anthropic path rather than the `AI_PROVIDER` token follows the precedent Beta already sets in this repository for the same reason: the root `AGENTS.md` records that this AWS account cannot invoke Sonnet 5 on Bedrock, so Bedrock model availability is not something a safety check should silently depend on, particularly one that fails closed.

Option 4 deserves a direct answer, because it is genuinely attractive: deleting the enumerations rather than freezing them is the cleaner end state, and it removes the possibility of the two layers disagreeing. It is rejected for now on sequencing, not on merit. The second layer is unproven in production, fails closed, and sits behind a flag that exists precisely so it can be turned off; removing the deterministic block in the same change would mean that turning the flag off leaves no credential enforcement at all. Keeping both is redundant by design, and redundancy is what a safety change should buy on its first deployment. The follow up records revisiting this once the second layer has real running time, which is when the evidence to delete the branches will exist.

It is worth stating plainly what this spec is not. The persona already answers these questions correctly, and the guard has never fired on a licensure claim in production or in any recorded eval run. This is defence in depth chosen for the consequence of the failure rather than its likelihood, and that framing should survive into how the work is prioritised.

## Feature design

**Data model sketch**: no schema change. Nothing about the check is persisted. The verdict lives for the duration of one request.

**State transitions**: none. The check is a single pass over one generated answer.

**API surface**: no change. `POST /conversation/turn` keeps the request contract `{ topicId, conversationId? }.strict()` and the same SSE event shapes. The check sits inside the existing turn generation, before any Tony token is emitted.

**The prefilter** (pinned here, not left to the build). Matched against the lowercased raw answer, after the same normalisation the guard applies (collapse all whitespace to single spaces, fold curly apostrophes to ASCII), because the guard's recorded bugs apply verbatim to a substring match:

`licen` · `therapist` · `therapy` · `occupational` · `c/ndt` · `ndt` · `nbcot` · `otr` · `clinic` · `patient` · `rehab` · `credential` · `certif` · `practi` · `ot` (this one with word boundaries on both sides, since bare `ot` matches inside "remote", "note" and "robot")

Deliberately over inclusive: several of these fire on ordinary engineering talk ("practice", "certif", "credential"), and that is correct here. A false positive costs one cheap model call; a false negative skips the safety check silently. This is the opposite of the asymmetry inside the guard, and the difference is the point.

**The verdict enum** (closed; the tool schema enforces it):

| Source | Category | Meaning |
|---|---|---|
| model | `current_claim` | the answer claims a current credential. Suppress. |
| model | `past_tense_ok` | the credential is named, correctly in the past. Allow. |
| model | `no_credential_mentioned` | nothing credential related. Allow. |
| model | `ambiguous` | the model cannot tell. Suppress (fail closed). |
| code | `timeout` · `provider_error` · `unparseable` | the check could not complete. Suppress. |

A model response whose category is not in the model set is treated as `unparseable`, so an unexpected value can never be read as permission.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| decide whether to check | prefilter match | the pinned keyword list above, matched against the normalised lowercased raw Tony answer |
| decide whether to check | guard already passed | the existing pure `evaluateTonyResponse` result |
| decide whether to check | check enabled | the `CREDENTIAL_CHECK_ENABLED` environment variable, default on when unset |
| run the check | the question put to the model | a markdown skill file on disk beside the module, loaded by the existing skill loader (AC-8) |
| run the check | the answer under review | the raw generated Tony text, before any guard substitution |
| run the check | the verdict | a forced tool call returning a boolean plus a category from the closed enum above, with `timeoutMs: 3000` and `maxRetries: 0` so the timeout is the whole wall clock budget |
| run the check | the model and provider | an exported model id constant beside the check, on the concrete `AnthropicService` injected directly, not the `AI_PROVIDER` token and not `ANTHROPIC_MODEL` (AC-9) |
| a true verdict, or any failure | the text the visitor sees | the existing `CREDENTIAL_GUARD_FALLBACK` constant, already used for a deterministic credential block |
| any run | tokens counted | `totalInputTokens` on the provider response, added to the amount in the existing `dailyUsage.incrementOp(2, …)` call inside the turn transaction. The op count stays 2 (it counts persisted rows, and the check persists none), and check tokens are never added to `ConversationTurn.tokenCount` (AC-6) |
| any run | the log line | verdict, reason category, and story id only (AC-7) |

**Key invariants**:
- No Tony token reaches a visitor before the second layer has either passed the answer or been skipped by the prefilter.
- Once the prefilter matches, exactly one of three things happens: the check passes the answer, the check suppresses it, or the check fails and therefore suppresses it. There is no fourth path.
- The pure guard is never made asynchronous, and never calls a model. Anything that needs a model call lives outside it.
- The check reads model generated text only. No visitor typed content exists on this path.

**Security model**: unchanged. The route stays public and anonymous, and the request surface stays two validated scalars. The check adds no new secret, reusing the `ANTHROPIC_API_KEY` already configured. It narrows what can reach a visitor and widens nothing.

**Configuration required**:
- `CREDENTIAL_CHECK_ENABLED`: set to `false` to disable the second layer. Absent or any other value means enabled, so a fresh environment is safe by default.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: an answer mentioning the clinical subject and making no claim passes the check and streams unchanged, verifies **AC-1**, **AC-2**.
- Positive verdict: an answer claiming a current licence is replaced by `CREDENTIAL_GUARD_FALLBACK`, and no original token is emitted, verifies **AC-2**.
- Prefilter miss: an answer about ordinary engineering work makes no model call at all, verifies **AC-1**.
- Failure case: a provider error, a 3 second timeout, and a malformed tool call each suppress the answer, verifies **AC-3**.
- Flag off: with `CREDENTIAL_CHECK_ENABLED=false` no model call is made and the answer streams as it does today, verifies **AC-5**.
- Purity: the eval harness runs a full case without an extra model call, and `evaluateTonyResponse` remains synchronous, verifies **AC-4**.
- Accounting: a checked turn increments the daily counter by the check's tokens as well as the generation's, verifies **AC-6**.
- Logging: a firing logs verdict, category, and story id, and the log line contains no part of the answer text, verifies **AC-7**.
- Never throws: a checker whose provider rejects still yields the fallback, not a `turn_error`, and the reserved turn is not deleted, verifies **AC-3**.
- Unknown category: a tool call returning a category outside the enum is treated as unparseable and suppresses, verifies **AC-2**.
- Startup: with the check enabled and no Anthropic path configured, the service fails to boot rather than serving canned answers, verifies **AC-10**.
- Harness: a full eval case issues exactly two model calls, and a stray `forceToolCall` trips the harness tripwire, verifies **AC-11**.
- Prompt on disk: the check loads its prompt through the skill loader, and no prompt text appears in a `.ts` file, verifies **AC-8**.
- Pinning: the check calls the concrete `AnthropicService` with the model id constant, and setting `ANTHROPIC_MODEL` or `AI_PROVIDER` does not change either, verifies **AC-9**.

## Migration plan

**Strategy**: feature flagged, single deployment.
**Phases**:
1. Ship with `CREDENTIAL_CHECK_ENABLED` unset, which is enabled, and watch the logs for suppressions. A suppression on an honest answer is the signal to look at.
2. If suppressions appear on honest answers, set the flag to `false` in the Render dashboard to restore today's behaviour without a deploy, then tune the prompt or prefilter.

**Rollback**: set `CREDENTIAL_CHECK_ENABLED=false`. Reverting the commit also works, but the flag is faster and needs no deploy. Note that changing an environment variable on Render restarts the service.
**Risks**: the check fails closed, so a provider degradation shows up as canned replies on clinical questions rather than as an error. That is the intended trade, but it is the behaviour to recognise quickly, which is what the flag and the log line are for.

## Build plan

Tracer Bullet, matching the project default noted in the root `AGENTS.md`. The thin thread is one answer going end to end through the new check before anything is widened.

1. Add the prompt as a markdown skill file beside the module and load it through the existing conversation skill loader, satisfies **AC-8**.
2. Add the credential check as a separate asynchronous function with the concrete `AnthropicService` injected directly, Haiku 4.5, a forced tool call returning a boolean and a reason category, a 3 second timeout, and no retry (the timeout is the whole budget on a path that fails closed), satisfies **AC-2**, **AC-3**, **AC-9**.
3. Wire it into `generateTurnPair` after the pure guard passes and behind the over inclusive prefilter and the environment flag, substituting `CREDENTIAL_GUARD_FALLBACK` on a true verdict or any failure. This is the thin thread: one answer end to end, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**.
4. Add the token accounting and the log line, satisfies **AC-6**, **AC-7**.
5. Make the checker a constructor dependency of `ConversationService`, supply a disabled one from the eval harness, and extend `CapturingProvider`'s unrecognised-call tripwire to cover `forceToolCall`, satisfies **AC-4**, **AC-11**.
6. Add the startup guard that refuses to boot when the direct Anthropic path is unconfigured and the check is enabled, satisfies **AC-10**.
7. Add colocated mocked tests for every critical test scenario above, including one asserting `evaluateTonyResponse` is still synchronous and one asserting the harness path makes no extra call, satisfies **AC-4**, **AC-11**.

## Consequences

**Positive**:
- The rule that protects a regulated qualification is finally enforced by a mechanism that can represent the distinction it is being asked to make.
- The deterministic guard and spec 0011's honesty layer one are untouched, so the eval suite stays reproducible and cheap.
- Failing closed means the worst normal outcome is a scripted honest reply, not a false claim.
- Cost and latency are paid only when the subject arises, which the eval corpus suggests is rare.

**Negative / tradeoffs**:
- A new dependency inside the request path, on a surface that had none beyond generation itself.
- Failing closed converts provider trouble into visible degradation on this topic. Accepted deliberately, mitigated by the flag.
- The prefilter is a new place a miss is silent. Being over inclusive reduces that risk but does not remove it, and the residual risk is real.
- A probabilistic check now sits in a safety path, so the guarantee is now "very likely" rather than "always", even though it is more accurate in practice than what it supplements.
- Two mechanisms must be kept aligned. The pure guard and the second layer could in principle disagree about the same sentence.

**Neutral**:
- Some added latency before the first Tony token on clinical answers only. The answer is already fully buffered for the existing guard, so this lengthens an existing pause rather than interrupting a stream.
- The prompt becomes a third conversation skill file, which the eval suite does not currently path filter on.

## Follow-up

- [ ] The eval suite does not measure the second layer, by design (AC-4). Consider recording the verdict alongside each case unscored, so the scoreboard shows how often the layer fires without making layer one probabilistic.
- [ ] `.github/workflows/evals.yml` path filters on `apps/api/src/modules/conversation/**`, so the new skill file is covered. Confirm that still holds if the check moves.
- [ ] The KNOWN CEILING block in `ownership-guard.ts` should point at this spec once it is built, so the next person to open that file finds the resolution rather than only the history.
- [ ] Revisit Option 4 (deleting the credential branches from the pattern matcher) once the second layer has real running time and its suppression rate is known. That is when the evidence to delete them will exist; today they are load bearing and should not be touched.
