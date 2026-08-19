# 0005 child: in process safety layers on the Beta planner

## Summary

Beta gets an output side safety layer it does not currently have, built in process with no new dependency and no AWS footprint. Beta stays on the direct Anthropic API on Sonnet 5, and the umbrella's data boundary promise survives untouched: Beta visitor content never leaves Render and Anthropic.

The pattern already exists in this repo. `conversation/ownership-guard.ts` evaluates the model's complete output against deterministic rules and, on failure, discards the generated text and substitutes safe copy, re chunking it so it still reads as streamed. Beta has nothing equivalent. Two layers close the gap: first, tighten the drafter's forced tool schema so unsafe plans cannot be represented at all, and second, a deterministic guard over the coach's output. A third layer, an LLM judge, is recommended against for v1 with reasons.

## The gap this closes, stated plainly

**Beta has no output side check of any kind.** Its screener is input side. Its two hard blocks (checked red flag box, constant rest pain escalation) are pre model. `parseDraftPlan` checks shape, not content. Nothing looks at what the drafter prescribed or what the coach wrote before a visitor reads it.

So the clinical surface, the one that tells injured people how to load an injured tendon, is missing the guard the work history chatbot already has. That is the whole reason for this child.

## Requirements

**User stories**:
- As an injured climber, I want the plan I am given to be incapable of telling me something harmful, not merely unlikely to.
- As the owner, I want Beta's safety to rest on code I can test rather than on prompt wording alone, so that a model that drifts cannot quietly take the product with it.
- As the owner, I want that safety to cost no new service, no new dependency, and no change to what leaves Render.

**Acceptance criteria**:

- **AC-G1**: no AWS is involved. Beta stays on the direct Anthropic API on Sonnet 5, and cross child contract clause 1 holds unchanged: Beta visitor content never leaves Render and the direct Anthropic API.
- **AC-G2**: the drafter's tool schema is built per request from `injuryArea` and `equipmentAccess`. An exercise outside the visitor's injury vocabulary, or requiring equipment they do not have, is not representable in the drafter's output.
- **AC-G3**: full crimp work is not representable for a `finger_pulley` plan. The vocabulary contains no such entry, so the skill file's "never program full-crimp training" becomes a structural fact rather than an instruction.
- **AC-G4**: exercise dosing is structured (`sets`, `reps`, optional `holdSeconds`, `frequencyPerWeek`) with schema enforced ceilings, and is rendered into prose by code. The coach is never in a position to alter a dose number.
- **AC-G5**: `overallCaution` is a required field when `painBehavior` is `constant_even_at_rest`, enforced by the schema built for that request.
- **AC-G6**: the coach's output is buffered in full, evaluated by the guard, and only then emitted, re chunked through the existing `splitIntoChunks` so it still arrives as multiple SSE events. A visitor never sees an unguarded token.
- **AC-G7**: when the guard rejects the coach's output, the visitor still receives a complete plan, rendered deterministically from the validated drafter object. No error card, no partial plan, and `planCount` still increments because the request succeeded.
- **AC-G8**: every rule in the guard's rule table is implemented, and each has tests covering both what it must catch and the legitimate rehab language it must not catch.
- **AC-G9**: a corpus of at least 30 realistic profiles across the three injury areas, including blunt injury description, profanity, and constant pain wording, produces zero guard firings in shadow mode before `enforce` is enabled.
- **AC-G10**: a deterministic injection check runs over `goals` before any model call and before `reserveGlobalSlot()`, and reuses the existing `REFUSAL_MESSAGE`.
- **AC-G11**: counters follow Beta's established tally pattern: `guardBlockCount` and `injectionBlockCount`, each incremented on its own event by a swallowed `safeIncrement` that can never disturb the response.
- **AC-G12**: with `BETA_OUTPUT_GUARD_MODE` unset or `off`, behavior is byte for byte today's and every existing beta spec passes unchanged.
- **AC-G13**: no new npm dependency, no new infrastructure, and no new configuration beyond the one mode flag.

## Options considered

### Option 1: Bedrock Guardrails (evaluated in depth, rejected)

