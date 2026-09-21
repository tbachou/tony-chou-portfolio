# Jev spike — PARKED, not in use

**Status**: parked 2026-09-21. Nothing here runs in production, nothing in
`apps/api/src/` imports it, and `@typesafe-ai/sdk` is a devDependency for this
reason. Deleting this directory and the devDependency would break nothing.

It is kept because the question it answers will be asked again, and re-deriving
the answer costs a corpus run and a day. See spec 0013's two **Revision**
sections for the full record; this file is the operator's note.

## What it measured

Whether a _System One_ model — TypeSafe's Jev, which returns a calibrated
probability instead of text — is a better second layer for the clinical
credential check than the Haiku forced tool call spec 0013 chose.

Same 149 labelled sentences in every arm, extracted live from the guard's own
spec file rather than copied, so a ninth adversarial round is picked up
automatically.

| arm                                    | missed claims | suppressed honest | latency |
| -------------------------------------- | ------------- | ----------------- | ------- |
| regex, on its own spec                 | 0 / 70        | 0 / 79            | none    |
| Haiku 4.5, prompt v2                   | 0 / 70        | 7 / 79            | ~1.2s   |
| Jev `jev-1.13.0`, question v2 at t=0.2 | 0 / 70        | 5 / 79            | ~0.2s   |

**Verdict: Haiku.** Both models caught every claim zero-shot; the two-sentence
gap is smaller than one prompt iteration moves. An early-access vendor with no
published SLA on a fail-closed safety path had to win, and it tied.

The regex row is a **control, not a competitor** — the corpus is its
specification, so it cannot lose there. Read it as "the extraction is correct",
never as "the regex is better".

## What would re-open this

Any one of these, in rough order of likelihood:

- **`ambiguous` proves inadequate in production.** Haiku used it once in 149
  answers. If suppression logs show the fail-closed band is not firing where it
  should, a calibrated probability is a genuinely better mechanism and not just
  a faster one. This is the strongest reason to come back.
- **Latency starts to matter.** ~1.2s sits in front of the first streamed token
  on clinical answers. Today AC-3's 3s budget absorbs it. A tighter budget, or
  a second checked surface, changes that.
- **Jev leaves early access with a published SLA and rate limits.** That was the
  disqualifier, not accuracy.
- **A surface appears where the decision is high-cardinality or high-volume** —
  the Beta screener's three-way verdict, retrieval reranking, the eval judges.
  Per-call cost and parallel sampling matter much more there than here.

## What would NOT re-open it

Pointing this at anything numeric or structural. TypeSafe's own jaggedness page
is explicit that jev-1.13 is not a calculator and does not count reliably, so
Beta's R3 (numeric fidelity) and R4 (structural conformance) stay in code. A
2026-09-20 discovery run against Beta's R6/R7 found nothing and mostly measured
bugs in the harness; Beta is feature-frozen and there is no case there today.

## Running it

```bash
npm run spike:jev --workspace=apps/api              # baseline, spends nothing
npm run spike:jev --workspace=apps/api -- --live    # Jev arm, ~$0.004
npm run spike:haiku --workspace=apps/api -- --live  # Haiku arm
npm run spike:jev:discover --workspace=apps/api     # Beta mining, needs a corpus run first
```

`--live` needs `TYPESAFE_API_KEY` (Jev) or `ANTHROPIC_API_KEY` (Haiku) in
`apps/api/.env`. Both arms pin their model — `jev-1.13.0` and
`claude-haiku-4-5` — because thresholds tuned against one version do not
transfer, and TypeSafe's models page says so in as many words.

## Two traps for whoever picks this up

**`haiku-prompt.md` is a COPY.** It was taken from
`skills/credential-check.md` on `claude/spec-0013-self-implementation-5b307c`
because that was a different worktree on a different base. Two copies of a
safety prompt is exactly the drift this repository keeps getting bitten by.
Once the credential check is on the same branch, `haiku-arm.ts` should load the
real skill file through the conversation skill loader and this copy should be
deleted. **Until then, any measurement here is stale the moment that file is
edited.**

**Every failure in this investigation was a question, never a model.** Jev v1
missed seven practice claims because it was asked about credentials; Haiku let
"I work as an occupational therapist" through until one example was added; and
adding that example immediately created a new false positive on "I'm an
occupational therapist by background". A comprehension layer moves the failure
surface from "a matcher that cannot express the distinction" to "a question
that did not state it", and the second kind is quieter, because it returns a
confident verdict instead of visibly failing to match. Whatever you point this
at next, budget for adversarial rounds on the question text.
