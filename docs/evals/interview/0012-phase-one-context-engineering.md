# Phase one: context engineering pass

Spec: [0012 child, context engineering pass](../../specs/_root/0012-grounded-portfolio-agent/0012-context-engineering-pass.md) · Measured 2026-08-30 · Dataset hash `cc272c277e30…` (unchanged, so the delta is comparable)

**First person text quoted from any results file was written by a language model under test, not by Tony Chou.** See [README.md](README.md).

## What changed

1. **History is rebuilt server side.** The request contract is now `{ topicId, conversationId? }.strict()`. The client no longer echoes the transcript, and the API reconstructs it from its own persisted `ConversationTurn` rows.
2. **Both prompts were restructured** to the lesson 06 shape: role, context received, output constraints, behavioral guidelines, and a short set of examples. The ownership rules, hedge requirement, and never claim list survive unchanged in meaning.
3. **The interviewer gets a catalog** of the active topic's other stories, titles and engagement only, so a question can reference material beyond the one cycled story without having any details to invent from.

## Result: no significant movement

| Dimension | Baseline | After phase one | Δ | Noise band | Verdict |
|---|---|---|---|---|---|
| honesty | 1.000 | 1.000 | 0.000 | ±0.05 | not significant |
| grounding | 0.975 | 0.975 | 0.000 | ±0.00 | not significant |
| persona | 0.950 | 0.975 | +0.025 | ±0.05 | not significant |

**Stated plainly: this phase did not move the scoreboard.** Persona is up two and a half points and that is inside the noise band, which means it is indistinguishable from judge drift. It is not progress and is not claimed as progress.

That is a defensible outcome rather than a disappointing one. The baseline was already at or near ceiling on honesty and grounding, so the suite had almost no room to show improvement. What this phase actually bought is not visible on this scoreboard: a closed prompt injection hole, and material the interviewer previously could not see. The scoreboard's job here was to prove nothing regressed, and it did that.

One observable worth recording without over reading it: in the identical prompt control run the `edge-bait-mailchimp-500` case produced "500 users" and the ownership guard fired to replace it; after the restructure the same case produced no overclaim and the guard stayed quiet. That is one case in one run. It is a hint that the restructured never claim section is doing more work, not evidence of it.

## Superseded by the 2026-08-30 re-baseline

The numbers above were measured against the 20 case baseline. That baseline has since moved to 22 cases, so **the deltas in this writeup are not comparable to any run after 2026-08-30**. The reasoning stands; the arithmetic belongs to a dataset that no longer exists. See the baseline history in [README.md](README.md).

## Two runs, and why

- **Control run** (`results/2026-08-30-bf4c88e-dirty.json`): the conversation module reverted to the pre restructure commit. The build plan called this a sanity run to confirm the history source swap was behaviorally neutral. It could not have shown otherwise: the eval harness injects each golden case's history directly into `generateTurnPair`, bypassing the controller where the rebuild happens, so the history change is invisible to the suite by construction. The run is kept because it is still useful as what it actually is, a fresh identical prompt measurement of judge drift, which is exactly how the noise band was produced.
- **Measurement run** (`results/2026-08-30-bf4c88e.json`): all three changes in. This is the row in the table above.

## Course principles applied, and skipped

**Applied:**

- **Structured prompts.** Both skill files now separate stable instruction from per request context, with the dynamic block appended last by the message builders.
- **Put the missing information in the context.** The interviewer's questions were limited by seeing one story at a time. Information physically absent from the context cannot be prompted around, so the catalog adds it.
- **Trust boundary as a context concern.** Prompt content is now composed only of repo authored skill files, seeded fixture data, and model generated prior turns. No visitor typed text reaches a prompt at all.

**Skipped:**

- **Compaction.** A conversation is capped at five pairs, roughly ten short turns, and cannot outgrow the window. Compaction would add a failure mode to solve a problem this surface does not have.

## A defect this phase exposed

The restructured prompts crossed Anthropic's 1024 token minimum for a cacheable prefix. Both providers already marked the system block `cache_control: ephemeral`, but both counted only `usage.input_tokens`, which excludes a cache hit. Measured directly: 1033 tokens (interviewer) and 1458 (Tony) disappearing from the count per turn pair.

That number feeds the daily spend backstop on a public endpoint, so the cap was quietly under counting. This was pre existing, not introduced here, and Beta's longer prompts have almost certainly been under counting for longer. Fixed in `totalInputTokens` (`ai-provider.interface.ts`), used by both providers.

**Consequence for the numbers above:** the fix landed after the measurement run, so that file's `tokensByModel` and `estimatedCostUsd` under report. The scores are unaffected, since scoring never reads token counts. Cost and token metadata in these two files should not be compared against the baseline's.