Recorded so the reasoning is not lost. Two shapes were designed and costed: a standalone `ApplyGuardrail` check either side of Beta's model calls, and a two guardrail split with a permissive baseline enforced account wide plus a Beta specific clinical guardrail.

**Rejected because**:
- It requires amending the umbrella's cross child contract clause 1. Every variant sends Beta visitor content to AWS, because a guardrail must read content to judge it. The strongest variant required withdrawing the clause outright, since it moved Beta's generation to Bedrock too.
- Moving Beta to Bedrock costs Sonnet 5. Bedrock returns 403 for Sonnet 5 on this account, so the clinical reasoning core would have dropped to Sonnet 4.6.
- It would make the health feature depend on AWS for availability. An AWS incident would take Beta fully down, which is not true today.
- Per request `guardrailConfig` is not expressible on this stack. `@anthropic-ai/bedrock-sdk` emits Anthropic Messages shaped bodies, and Bedrock requires a top level `amazon-bedrock-guardrailConfig` object plus `guardContent` marker tags when the guardrail headers are present, failing HTTP 400 otherwise.
- Which meant the clinical half would have been applied by standalone calls the application chooses to make, so it would have been application enforced anyway. Having established that, the AWS version bought coverage and consistency rather than a stronger clinical guarantee, at the cost of three real things.

Bedrock stays the right answer for the interview simulator (Sonnet 4.6) and the feedback classifier (Haiku 4.5). Beta is the exception, deliberately.

### Option 2: in process layers, mirroring `ownership-guard.ts` (chosen)

Schema tightening plus a deterministic output guard, built the way this repo already builds this.

**Pros**: no new dependency, no new service, no boundary change, no availability coupling, fully testable under the repo's mocked test convention, and it reuses a pattern and a helper (`splitIntoChunks`) that already exist. Layer 1 in particular is prevention rather than detection, which no external guardrail can offer.
**Cons**: the rules are hand written and catch the phrasings they were written for, not every way a model could express the same idea, exactly as `ownership-guard.ts` says of itself in a comment. Maintaining them is on the owner, and nothing will remind anyone to revisit them when a skill file changes.

### Option 3: prompt hardening only

Strengthen the skill files and rely on the models to comply.

**Pros**: free, immediate, no code.
**Cons**: this is what exists today, and it is the thing the gap describes. A prompt cannot make an output impossible.

## Decisions awaiting ratification

**None of these is settled until the engineer ratifies it.**

### D1. Two layers, not three: schema tightening plus a deterministic guard

**Chosen**: layer 1 (make unsafe plans unrepresentable) and layer 2 (deterministic guard over the coach). **Runner up**: layer 2 alone, leaving the schema as it is, which is less work but leaves the drafter free to prescribe anything the prose rules did not anticipate.

Layer 1 is the higher value of the two and should be built first. Detection catches what you thought of; prevention catches what you did not, because the model is never offered the option.

### D2. Streaming: buffer the whole coach output, guard it, then re chunk

**Chosen**: the exact `ownership-guard` pattern. `onToken` accumulates without emitting, the guard sees the complete text, and `splitIntoChunks` re chunks whatever is finally shown. **Runner up**: guard each `## Stage n:` segment as it completes and stream segment by segment.

Costs are given in the Cost and latency section, but the reasoning is not primarily about latency. Beta's existing UI shows a partial plan stamped "the plan above was cut off, please don't follow a partial plan", and that stamp exists because partial plans are dangerous on this surface. Segment streaming would make the partial plan a routine state and would leave whole document rules (correct stage count, closing caution present) unable to fire until text was already on screen. Buffering moves in the opposite direction: the visitor never sees a plan that is not complete and not guarded.

The honest cost is a longer wait before the plan area fills. The remedy, if measurement says it matters, is not to weaken the guard but to show the validated drafter plan first and upgrade it to the coach's prose when the guard passes. That is recorded in Follow-up rather than built now.

### D3. Guard failure substitutes a rendered plan, not an error

**Chosen**: on failure, discard the coach's prose and render the plan deterministically from the validated drafter object. **Runner up**: the existing friendly error and refund path.

