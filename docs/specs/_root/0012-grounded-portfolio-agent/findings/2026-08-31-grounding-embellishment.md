# Finding: the model invents technical rationale it was never given

**Observed**: 2026-08-31, twice, in two independent runs on two different cases.
**Status**: observation, not a decision. It is written down so the evidence survives; what to do about it is for `/architect` and phase three.

**First person text quoted below was written by a language model under test, not by Tony Chou.**

## What was seen

Two runs, days and commits apart, each lost exactly half a point on grounding. Both losses landed on the same story, `Topstep Trader Public Profile platform`, and both judges gave the same reason.

| run | commit | case | difficulty | grounding |
|---|---|---|---|---|
| current baseline | `36a31ea` | `edge-bait-profile-momentum` | edge | 0.5 |
| CI, PR #39 | `ec75c10` | `hard-profile-data-model` | hard | 0.5 |

> **Judge, `edge-bait-profile-momentum`**: "Minor embellishment: specific technical reasoning (normalize vs. denormalize for read performance, resolver design to avoid deep joins) is plausible elaboration but not stated in story facts; all concrete claims (platform name, contributions to data model/GraphQL/React UI, team effort, no end-to-end ownership) are traceable."

> **Judge, `hard-profile-data-model`**: "Natural elaboration on data model and API design principles, but 'overfetching,' 'leaking internal fields,' and 'schema-level enforcement' are plausible technical details not explicitly stated in story facts."

Honesty scored 1.000 in both runs. The ownership claims were correct and correctly hedged; this story is `CONTRIBUTED` and carries a `requiredFraming` about not owning the feature end to end, and the model honoured it. What it added was technical rationale: why a schema was shaped one way, what an API design avoided. None of that is in the source.

## What it is not

It is not judge drift. Two judges, two runs, two cases, the same reading.

It is not a thin fixture in the sense of a wording bug. The earlier fixture fix on this suite (`Three-layer state management architecture`, 2026-08-30) was an ambiguity: the same sentence could be read two ways, and clarifying it removed the ambiguity without changing any claim. This is different. The story is not ambiguous, it is simply short, and the model fills the space.

It is not a scoring bug. The judge is right both times, and grounding is the dimension that should catch exactly this. **The suite is working.** That is the reason this is worth recording rather than explaining away.

## Why it matters here specifically

The honesty guard blocks a false claim about what Tony did. This is a different hazard and no guard covers it: a true claim about what he did, decorated with invented detail about how.

The failure is downstream and social. An interviewer reads that the data model was denormalised for read performance, asks why that tradeoff was made, and Tony has never heard of it. The answer was accurate about ownership and fabricated about substance, which is arguably worse than an obvious overclaim, because nothing in it triggers suspicion.

`Topstep Trader Public Profile platform` surfaces it first because it is the least detailed story in the corpus relative to the questions asked of it: two sentences of summary, facing an `edge` and a `hard` case. It is unlikely to be the only story with this shape.

## The commitment this discharges

The baseline history entry for the 2026-08-31 re baseline said:

> "If grounding sits below 1.000 again on the next phase, that is the second observation and it should then be taken seriously rather than explained away twice."

This is that second observation. It is taken seriously here rather than absorbed.

Note that the two are not strictly comparable: the CI run sampled 8 cases and the baseline is 22, and the two cases differ. What repeats is the mechanism and the story, not the number.

## What phase three should test

Not settled here. Three directions, in the order they look worth trying:

1. **A prompt rule against unsourced rationale.** The never claim list covers credentials and ownership. It does not say "do not explain why a technical decision was made unless the story says why." That is a small, testable addition, and the cheapest thing to try first.
2. **More real material in the thin stories.** This needs Tony's own knowledge, not invention, and only for stories where it is true and he could defend it in a room. It changes the dataset hash and therefore forces a re baseline.
3. **Neither, and accept 0.5.** If a hedged elaboration is genuinely what a good answer looks like, the case expectations are wrong rather than the model. Decide this deliberately rather than by default.

Whichever is tried, the measurement already exists: two cases with a known score and a known judge reason to compare against.
