# 0005 child: Bedrock provider swap (interview simulator)

## Summary

The api gains an `AI_PROVIDER` flag that chooses, at boot, whether AI calls go to the direct Anthropic API (default, unchanged) or to the same Claude models on Amazon Bedrock. The interview simulator is the first and only surface flipped in this child; the Beta planner stays on the direct path until its Guardrails child exists. Rollback is flipping the env var back.

> **Amendment, 2026-08-22.** The split this child created is now permanent for a different reason than the one recorded below, and the change of reason matters more than the split itself. Beta staying direct was written here as sequencing, work gated behind the Guardrails child. It is now a hard constraint: this AWS account cannot invoke **Claude Sonnet 5 on Bedrock**, and Beta's drafter is pinned to Sonnet 5, so putting Beta on the `AI_PROVIDER` token would silently downgrade the model that writes rehab plans for injured people. The Guardrails child no longer unblocks it; model access does. Confirmed in production the same day: a live plan logged `provider: "anthropic"` across screener, drafter and coach while the interview simulator served Bedrock. Read `AI_PROVIDER=bedrock` as "every consumer of the `AI_PROVIDER` token", never as "the whole api".

## Requirements

**User stories**:
- As the owner, I want a production AI workload running on Bedrock behind a flag so that the experience is real, reversible, and honestly claimable.

**Acceptance criteria**:
- **AC-P1**: with `AI_PROVIDER=anthropic` (or unset), behavior is byte for byte today's: same SDK, same env vars, all existing tests pass unchanged.
- **AC-P2**: with `AI_PROVIDER=bedrock`, the interview simulator serves complete conversations end to end through Bedrock (streaming included), verified live in the browser.
- **AC-P3**: `conversation.service.ts` and `beta.service.ts` contain no provider conditionals; the choice lives in one factory. Beta keeps using the direct path regardless of the flag in this child (a per surface override, `AI_PROVIDER_BETA` reserved but unimplemented).
- **AC-P4**: no module outside the provider layer imports `@anthropic-ai/sdk` types for control flow: the `instanceof Anthropic.APIError` checks in `beta.service.ts` (describeError, isRetryableUpstreamError, and the spec's fakeApiError helper) are replaced by a provider agnostic error classification the provider layer exposes; behavior of retries and name only logging is preserved and covered by the existing specs.
- **AC-P5**: Beta's per call structured log line gains a `provider` field; the interview path logs at least `{ provider, model, outcome }` per call (new, minimal; full parity with Beta's logging is out of scope).

## Decision