This is the Beta analogue of `requiredFraming ?? GENERIC_GUARD_FALLBACK`, and it is only possible because layer 1 makes the drafter's output structured enough to render. The plan itself was schema constrained and validated, so it is safe; only the warmth is lost. The visitor gets a complete plan instead of an error, no spend is wasted, and the request counts as the success it was.

### D4. No LLM judge in v1

**Chosen**: do not add a third model call to judge the output. **Runner up**: add it in shadow only.

Reasoning is in the Layer 3 section below.

## Decision

### Layer 1: make unsafe plans unrepresentable

The drafter is already a `forceToolCall` with a JSON schema, and the schema is constructed inside `runDrafter` at call time, where `input` is in scope. That means the schema can be built **per request**, which is what turns several prose rules in `drafter.md` into structural facts.

**Per request vocabulary.** `exercises[].name` becomes an enum rather than a free string. The vocabulary is a table in `beta.constants.ts` keyed by injury area, derived from `drafter.md`'s own injury specific sections, with each entry tagged with the equipment it needs and a load class. At call time the enum offered to the model is filtered to the visitor's `injuryArea` and their `equipmentAccess`.

| Injury area | Vocabulary (derived from `drafter.md`) |
|---|---|
| `finger_pulley` | tendon glides, open hand putty squeeze, rice bucket work, light finger massage, finger extensions against band, open hand isometric on a pick up block, open hand isometric on a hangboard with feet weighted, half crimp isometric under load, wrist and forearm stretch |
| `elbow_tendinopathy` | eccentric wrist curls, slow tempo wrist curls, reverse wrist curls, forearm massage, forearm stretching, band external rotation, rows, band pull aparts, scapular retraction |
| `shoulder_impingement` | pendulums, wall slides in pain free range, isometric external rotation at the side, band external rotation, rows, band pull aparts, serratus wall slides, push up plus, thoracic mobility, light overhead press |

Two consequences fall straight out. There is **no full crimp entry anywhere**, so `drafter.md`'s "Never program full-crimp training" stops being an instruction a model could drift from. And a visitor whose `equipmentAccess` is `none` is never offered a hangboard or band entry, so "Never invent gear" becomes structural too.

**Structured dosing.** `dose` stops being a free string and becomes an object with schema enforced ceilings:

| Field | Type | Range | Source |
|---|---|---|---|
| `sets` | integer | 1 to 5 | conservative rehab ceiling; `drafter.md`'s canonical example is 3 |
| `reps` | integer | 1 to 30 | as above; example is 10 |
| `holdSeconds` | integer, optional | 1 to 60 | for the isometric entries |
| `frequencyPerWeek` | integer | 1 to 7 | `drafter.md`: "modest and regular (roughly every other day)" |

The api then renders that object into the prose string the coach receives. This is the quiet win: **the coach never handles a dose number as text it could change.** `coach.md`'s "Keep every number exactly as drafted" stops depending on the coach.

**Counts matched to the skill file.** The current schema allows `exercises` `minItems: 1` and `advanceWhen` `minItems: 1` with no maximum, while `drafter.md` says 2 to 4 exercises and 2 to 3 advancement criteria. That is an existing mismatch. Tighten to `minItems: 2, maxItems: 4` and `minItems: 2, maxItems: 3`.

**A required rationale per stage.** A new `rationale` string, capped, placed **first** in the schema's property order so the model produces it before the prescriptions. It gives the guard and any future judge something to check against, and asking for reasoning before output tends to improve the output.

**Conditionally required caution.** When `painBehavior` is `constant_even_at_rest`, `overallCaution` is added to the schema's `required` array for that request. `drafter.md` calls it mandatory for that pain behavior; this makes it so.

**Two code level checks in `parseDraftPlan`**, deliberately only two, because a rejection here lands on the hard error path rather than the fallback renderer, so only high confidence rules belong:
1. The `half crimp isometric under load` entry may not appear in stages 1 or 2 (`drafter.md` places it in later stages).
2. Stage time windows must be non overlapping and increasing.

### Layer 2: the deterministic output guard

A new `beta-output-guard.ts`, the Beta analogue of `ownership-guard.ts`, exporting `evaluateCoachOutput(text, plan, input): GuardResult`. Same `{ ok: true } | { ok: false; reason: string }` shape, same lowercase substring approach, same honest limitation: it catches the obvious phrasing of each item, not every way a model could imply it.

The rules use a fact the coach is contracted to provide: its output format is fixed, with headingless opening and closing paragraphs, one `## Stage n:` heading per stage, and the labels `**When:**`, `**Climbing:**`, `**Do this:**`, `**Move on when:**`. That lets several rules be **scoped to the region where they apply** rather than run over the whole document, which is what keeps their false positive rates down.

| # | Rule | What it catches | What it must NOT catch |
|---|---|---|---|
| **R1** | Contraindicated pain phrasing. Blocklist: "push through the pain", "push through it", "work through the pain", "work through it", "no pain no gain", "ignore the pain", "tough it out", "power through", "pain is nothing to worry about" | The single most dangerous thing a rehab coach can say | The pain traffic light language the skill files mandate: "no more than about 3 out of 10", "settling by the next morning", "some discomfort is normal and expected", "'no pain' is not required". Rule keys on pain **plus** a push or ignore verb, never on the word pain alone |
| **R2** | Full crimp programming, scoped to `**Do this:**` bullet lines only | The coach adding crimp loading the drafter never prescribed | The legitimate cautionary uses everywhere else: "no crimping of any kind", "full crimp moves are the very last thing to return", and "half crimp", which is explicitly correct in later stages. Scoping to prescription lines is what makes this rule safe; a document wide substring match would fire on the skill file's own safety language |
| **R3** | Numeric fidelity. Every numeric token inside a stage section must also appear in that stage's drafter object | The coach inflating a dose, inventing "twice daily", or changing a grade or a week count | The `## Stage n:` heading number itself (excluded), and the opening and closing paragraphs (not stage sections). Every other number the coach legitimately writes came from the drafter, so it is present by construction |
| **R4** | Structural conformance. Exactly one `## Stage n:` heading per drafter stage, in order, each containing all four labels | A dropped, merged, or reordered stage, all forbidden by `coach.md` and all clinically material, since a dropped stage is a jump in load | Nothing. It is a format check against a format the coach is contracted to produce. Lowest false positive risk in the table and among the highest value |
| **R5** | Medication naming. Blocklist: ibuprofen, naproxen, advil, aleve, tylenol, paracetamol, acetaminophen, cortisone, corticosteroid, voltaren, diclofenac, nsaid, anti inflammatories | `drafter.md`: "Do not diagnose, name medications" | Nothing legitimate. Drug naming is outside the product's contract entirely, so a firing here is correct behavior, not a false positive |
| **R6** | Diagnosis asserted as fact. Narrow constructions: "you have torn", "you have a grade", "you have ruptured", "is torn", "diagnosed with", "this is definitely a" | The coach turning an educational plan into a clinical claim about this person | The visitor's own selected injury label ("your finger pulley strain", "climber's elbow"), and general education ("pulley strains usually", "this kind of injury often"). The **weakest rule in the table** and the one most likely to need loosening during calibration |
| **R7** | Promised recovery as fact. Blocklist: "you will be back", "you will be climbing again", "you will fully recover", "guaranteed", "you will be healed" | `drafter.md`: do not "promise recovery timelines as fact"; `coach.md`: "say 'climbers usually find' rather than 'you will'" | The stage time windows themselves, which are explicitly guidance and allowed; "climbers usually find", "most climbers", "typically"; and ordinary uses of "you will feel" or "you will notice" |
| **R8** | Mandatory caution carried through. When `painBehavior` is `constant_even_at_rest`, the closing section must carry the drafter's `overallCaution` | The coach dropping the one caution the skill file calls mandatory | Rephrasing, which the coach is supposed to do. Checks for the caution's key terms, not an exact string match |

Rules R1, R5, R6 and R7 are blocklists over the whole document. R2 is scoped to prescription lines. R3 and R4 are scoped per stage section. R8 is scoped to the closing.