- Extract an `AiProvider` interface with exactly the two methods consumers already use: `streamMessage(...)` and `forceToolCall(...)` (shapes unchanged from today's `AnthropicService`).
- `AnthropicService` becomes the direct implementation; a new `BedrockAnthropicService` uses `@anthropic-ai/bedrock-sdk` (verified 0.32.4): `new AnthropicBedrock({ awsRegion: process.env.AWS_REGION })`, credentials from the standard chain (Render env vars). `messages.create` and streaming are shape identical, so both implementations share the call sites' expectations.
- `anthropic.module.ts` provides the interface token through a `useFactory` keyed on `AI_PROVIDER`; consumers inject the token. Conversation module needs zero changes beyond the injection token rename. Stated explicitly so no builder invents it: the module exports BOTH the concrete `AnthropicService` (unchanged, still constructor injected by `beta.module.ts`, untouched by this refactor) AND the new provider token (injected by the conversation module). Beta moving onto the token is future work gated behind the Guardrails child, tracked by the reserved but unimplemented `AI_PROVIDER_BETA`. (Superseded by the 2026-08-22 amendment above: the gate is Bedrock model access, not the Guardrails child. Do not act on this sentence.)
- Boot guard semantics: with `AI_PROVIDER=bedrock`, the factory synchronously requires `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` to be present and non empty, and fails boot with a clear message otherwise. No live AWS call is made at boot. (Render has no instance role credential source, so env vars are the entire credential story there; "standard chain" applies inside the SDK, not to the guard.)
- Error normalization: the provider layer exposes `classifyUpstreamError(err): { name, status, retryable }`; each implementation maps its own SDK's error types (direct: `Anthropic.APIError` and `APIConnectionError`; Bedrock: the bedrock sdk and smithy error shapes). `beta.service.ts` consumes the classification; its spec's `fakeApiError` helper migrates to fabricating the neutral shape. `describeError` survives as a thin formatter over the classification result and must preserve today's exact log string shapes (`"<name> status=<status or none>"` for upstream errors, `"<name>: <message>"` for internal errors), so the per agent log convention and any parsing of it do not silently change.
- Model id on the Bedrock path from env `BEDROCK_MODEL_ID`. ~~Default: the Geo US inference profile for **Claude Sonnet 5**, which the account's model catalog confirms available (2026-08-19) and which matches the direct path's current `ANTHROPIC_MODEL` (`claude-sonnet-5`), making the swap a same model, different provider comparison.~~ **Wrong, corrected 2026-08-22.** The catalog listing did not mean invocable: Bedrock returns **403 for Sonnet 5 on this account**, which the guardrails sibling records at its own line 57 and which is the reason Beta never moved. So the swap is NOT a same model comparison. Production sets `BEDROCK_MODEL_ID` in the Render dashboard to `us.anthropic.claude-sonnet-4-6`, and that is what the interview simulator actually serves; `render.yaml` notes the same thing beside the variable. `us.anthropic.claude-sonnet-4-5-20250929-v1:0` remains the in code `DEFAULT_BEDROCK_MODEL_ID` fallback, which nothing in production uses. The direct path keeps `ANTHROPIC_MODEL` (`claude-sonnet-5`) untouched, so the real shape is Sonnet 4.6 on Bedrock for the interviewer against Sonnet 5 direct for Beta. This Render env var and the classifier child's Terraform variable share a name but are independent settings, updated separately.
- Known non drop in edges, verified and accepted: the bedrock sdk omits `countTokens` and batches conveniences (this api uses neither; usage tokens come from response usage fields, which Bedrock returns); prompt caching would need explicit `cache_control` (unused today). `tool_choice` forced tool calls work identically, which `forceToolCall` depends on.

## Value sourcing

| Action | Value produced | Source |
|---|---|---|
| factory | provider selection | env `AI_PROVIDER` (anthropic default) |
| bedrock calls | region | env `AWS_REGION` (us-east-2) |
| bedrock calls | credentials | Render env vars for a console created IAM user whose policy grants `bedrock:InvokeModel` on foundation model and inference profile resources (same two ARN gotcha as the classifier child) |
| bedrock calls | model id | env `BEDROCK_MODEL_ID` |
| per call log | provider field | the factory's resolved choice, injected into the log context |
| usage counters | input and output tokens | response usage fields (present on both providers; asserted in specs) |

## Key invariants

- Default behavior is unchanged (AC-P1); the flag is opt in per deploy.
- The Beta planner's traffic does not move providers in this child (umbrella data boundary: its content continues to flow only to the direct Anthropic API until the Guardrails child deliberates otherwise). (Per the 2026-08-22 amendment, this is now indefinite rather than pending: Beta's content stays on the direct Anthropic API for as long as the account lacks Sonnet 5 on Bedrock. The umbrella's data boundary claim at `index.md` holds either way.)
- Rollback is a Render env flip plus restart; no migration, no code path removal.

## Configuration required

- `AI_PROVIDER`: `anthropic` (default) or `bedrock`.
- `BEDROCK_MODEL_ID`, `AWS_REGION`, plus the swap user's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in Render (console created; distinct from the SNS publisher user so either can be revoked alone).

## Critical test scenarios

- Happy path: full interview conversation with `AI_PROVIDER=bedrock` streamed in the browser, verifies **AC-P2**.
- Regression: full suite green with the flag unset, verifies **AC-P1**.
- Error normalization: Beta retry and logging specs pass against the neutral error shape for both implementations, verifies **AC-P4**.
- Config guard: `AI_PROVIDER=bedrock` with missing AWS credentials fails at boot with a clear message, not at first request (mirrors the existing lazy `ANTHROPIC_API_KEY` guard but at construction, since misconfig should not wait for a visitor).

## Build plan

1. Extract the interface + factory + error classification; migrate `beta.service.ts` off SDK instanceof checks; all existing specs green. Satisfies **AC-P1**, **AC-P3**, **AC-P4**.
2. `BedrockAnthropicService` + specs (mocked, shape parity assertions incl. usage fields). Satisfies **AC-P2** groundwork, **AC-P5**.
3. Terraform (new `infra/bedrock.tf`): an `aws_iam_policy` for the swap user granting `bedrock:InvokeModel` on `arn:aws:bedrock:*::foundation-model/*` and the account's `inference-profile/*` (region wildcard deliberate: Geo profiles require the foundation model permission in source and all destination regions). Tony (console): create the swap user + key, attach the policy by name, enter creds in Render. Distinct user from the SNS publisher so either credential can be revoked alone.
4. Live verification on a dev boot with the flag on; then gate, commit, and a production flip when Tony chooses (env change, not a deploy).

## Consequences

**Positive**: real, reversible production GenAI on AWS; provider resilience the api never had; the error layer stops leaking SDK types.
**Negative / tradeoffs**: two SDKs to keep updated; Bedrock adds tens of milliseconds latency versus the direct API in some regions; regional endpoint pricing can carry a premium over the global endpoint (accepted at this volume).
**Neutral**: the interview path gains its first per call log line, a small observability win beyond the swap itself.

## Inline rationale

The seam scan (2026-08-19) confirmed `AnthropicService` is already the single choke point and conversation code is clean of SDK imports, so the factory lands with zero consumer changes there; the one real coupling is Beta's error instanceof checks, which is why AC-P4 exists as its own criterion instead of a hoped for side effect. The interview simulator goes first because it is the non health surface with the easiest end to end verification; the Beta coach follows only behind the Guardrails child, keeping the clinical review story coherent.