### Layer 3: an LLM judge, recommended against for v1

**Do not build it.** Five reasons:

1. It adds a fourth model call to a path that already makes three, inside a 40 per day global budget and a 60 second per call timeout budget, for roughly a third more latency and spend on every plan.
2. It is itself fallible and non deterministic, so it needs its own failure decision. A judge that fails open adds nothing anyone can rely on; a judge that fails closed adds a new way to refuse an injured person.
3. It cannot be gated by this repo's test convention, which is fully mocked with no network. Layers 1 and 2 are deterministic and testable; a judge is neither.
4. Its marginal catch rate is low once layers 1 and 2 exist. The plan content is schema constrained and the coach cannot drift numerically or structurally, so what remains is semantically poor but structurally valid advice, produced by Sonnet 5 working from a detailed skill file.
5. When it is worth adding, the right shape is not a runtime gate. It is a **shadow judge that logs where it disagrees with the deterministic guard**, used to discover missing layer 2 rules. That is a tool for improving layer 2, and it belongs in a later child if the owner wants it.

### The input side check

`goals` is the only untrusted free text in a Beta request, capped at 200 characters by the DTO, because every other field is an enum validated by `IsIn` or a grade constrained by regex to 12 characters. So an input guard here is not a general content filter, it is a cheap prompt attack check.

A small blocklist over the lowercased `goals` ("ignore your instructions", "ignore the above", "disregard your", "you are now", "system prompt", "new instructions", "act as"), run **before any model call and before `reserveGlobalSlot()`**, like the two existing hard blocks. It costs nothing, adds no latency, and saves a screener call on the blatant cases. On a hit the visitor sees the existing `REFUSAL_MESSAGE`, exactly as an `off_topic` screener verdict produces today, so no new copy and no web client change.

It does not replace the screener's `off_topic` verdict, which stays as the layer that understands language rather than matching strings.

### Streaming and what the visitor sees

The coach call changes to `onToken: () => undefined`, accumulating without emitting, exactly as `conversation.service.ts` does. The guard runs on the complete text. Then either the coach's prose or the rendered fallback is emitted through `splitIntoChunks` as a series of `plan_delta` events.

| Situation | What the visitor gets | New copy |
|---|---|---|
| Guard passes | the coach's prose, re chunked, indistinguishable from today | no |
| Guard fails | the complete plan, rendered deterministically from the drafter object, in plainer language | no visitor facing message; the substitution is silent by design, because announcing it would alarm without informing |
| Injection check hits | the existing `REFUSAL_MESSAGE` through the existing error path | no |
| Screener red flag | the existing red flag card | no |
| Upstream failure | the existing friendly error and the existing partial plan warning | no |

Nothing in this child adds a visitor facing string. The existing "cut off, do not follow a partial plan" warning stays for genuine mid stream upstream failures, and becomes rarer, because guard failures no longer produce partial plans.

### Counters

Two new columns on `BetaDailyUsageCounter`, following the module's established pattern.

| Column | Counts | Incremented from |
|---|---|---|
| `guardBlockCount` | coach outputs rejected, where the rendered fallback was shown instead | standalone `safeIncrement`, swallowed and logged |
| `injectionBlockCount` | pre model injection blocks on `goals` | standalone `safeIncrement`, like `recordRedFlagBlock` |

Neither is a refund reason. A guard failure still delivers a complete plan, so the request succeeded and `planCount` increments as normal, which is the correct reading of Beta's success only semantics. The injection block happens before a slot is reserved, so like the two existing hard blocks it never reaches the refund bookkeeping.

One structured log line on a guard firing, carrying the rule name and never the matched visitor or model text, mirroring `ownership-guard`'s `logger.warn` at its call site.

### Code shape

- `apps/api/src/modules/beta/beta-output-guard.ts`: `evaluateCoachOutput`, the rule constants, and `renderPlanFallback(plan, input)`. Pure functions, no injection, no I/O, directly mirroring `ownership-guard.ts`.
- `apps/api/src/modules/beta/beta.constants.ts`: the per injury vocabulary table with equipment and load class tags, the dose ceilings, and the injection blocklist.
- `beta.service.ts`: builds the drafter schema per request, renders dose strings, buffers the coach, calls the guard, emits through `splitIntoChunks` imported from the conversation module (as the conversation service already does).
- No new module, no new provider, no new dependency.

## Value sourcing

| Action | Value produced | Source |
|---|---|---|
| Drafter schema | allowed exercise vocabulary | the constants table, filtered by `input.injuryArea` and `input.equipmentAccess` |
| Drafter schema | dose ceilings | the constants table, derived from `drafter.md` |
| Drafter schema | whether `overallCaution` is required | `input.painBehavior` at call time |
| Coach input | dose prose | rendered by code from the structured dose object, never by the model |
| Guard | expected stage count and per stage numbers | the parsed `DraftPlan` object |
| Guard | whether R8 applies | `input.painBehavior` |
| Fallback | plan text | `renderPlanFallback` over the validated `DraftPlan` |
| Guard mode | off, shadow, or enforce | env `BETA_OUTPUT_GUARD_MODE` |
| Injection block | visitor copy | existing `REFUSAL_MESSAGE` |

## Key invariants

- Every invariant in the api's "Beta module invariants" gotcha holds unchanged. Both code enforced hard blocks still run first, `planCount` is still success only, no visitor content is written or logged.
- **Cross child contract clause 1 holds unchanged.** Beta visitor content never leaves Render and the direct Anthropic API. This child adds nothing that crosses a boundary.
- Beta stays available when AWS is not, because Beta does not use AWS.
- The guard can never manufacture clinical content. It can only substitute the drafter's own validated plan, rendered by a fixed template.
- A visitor never sees coach prose that has not been through the guard.
- The safety critical copy stays human written and deterministic, as `beta.constants.ts` already establishes.

## Configuration required

- `BETA_OUTPUT_GUARD_MODE`: `off` (default), `shadow` (evaluate, count, log, but still show the coach's prose), or `enforce`. The only new configuration in this child.
- Layer 1 has no flag. A schema is not shadowable at runtime, so it is calibrated before it ships (see the build plan) rather than gated behind a flag.

## Cost and latency

**Cost**: zero. No new service, no new calls, no new billing surface. Layer 1 marginally reduces drafter output tokens by replacing free text exercise names and dose strings with enum values and integers.

**Latency**: layers 1 and 2 add no network calls. The guard is string matching over a few kilobytes, microseconds. The whole latency question is the buffering decision.

Time to the first visible plan text today is screener plus drafter plus the coach's first token. Buffering makes it screener plus drafter plus the coach's **complete** generation. The coach runs at `maxTokens: 4000`, so on a full plan the added wait is the coach's whole generation rather than its first token, which is the dominant cost of this design.

For scale, this is why the precedent does not feel slow: the conversation guard buffers a response capped at `maxTokens: 400`, ten times smaller. Beta is the harder case and the spec should not pretend otherwise.

Two mitigations, neither requiring a weaker guard. The pipeline status chips (Screening, Drafting, Coaching) already tell the visitor work is happening, and the Coaching chip now genuinely covers the whole coach phase. And if measurement says the wait is unacceptable, the fix is to render the validated drafter plan as soon as the drafter returns and upgrade it to the coach's prose when the guard passes, which improves time to first text below today's. That is in Follow-up, not in this build.

## Critical test scenarios

All mocked, no network, colocated `.spec.ts`, per the repo's convention. `beta-output-guard.spec.ts` mirrors the structure of the existing ownership guard tests.

- Layer 1 schema construction: the schema built for a `finger_pulley` request contains no full crimp entry; the schema for `equipmentAccess: ['none']` contains no hangboard or band entry; the schema for `painBehavior: 'constant_even_at_rest'` lists `overallCaution` in `required`. Verifies **AC-G2**, **AC-G3**, **AC-G5**.
- Dose rendering: a structured dose becomes the expected prose string, and the string handed to the coach matches it exactly. Verifies **AC-G4**.
- `parseDraftPlan`: rejects a half crimp isometric in stage 2, and rejects overlapping time windows.
- Guard, one test per rule for what it catches, and one per rule for what it must not: the pain traffic light phrasing passes R1; "no crimping of any kind" and "half crimp" pass R2; the stage heading number passes R3; "climbers usually find" passes R7; the visitor's own injury label passes R6. Verifies **AC-G8**.
- Guard failure path: a coach output tripping R1 results in the rendered fallback being emitted, `planCount` incremented, `guardBlockCount` incremented, and no error event. Verifies **AC-G7**, **AC-G11**.
- Buffering: the coach's `onToken` never emits, and every `plan_delta` the client receives arrives after the guard ran. Verifies **AC-G6**.
- Shadow mode: the guard evaluates and counts but the coach's prose is still shown. Mode `off`: the guard never runs and existing specs pass untouched. Verifies **AC-G12**.
- Injection check: a `goals` value containing "ignore your instructions" produces `REFUSAL_MESSAGE` with zero model calls and no slot reserved. Verifies **AC-G10**.
- Live corpus run (manual, in shadow): at least 30 realistic profiles across the three injury areas, including blunt injury description, profanity, and constant pain wording. Zero guard firings before `enforce`. Verifies **AC-G9**.

## Build plan

Tracer Bullet ordering, prevention before detection, and nothing a visitor sees changes until step 6.

1. Layer 1 constants: the per injury vocabulary table with equipment and load class tags, the dose ceilings, the injection blocklist. Pure data plus unit tests. Satisfies **AC-G2** groundwork.
2. **Calibration run for layer 1**, before it is enforced: generate a set of plans against the current loose schema across all three injury areas and every equipment combination, and check that the drafter never wants a value the new vocabulary lacks. A vocabulary that is too tight produces hard errors, so this is the gate. Widen the table if needed.
3. Layer 1 in place: build the drafter schema per request, structure the dose, render dose prose in code, tighten the item counts, add `rationale`, add the conditional `overallCaution`, add the two `parseDraftPlan` checks. Satisfies **AC-G2**, **AC-G3**, **AC-G4**, **AC-G5**.
4. `beta-output-guard.ts`: all eight rules plus `renderPlanFallback`, with the catch and non catch tests. No call site yet. Satisfies **AC-G8**.
5. Migration adding `guardBlockCount` and `injectionBlockCount`, and the injection check at the top of `generatePlan`. Satisfies **AC-G10**, **AC-G11**.
6. Wire the guard in at mode `shadow`: buffer the coach, evaluate, count, log, but still show the coach's prose. Satisfies **AC-G12**.
7. The corpus run and rule tuning. Zero false positives is the gate on proceeding, not a nice to have. R6 is the rule most likely to need loosening. Satisfies **AC-G9**.
8. Flip to `enforce`: the fallback renderer becomes live. Satisfies **AC-G6**, **AC-G7**.
9. Gate and ship: `/predeploy-audit` with the clinical safety auditor, since this changes what an injured visitor reads and what the drafter is allowed to prescribe. Deploy at `shadow`, promote to `enforce` after the soak as an env change.

## Migration plan

**Strategy**: feature flagged for layer 2, calibrated for layer 1, no data migration beyond two additive counter columns defaulting to zero.

**Phases**:
1. Layer 1 ships enforced, after its calibration run. It changes what the drafter can produce, so it is the phase to watch for hard errors.
2. Layer 2 ships at `off`, then `shadow`, then `enforce`.

**Rollback**: layer 2 by env var. Layer 1 has no flag, so its rollback is a revert; the calibration run in step 2 exists precisely to make that unlikely.

**Risks**: a vocabulary that is too tight makes the drafter fail, and a drafter failure lands on the hard error path rather than the fallback renderer, because the fallback needs a valid plan to render. That is the one place where this design can make things worse rather than better, and it is why layer 1 is calibrated before it ships and why only two code level checks were added to `parseDraftPlan`.

## Consequences

**Positive**:
- The clinical surface gains the output side check it did not have, closing a gap the work history chatbot had already closed.
- Layer 1 is prevention, not detection. A full crimp prescription for a torn pulley, or a hangboard exercise for someone with no hangboard, stops being unlikely and becomes impossible.
- The coach can no longer alter a dose number, because it never receives one as editable text.
- The data boundary promise survives intact, Beta keeps Sonnet 5, and Beta stays up when AWS is down.
- A guard failure now delivers a complete plan instead of an error, which is strictly better than the current partial plan behavior.
- Zero cost, zero new dependencies, zero new infrastructure.

**Negative and tradeoffs**:
- **Buffering the coach delays the plan.** The visitor waits for the coach's whole generation rather than its first token, on a model call capped at ten times the token budget the existing buffered guard handles. This is the real price of the design.
- The rules are hand written and catch the phrasings they anticipate. `ownership-guard.ts` admits this about itself in a comment, and the same honesty applies here.
- Layer 1 couples the schema to `drafter.md`. If the skill file's vocabulary changes and the table does not, the drafter starts failing, and nothing in the repo will point at the cause.
- R6, the diagnosis rule, is the weakest and carries the highest false positive risk on a surface where a false positive means an injured person gets a plainer plan than they should have.
- Two more columns on `BetaDailyUsageCounter`, a table spec 0004 already flagged as heading toward a generalized redesign.
- The AWS learning goals of the umbrella get nothing from this child. That is the correct outcome for the product and a real cost against the certification track.

**Neutral**:
- Beta becomes the only surface not on Bedrock, deliberately and for stated reasons.
- `splitIntoChunks` gains a second consumer, which is mild evidence it belongs somewhere more common than the conversation module.

## Follow-up

- [ ] Measure the real time to first plan text after buffering. If it is unacceptable, build the improvement rather than weakening the guard: render the validated drafter plan as soon as the drafter returns, and upgrade it to the coach's prose when the guard passes. That would put time to first text below today's.
- [ ] Decide the self harm and crisis question: whether a visitor expressing genuine distress should be detected at all, and what the response is. Still a clinical judgement for a human, and it still belongs in the screener with its own human written referral copy, not in a blocklist.
- [ ] The provider swap child names Sonnet 5 as its Bedrock default, which is stale: Sonnet 5 returns 403 for this account and the interview simulator is live on `us.anthropic.claude-sonnet-4-6`. That child needs a correction pass, independent of this one.
- [ ] Consider a shadow LLM judge later, purely to find rules layer 2 is missing. Not a runtime gate.
- [ ] Add a note to `drafter.md` and `coach.md` saying that the vocabulary table, the dose ceilings, and the guard rules are derived from them, so a future edit to either prompts a look at the constants.
- [ ] After shipping, add a line to the api's "Beta module invariants" gotcha recording that the coach is buffered and guarded, and that a guard failure substitutes a rendered plan rather than an error.

## Inline rationale

The decisive observation is that Beta has no output side check while `conversation` does. Once that is said out loud, the shape of the answer follows from the repo rather than from a product catalogue: there is already a guard that evaluates a complete model output against deterministic rules, substitutes safe copy on failure, and re chunks so the result still streams. Beta needs the same thing, and the reasons it is harder are specific and addressable.

Layer 1 is where most of the value is, and it exists because of a detail in the current code: the drafter's schema is built inside `runDrafter`, where the request is in scope, so it can be built per request. That turns three prose rules in `drafter.md` into structural facts. No full crimp entry exists for a pulley injury. No hangboard entry exists for someone with no hangboard. The mandatory caution is a required field for the pain behavior that mandates it. None of that is detection, so none of it can be evaded by phrasing.

The second useful detail is that both skill files specify output formats precisely, which lets layer 2's rules be scoped to the region where they apply. That is what makes a full crimp rule safe: run over the whole document it would fire on the skill file's own safety language ("no crimping of any kind"), but scoped to prescription lines it fires only on a prescription.

The uncomfortable part is buffering. Beta's plans are long and the wait is real, and the temptation is to stream segment by segment and guard each one. The reason not to is that Beta's UI already carries a warning about partial plans, written because partial plans are dangerous here. A design that makes the partial plan a routine state is moving the wrong way on a clinical surface, and the honest fix for the wait is a better first paint, not a weaker guard.
