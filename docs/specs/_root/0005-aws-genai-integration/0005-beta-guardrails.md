# 0005 child: in process safety layers on the Beta planner

## Summary

Beta gets an output side safety layer it does not currently have, built in process with no new dependency and no AWS footprint. Beta stays on the direct Anthropic API on Sonnet 5, and the umbrella's data boundary promise survives untouched: Beta visitor content never leaves Render and Anthropic.

The pattern already exists in this repo. `conversation/ownership-guard.ts` evaluates the model's complete output against deterministic rules and, on failure, discards the generated text and substitutes safe copy, re chunking it so it still reads as streamed. Beta has nothing equivalent. Two layers close the gap: first, constrain the drafter to what `drafter.md` explicitly requires and forbids, so the model cannot drift past it, and second, a deterministic guard over the coach's output. A third layer, an LLM judge, is recommended against for v1 with reasons.

Layer 1 is a **fidelity constraint, not a clinical prescription**, and that distinction governs the whole design. It makes no new claim about what the right exercises or doses are. The clinical content already exists in the prompt and already ships; layer 1 only reduces the variance around it. Alongside the two layers, this child also fixes where Beta says its plans are educational rather than clinically binding, by moving that statement from a sentence the model writes to an element the page always renders.

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
- **AC-G2**: layer 1 contains no allowlist of permitted exercises. `exercises[].name` remains a free string, and every constraint in the layer traces by a source comment to an explicit requirement or prohibition in `drafter.md`. Nothing in it originates from a judgement about what is clinically valid.
- **AC-G3**: the drafter's tool schema is built per request. Each exercise carries a required `equipmentUsed` enum filtered to the visitor's reported `equipmentAccess`, so an exercise declaring gear the visitor does not have is not representable, transcribing "Only prescribe equipment the visitor has" and "Never invent gear". Item counts are 2 to 4 exercises and 2 to 3 advancement criteria, transcribing the numbers the skill file states.
- **AC-G4**: `parseDraftPlan` rejects a `finger_pulley` plan whose exercise names reference full crimp anywhere, or reference crimping at all in stage 1, transcribing "Never program full-crimp training" and the early phase's "No crimping of any kind". These sit on the drafter's output, not only in layer 2, because the guard fallback renders the drafter's plan verbatim.
- **AC-G5**: exercise dosing is structured (`sets`, `reps`, optional `holdSeconds`, `frequencyPerWeek`) and rendered into prose by code, so the coach is never in a position to alter a dose number. Its numeric bounds are variance bounds derived from the calibration run's observed range with headroom, documented as such in the constants file, and explicitly not a clinical dose limit.
- **AC-G5b**: `overallCaution` is a required field when `painBehavior` is `constant_even_at_rest`, enforced by the schema built for that request, transcribing the skill file's "MANDATORY ... never omit it for this pain behavior".
- **AC-G6**: the coach's output is buffered in full, evaluated by the guard, and only then emitted, re chunked through the existing `splitIntoChunks` so it still arrives as multiple SSE events. A visitor never sees an unguarded token.
- **AC-G7**: a guard rejection branches on where the violation lives, because the fallback can only repair one of the two cases.
  - **`source: 'coach'`** — the drafted plan is clean and only the coach's prose broke a rule. The visitor still receives a complete plan, rendered deterministically from the validated drafter object. No error card, no partial plan, and `planCount` still increments because the request succeeded.
  - **`source: 'plan'`** — the drafter's OWN free text broke a content rule (R1/R5/R6/R7 over `evaluatePlanContent`). The request takes the hard error path instead: the global slot is refunded, `planCount` does **not** increment, and the visitor sees `FRIENDLY_ERROR_MESSAGE` with no plan. This is deliberate, not a gap. `renderPlanFallback` renders the drafter's fields verbatim, so substituting it would reprint the exact text the rule just rejected, stripped of the coach's hedging — enforce mode would be strictly worse than shadow. No plan is better than a plan carrying content a safety rule rejected.

  The visitor's work is not lost permanently in the `plan` case: the refund plus the drafter's nondeterminism mean a retry usually succeeds, so the cost is one retry rather than the thirty questions.
- **AC-G8**: every rule in the guard's rule table is implemented, and each has tests covering both what it must catch and the legitimate rehab language it must not catch.
- **AC-G9**: a corpus of at least 30 realistic profiles across the three injury areas, including blunt injury description, profanity, and constant pain wording, produces zero guard firings in shadow mode before `enforce` is enabled. The gate must run over **both** surfaces the guard now covers: the coach's prose *and* the drafter's plan object via `evaluatePlanContent`. The plan surface matters more, not less, because a firing there is a hard error (AC-G7, `source: 'plan'`) rather than a silent fallback — a corpus run that only exercised the coach's prose would certify the cheaper half of the rule set.
- **AC-G10**: a deterministic injection check runs over `goals` before any model call and before `reserveGlobalSlot()`, and reuses the existing `REFUSAL_MESSAGE`.
- **AC-G11**: counters follow Beta's established tally pattern: `guardBlockCount` and `injectionBlockCount`, each incremented on its own event by a swallowed `safeIncrement` that can never disturb the response.
- **AC-G12**: with `BETA_OUTPUT_GUARD_MODE` unset or `off`, behavior is byte for byte today's and every existing beta spec passes unchanged.
- **AC-G13**: no new npm dependency, no new infrastructure, and no new configuration beyond the one mode flag.
- **AC-G14**: every plan a visitor receives carries the canonical educational framing as an element the page always renders, on the coach path and the guard fallback path alike, verified by a test asserting it is present in both. The framing string exists once, and the paired removal ships with it: `coach.md` stops asking the model to state it, so the number of educational statements a visitor meets does not increase. The red flag card copy, the stop conditions list, the mid stream cutoff warning, and the four disclaimer gate bullets are byte identical afterwards, asserted by tests over those strings.

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

### D1. Two layers, not three: constrain the drafter, then guard the coach

**Chosen**: layer 1 (hold the drafter to what the prompt explicitly requires and forbids) and layer 2 (deterministic guard over the coach). **Runner up**: layer 2 alone, leaving the drafter untouched, which is less work but leaves the plan object itself unchecked, and the guard fallback renders that object verbatim.

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

### Layer 1: constrain the drafter to what the prompt explicitly requires and forbids

**This is a fidelity constraint, not a clinical prescription, and the difference is load bearing.**

The wrong framing would be "these are the correct exercises and dose ceilings for this injury". That is a clinical claim, it needs standing the author does not have, and hardening it into a schema would freeze one person's judgement into a permanent ceiling on what the product can ever prescribe.

The right framing, and the one this layer is built on, is "the model may only do what `drafter.md` already says it may do". That is a constraint against the model drifting past content that already exists and already ships to visitors today. It needs accurate reading, not clinical judgement.

The clinical content is not new. It is in the prompt now, and every plan Beta has ever produced was drawn from it. Layer 1 adds no clinical claim; it reduces the variance around advice that is already being given.

**The test that decides what belongs here.** This is the generalising principle, and anyone extending this layer later should apply it before adding anything:

> A positive **allowlist** requires knowing everything that is clinically valid. That is judgement, and it is out of scope.
> A negative constraint on what `drafter.md` **explicitly forbids or explicitly requires** needs only reading the file. That is transcription, and it is in scope.

**What that test excludes, headline first.** An enumerated vocabulary of permitted exercises was specified in an earlier draft of this spec and has been **dropped**. `drafter.md`'s injury specific exercise lists are illustrative, not exhaustive (confirmed by the author, 2026-08-19), so enumerating them would close a list that was never meant to be closed. That is a clinical narrowing wearing a fidelity label, and it is exactly what this layer must not be. Asking the author to widen the table with his own additions was considered and rejected for the same reason: it is still a clinical call about what belongs.

So `exercises[].name` stays a **free string**. Also out of scope, each because it is a decision rather than a reading:

- Which exercises are clinically valid for an injury. The drafter's job, and it stays the drafter's job.
- Absolute safe maxima for any dose. See the bounds note below.
- Which stage an exercise "should" appear in, beyond placements `drafter.md` states in words.
- Grade offset arithmetic across V scale, YDS, and French. Not cleanly structurable, so `allowedClimbing` keeps its free text and is covered by layer 2.

**What survives, and it is still five real constraints.** The drafter is already a `forceToolCall` whose schema is constructed inside `runDrafter`, where `input` is in scope, so the schema can be built **per request**. That is what turns several explicit instructions into structural facts.

*1. Item counts, in the schema.* The current schema allows `exercises` `minItems: 1` and `advanceWhen` `minItems: 1` with no maximum, while `drafter.md` states 2 to 4 exercises and 2 to 3 advancement criteria. That is an existing contradiction between prompt and schema. Tighten to `minItems: 2, maxItems: 4` and `minItems: 2, maxItems: 3`. Pure transcription of stated numbers.

*2. Equipment, in the schema, per request.* `drafter.md` says "Only prescribe equipment the visitor has" and "Never invent gear". Each exercise gains a required `equipmentUsed` field, an enum drawn from the **existing** `EQUIPMENT_ACCESS` constant and filtered at call time to what the visitor actually reported. The model must declare what gear an exercise needs, and it can only declare gear the visitor has.

This is the mechanism that replaces the dropped allowlist for this dimension, and it is strictly better suited to it: it constrains the **gear**, never the exercise, so it enforces the instruction without expressing any opinion about what a valid exercise is. The enum it uses already ships in `beta.constants.ts` and is the same list the form offers the visitor, so nothing new is being decided.

*3. Conditional caution, in the schema, per request.* When `painBehavior` is `constant_even_at_rest`, `overallCaution` joins the schema's `required` array for that request, transcribing "a MANDATORY `overallCaution` (never omit it for this pain behavior)".

*4. Structured dose shape, in the schema, with variance bounds rather than clinical ceilings.* `dose` stops being a free string and becomes an object with integer fields: `sets`, `reps`, optional `holdSeconds`, and `frequencyPerWeek`.

The **shape** is pure fidelity: integers instead of prose remove "some" and "a few", which `drafter.md` already forbids ("Every number you output must be concrete, not a range like 'some'"), and they let the api render the dose so the coach never handles it as editable text.

The **bounds** are where the operating test bites a second time. `drafter.md` gives examples ("3 sets of 10, every other day", maintenance "1-2 times a week") but states no maximum, so any specific ceiling would be a decision. Therefore: bounds are set from the range the drafter is **observed** to produce during the calibration run, widened with generous headroom. They exist to catch runaway drift (fifty sets, six sessions a day), not to encode a dose recommendation, and the constants file must say so in a comment so no later reader mistakes them for clinical limits. If the calibration run is not done, the correct fallback is positive integers with no upper bound, which still delivers the anti drift benefit of the structured shape.

*5. Explicit prohibitions, in `parseDraftPlan`.* These are negative constraints on the drafter's output, keyed to prohibitions `drafter.md` states in so many words. They live in code rather than the schema because a free string field cannot express them, and they are deliberately few, because a rejection here lands on the hard error path.

| Check | Transcribes |
|---|---|
| No exercise name in any stage may reference full crimp, for a `finger_pulley` plan | "Never program full-crimp training" |
| No exercise name in **stage 1** may reference crimping at all, for a `finger_pulley` plan | the early phase's "No crimping of any kind" |
| `timeWindow` is present and non empty | "`timeWindow` — a concrete range, e.g. 'Weeks 1-2'" |

An earlier draft wrote the crimp stage rule as "stages 1 or 2", which required mapping the skill file's three phases (early, middle, later) onto four or five stages. That mapping is a decision, so under the test it is excluded and the rule is narrowed to the part that transcribes.

**A third rule was listed here and has been removed: "stage time windows must be non overlapping and increasing."** It failed the same test. It was justified as "a structural property, not a clinical one", but no line in `drafter.md` states it — and line 16, the only line about `timeWindow` at all, actively contradicts it: windows are "guidance, not promises", "the `advanceWhen` criteria are what actually gate progression, and stages may need repeating". A plan that repeats a stage, or that overlaps two windows because the criteria rather than the calendar decide the handover, is exactly what that line describes, and the check rejected it on the **hard error path**, costing the visitor the whole plan. What the line does support is the weaker check that survives: present and non empty. The prompt's own schema description carried the removed wording for a while after the check went; it now matches line 16.

*One addition that is not a constraint.* A new capped `rationale` string per stage, placed **first** in the schema's property order so the model produces it before the prescriptions. It is listed separately because it does not fit the test above and does not need to: it restricts nothing and encodes no view about what is valid. It only asks the drafter to state its reasoning, which gives the guard and any future judge something to check against, and asking for reasoning before output tends to improve the output.

**Why these checks must sit on the drafter's output and not only in layer 2.** The guard fallback renders the drafter's plan verbatim when the coach's prose is rejected. If a forbidden prescription reached the plan object, the fallback would faithfully ship it. So the drafter side checks are what make the fallback safe to use at all, and moving them into layer 2 would quietly break that guarantee.

### Layer 2: the deterministic output guard

A new `beta-output-guard.ts`, the Beta analogue of `ownership-guard.ts`, exporting `evaluateCoachOutput(text, plan, input): GuardResult`. Same `{ ok: true } | { ok: false; reason: string }` shape, same lowercase substring approach, same honest limitation: it catches the obvious phrasing of each item, not every way a model could imply it.

The rules use a fact the coach is contracted to provide: its output format is fixed, with headingless opening and closing paragraphs, one `## Stage n:` heading per stage, and the labels `**When:**`, `**Climbing:**`, `**Do this:**`, `**Move on when:**`. That lets several rules be **scoped to the region where they apply** rather than run over the whole document, which is what keeps their false positive rates down.

| # | Rule | What it catches | What it must NOT catch |
|---|---|---|---|
| **R1** | Contraindicated pain phrasing. A cross product of push-past verbs ("push through", "work through", "power through", "fight through", "train through") against pain objects ("pain", "soreness", "discomfort", "ache", "aching", each both bare and after "the"), plus the standalone phrases "push through it", "no pain no gain", "ignore the pain", "tough it out", "pain is nothing to worry about" | The single most dangerous thing a rehab coach can say | The pain traffic light language the skill files mandate: "no more than about 3 out of 10", "settling by the next morning", "some discomfort is normal and expected", "'no pain' is not required". Rule keys on pain **plus** a push or ignore verb, never on the word pain alone — which is also what lets "you rebuild power through progressive loading" and "work through it one stage at a time" pass. The bare "work through it" and "power through" the first draft listed were dropped for firing on exactly those |
| **R2** | Full crimp programming, scoped to `**Do this:**` bullet lines only | The coach adding crimp loading the drafter never prescribed | The legitimate cautionary uses everywhere else: "no crimping of any kind", "full crimp moves are the very last thing to return", and "half crimp", which is explicitly correct in later stages. Scoping to prescription lines is what makes this rule safe; a document wide substring match would fire on the skill file's own safety language |
| **R3** | Numeric fidelity. Every numeric token inside a stage section must also appear in that stage's drafter object | The coach inflating a dose, inventing "twice daily", or changing a grade or a week count | The `## Stage n:` heading number itself, `stage <n>` cross-references between sections ("move on to stage 3"), and the opening and closing paragraphs (not stage sections). Cross-references are **stripped from the scanned text**, not added to the allowed set: allowing the ordinals as digits would admit "1".."5" document wide, which is where nearly every rehab dose integer lives, and would silently gut the rule. Every other number the coach legitimately writes came from the drafter, so it is present by construction |
| **R4** | Structural conformance. Exactly one `## Stage n:` heading per drafter stage, in order, each containing all four labels, and the same number of `**Do this:**` bullets as that stage has exercises | A dropped, merged, or reordered stage or exercise, all forbidden by `coach.md`'s "Do not add, remove, merge, or reorder stages or exercises" and all clinically material, since a dropped stage is a jump in load | Nothing. It is a format and count check against a format the coach is contracted to produce. Lowest false positive risk in the table and among the highest value |
| **R5** | Medication naming. Blocklist: ibuprofen, naproxen, advil, aleve, tylenol, paracetamol, acetaminophen, cortisone, corticosteroid, voltaren, diclofenac, nsaid, anti inflammatories | `drafter.md`: "Do not diagnose, name medications" | Nothing legitimate. Drug naming is outside the product's contract entirely, so a firing here is correct behavior, not a false positive |
| **R6** | Diagnosis asserted as fact. Narrow constructions, each carrying its own assertion marker: "you have torn", "you have a tear", "you tore", "you have ruptured", "you ruptured", "you have a grade 1/2/3" and "you have a grade II", "is definitely torn", "is clearly torn", "diagnosed with", "this is definitely a" | The coach turning an educational plan into a clinical claim about this person | The visitor's own selected injury label ("your finger pulley strain", "climber's elbow"); general education ("pulley strains usually", "this kind of injury often"); hypothetical teaching ("if a pulley is torn, you would usually feel a pop"), which is why the bare "is torn" was dropped; and the **climbing** sense of "grade" ("once you have a grade you can climb comfortably"), which is why the grade entry now requires the clinical ordinal. The **weakest rule in the table** and the one most likely to need loosening during calibration |
| **R7** | Promised recovery as fact. Blocklist: "you will be back", "you will be climbing again", "you will fully recover", "you will be healed", and the forward promise constructions "guaranteed to recover / heal / be back / be climbing", "guaranteed recovery", "guaranteed full recovery", "guaranteed return" | `drafter.md`: do not "promise recovery timelines as fact"; `coach.md`: "say 'climbers usually find' rather than 'you will'" | The stage time windows themselves, which are explicitly guidance and allowed; "climbers usually find", "most climbers", "typically"; ordinary uses of "you will feel" or "you will notice"; and negated hedges, which is why bare "guaranteed" was dropped — it fired on "no timeline here is guaranteed", precisely the under-promising `coach.md` asks for. The passive "X is guaranteed" is deliberately unmatched for the same reason |
| **R8** | Mandatory caution carried through. When `painBehavior` is `constant_even_at_rest`, the closing section must carry the drafter's `overallCaution` | The coach dropping the one caution the skill file calls mandatory | Rephrasing, which the coach is supposed to do. Checks for the caution's key terms, not an exact string match |

Rules R1, R5, R6 and R7 are blocklists over the whole document. R2 is scoped to prescription lines. R3 and R4 are scoped per stage section. R8 is scoped to the closing.

**Exercise name validation lives here, and follows the same test as layer 1.** With no allowlist upstream, layer 2 is where exercise naming is checked, and its rules must key on what the skill files **explicitly prohibit**, never on a notion of what is clinically appropriate. R2 is the model for that: it exists because `drafter.md` says "Never program full-crimp training", not because someone judged full crimp inadvisable. Any rule added here later must be able to cite the line it transcribes, or it does not belong.

R2's scope is now narrower than it looks, and deliberately so. The drafter side check in layer 1 already rejects a plan that prescribes full crimp, so by the time the coach runs, a full crimp reference in a prescription line means the **coach** introduced it. That is the only thing R2 is left to catch, which is why it can afford to be tightly scoped.

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

### Educational positioning, fixed where it actually matters

Beta should be unmistakably educational and not clinically binding. The audit below found the framing is already present in five places and genuinely good in most of them. The problem is not quantity, it is that the one place it matters most is the one place it is not reliable.

**What exists today:**

| Where | Copy | Assessment |
|---|---|---|
| `BetaPlanner.tsx`, disclaimer gate | "Beta drafts **educational** return-to-climbing plans. It is not medical advice, a diagnosis, or physical therapy, and it has never met your finger", plus four bullets including a genuinely specific one about under 18s, pregnancy, diabetes, inflammatory conditions, fluoroquinolones, and recent surgery | Strong. Do not touch. But it is behind a one time `localStorage` acknowledgment, so a returning visitor never sees it again, and spec 0004 AC-3 deliberately requires that |
| `beta/page.tsx` hero | "Beta is an educational AI planner for the three most common climbing injuries" | Good |
| `beta/page.tsx` FAQ | "Is this medical advice?" answered at length, including "it never overrides what a clinician tells you" | Strong |
| `beta/page.tsx` footer | "Beta is an educational demo, not medical advice, diagnosis, or physical therapy" | Good |
| `projects/beta/page.tsx` | "Educational demo, not medical advice" | Good, and it is the recruiter facing surface |
| **The plan itself** | only the coach's opening sentence, which `coach.md` asks the model to write: "say this is an educational starting point, not medical advice" | **The gap.** Model written, so its wording varies and it can be dropped. And under this child's own design, the guard fallback discards the coach's prose entirely, so a fallback plan would carry no framing at all |

**The gap, precisely.** The plan is the artifact the visitor keeps, scrolls back to, screenshots, and sends to a climbing partner. It is the only part of Beta that travels. And it is the only surface whose framing depends on a model choosing to write a sentence.

**The change, which adds no net disclaimer.** One line in, one line out:

1. **Add** a fixed framing element rendered by `PlanDisplay` above the plan's opening paragraphs, sourced from a single web side constant, never from the stream. Because the page renders it rather than the model producing it, it is present on the coach path and the guard fallback path alike, it cannot be reworded, and it appears the moment the plan area does. It sits inside the plan card region, not in page chrome, so it travels with a screenshot.
2. **Remove** the clause in `coach.md` step 1 that asks the model to say "this is an educational starting point, not medical advice". The deterministic element now carries that, and the coach's opening goes back to being purely the warm acknowledgment it is better at.

Net count of educational statements a visitor meets: unchanged. Reliability: much higher. This is the "fewer, better placed, at the moment of decision" instruction applied literally, rather than another warning stacked at the top.

**Wording.** The five existing surfaces use four different phrasings. Adopt one canonical sentence for the new element and align the hero, footer, and case study lines to its vocabulary. This is a consistency pass over copy that already exists, not new copy. The FAQ answer and the gate keep their longer, better tuned wording, because they have room to be specific and specificity is what makes them work.

**Explicitly not touched**, because an earlier clinical audit on this repo made the point that over lawyered warnings train people to ignore warnings, and because these strings are precise and clinically meaningful in a way generic framing is not:

- `RED_FLAG_MESSAGES` and `CONSTANT_REST_PAIN_MESSAGE`, and the red flag card's "This tool stops here on purpose" block.
- The stop conditions list in the completion card ("new numbness or tingling", "pain that starts waking you at night", and the rest). This is the highest value safety copy in the product because it tells the visitor what to watch for after they leave.
- The mid stream cutoff warning, "the plan above was cut off ... please don't follow a partial plan".
- The four disclaimer gate bullets, especially the population one.

Generic "educational only" language must never displace or dilute any of those. Where the canonical sentence would sit next to one of them, the specific copy wins and the generic line is omitted.

**Follow through.** Spec 0004's Follow-up lists a printable plan summary as a v1.1 candidate. If that is built, the framing element must be part of what prints, since a printed plan travels furthest of all.

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
- `apps/api/src/modules/beta/beta.constants.ts`: the crimp prohibition patterns, the dose variance bounds, and the injection blocklist, each with a source comment naming the `drafter.md` line it transcribes.
- `beta.service.ts`: builds the drafter schema per request, renders dose strings, buffers the coach, calls the guard, emits through `splitIntoChunks` imported from the conversation module (as the conversation service already does).
- No new module, no new provider, no new dependency.

## Value sourcing

| Action | Value produced | Source |
|---|---|---|
| Drafter schema | allowed `equipmentUsed` values | the existing `EQUIPMENT_ACCESS` constant, filtered by `input.equipmentAccess` at call time |
| Drafter schema | item count bounds | transcribed numbers from `drafter.md` (2 to 4 exercises, 2 to 3 criteria) |
| Drafter schema | dose variance bounds | the calibration run's observed range plus headroom; not a clinical limit |
| Drafter schema | whether `overallCaution` is required | `input.painBehavior` at call time |
| `parseDraftPlan` | crimp prohibition patterns | the constants file, transcribed from `drafter.md`; applied only when `input.injuryArea` is `finger_pulley` |
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
- Every plan carries its educational framing from an element the page renders, never from a sentence the model chose to write.
- Layer 1 encodes no clinical claim. Every constraint in it traces to an explicit requirement or prohibition in `drafter.md`, and anything requiring a decision is left out and recorded as out of scope. There is no allowlist of permitted exercises, and adding one would breach this invariant.
- The guard fallback is only safe because the drafter side checks run first. Any rule that protects the plan's content must sit on the drafter's output, never only on the coach's.

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

- Layer 1 provenance: `exercises[].name` has no `enum` in the generated schema, and every constraint carries a source comment naming the `drafter.md` line it transcribes, checked by inspection during review. Verifies **AC-G2**.
- Layer 1 schema construction: the schema for `equipmentAccess: ['none']` offers only `none` in `equipmentUsed`; the schema for `equipmentAccess: ['hangboard']` offers `hangboard` and `none` and nothing else; item counts are 2 to 4 and 2 to 3; the schema for `painBehavior: 'constant_even_at_rest'` lists `overallCaution` in `required`. Verifies **AC-G3**, **AC-G5b**.
- Dose rendering: a structured dose becomes the expected prose string, and the string handed to the coach matches it exactly. Verifies **AC-G5**.
- `parseDraftPlan`: rejects a `finger_pulley` plan naming a full crimp exercise in any stage; rejects one naming any crimping in stage 1; accepts half crimp in stage 3 (stage 2 is deliberately unconstrained); rejects a missing or empty `timeWindow`, and **accepts** overlapping and repeated windows, which line 16 explicitly allows. Verifies **AC-G4**.
- Guard, one test per rule for what it catches, and one per rule for what it must not: the pain traffic light phrasing passes R1; "no crimping of any kind" and "half crimp" pass R2; the stage heading number passes R3; "climbers usually find" passes R7; the visitor's own injury label passes R6. Verifies **AC-G8**.
- Guard failure path: a coach output tripping R1 results in the rendered fallback being emitted, `planCount` incremented, `guardBlockCount` incremented, and no error event. Verifies **AC-G7**, **AC-G11**.
- Buffering: the coach's `onToken` never emits, and every `plan_delta` the client receives arrives after the guard ran. Verifies **AC-G6**.
- Shadow mode: the guard evaluates and counts but the coach's prose is still shown. Mode `off`: the guard never runs and existing specs pass untouched. Verifies **AC-G12**.
- Injection check: a `goals` value containing "ignore your instructions" produces `REFUSAL_MESSAGE` with zero model calls and no slot reserved. Verifies **AC-G10**.
- Positioning: the framing element is present in the rendered output on the coach path and on the guard fallback path, asserted in both. Snapshot assertions over `RED_FLAG_MESSAGES`, `CONSTANT_REST_PAIN_MESSAGE`, the stop conditions list, the cutoff warning, and the four gate bullets confirm they are byte identical after the change. Verifies **AC-G14**.
- Live corpus run (manual, in shadow): at least 30 realistic profiles across the three injury areas, including blunt injury description, profanity, and constant pain wording. Zero guard firings before `enforce`. Verifies **AC-G9**.

## Build plan

Tracer Bullet ordering, prevention before detection. Nothing a visitor sees changes until step 8, except step 9, which is independent of every other step and may ship at any point, including first.

1. Layer 1 constants: the crimp prohibition patterns and the injection blocklist, each carrying a source comment naming the `drafter.md` line it transcribes. Apply the allowlist test literally, and record anything excluded as a decision rather than resolving it. Pure data plus unit tests. Satisfies **AC-G2**.
2. **Calibration run for the dose bounds**: generate plans against the current loose schema across all three injury areas and record the observed range of `sets`, `reps`, `holdSeconds`, and `frequencyPerWeek`. The bounds are derived from that range with generous headroom. If this run is skipped, ship positive integers with no upper bound rather than guessing a ceiling.
3. Layer 1 in place: build the drafter schema per request, add `equipmentUsed`, structure the dose, render dose prose in code, tighten the item counts, add `rationale`, add the conditional `overallCaution`, add the three `parseDraftPlan` checks. Satisfies **AC-G3**, **AC-G4**, **AC-G5**, **AC-G5b**.
4. `beta-output-guard.ts`: all eight rules plus `renderPlanFallback`, with the catch and non catch tests. No call site yet. Satisfies **AC-G8**.
5. Migration adding `guardBlockCount` and `injectionBlockCount`, and the injection check at the top of `generatePlan`. Satisfies **AC-G10**, **AC-G11**.
6. Wire the guard in at mode `shadow`: buffer the coach, evaluate, count, log, but still show the coach's prose. Satisfies **AC-G12**.
7. The corpus run and rule tuning. Zero false positives is the gate on proceeding, not a nice to have. R6 is the rule most likely to need loosening. Satisfies **AC-G9**.
8. Flip to `enforce`: the fallback renderer becomes live. Satisfies **AC-G6**, **AC-G7**.
9. Educational positioning: add the framing element to `PlanDisplay` from a single constant, remove the paired clause from `coach.md` step 1, and align the hero, footer, and case study wording. Add the snapshot tests over the safety copy that must not change. Satisfies **AC-G14**.
10. Gate and ship: `/predeploy-audit` with the clinical safety auditor, since this changes what an injured visitor reads and what the drafter is allowed to prescribe. Confirm no AWS call path was introduced and no dependency added. Deploy at `shadow`, promote to `enforce` after the soak as an env change. Satisfies **AC-G1**, **AC-G13**.

## Migration plan

**Strategy**: feature flagged for layer 2, calibrated for layer 1, no data migration beyond two additive counter columns defaulting to zero.

**Phases**:
1. Layer 1 ships enforced, after its calibration run. It changes what the drafter can produce, so it is the phase to watch for hard errors.
2. Layer 2 ships at `off`, then `shadow`, then `enforce`.

**Rollback**: layer 2 by env var. Layer 1 has no flag, so its rollback is a revert; the calibration run in step 2 exists precisely to make that unlikely.

**Risks**: a `parseDraftPlan` rejection lands on the hard error path rather than the fallback renderer, because the fallback needs a valid plan to render. That is the one place where this design can make things worse rather than better.

**Dropping the exercise allowlist substantially reduces that risk.** The main way layer 1 could have caused failures on legitimate plans was a vocabulary too narrow to express what the drafter wanted, which would have rejected good plans across every request. With `exercises[].name` left free, that failure mode largely goes away. What remains is three narrow checks, two of which fire only on a `finger_pulley` plan that names crimping where the prompt forbids it, and one that is structural. Each is a direct transcription of an explicit prohibition, so a firing means the drafter did something the prompt told it not to do, which is the correct time to fail.

Note also what kind of risk this is under the fidelity framing: the danger is **transcription error**, not clinical error. A mistake means a visitor gets an error instead of a plan. It cannot mean a visitor gets clinically worse advice, because layer 1 introduces no content the prompt did not already contain.

## Consequences

**Positive**:
- The clinical surface gains the output side check it did not have, closing a gap the work history chatbot had already closed.
- Layer 1 is prevention, not detection. An exercise declaring gear the visitor does not have becomes unrepresentable, and a full crimp prescription for a torn pulley is rejected before it can reach a visitor or the fallback renderer. It does this without anyone making a clinical claim, because every constraint transcribes a line the prompt already ships.
- Layer 1 constrains the model without narrowing the product. Exercise naming stays open, so the drafter can still express anything `drafter.md` allows it to, including things nobody thought to write down.
- Every plan now carries its educational framing deterministically, including the guard fallback path, and it does so without adding a single new warning to the surface.
- The coach can no longer alter a dose number, because it never receives one as editable text.
- The data boundary promise survives intact, Beta keeps Sonnet 5, and Beta stays up when AWS is down.
- A guard failure now delivers a complete plan instead of an error, which is strictly better than the current partial plan behavior.
- Zero cost, zero new dependencies, zero new infrastructure.

**Negative and tradeoffs**:
- **Buffering the coach delays the plan.** The visitor waits for the coach's whole generation rather than its first token, on a model call capped at ten times the token budget the existing buffered guard handles. This is the real price of the design.
- The rules are hand written and catch the phrasings they anticipate. `ownership-guard.ts` admits this about itself in a comment, and the same honesty applies here.
- Layer 1 couples a handful of constants to `drafter.md`. If the skill file's prohibitions change and the constants do not, the checks go stale, and nothing in the repo will point at the cause. This is the standing cost of the fidelity framing: the constraints are only as good as their transcription, and they must be maintained in lockstep with the prompt they mirror.
- Without an allowlist, layer 1 cannot prevent the drafter naming an exercise nobody anticipated. That is the deliberate trade: preventing it would have required deciding what is clinically valid, which is out of scope, so the residual risk is carried by the skill file and by layer 2 instead.
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
- [ ] Add a note to `drafter.md` and `coach.md` saying that the crimp prohibitions, the dose bounds, and the guard rules are derived from them, so a future edit to either prompts a look at the constants. `coach.md` also needs its own note that the educational framing moved to the page.
- [ ] If anyone later proposes adding an exercise allowlist, or any rule that would need a view on what is clinically valid, the answer is recorded here: it is out of scope for this layer. `drafter.md`'s injury lists are illustrative, not exhaustive (author, 2026-08-19), so enumerating them would narrow the product under a fidelity label. Only explicit prohibitions and explicit requirements belong.
- [ ] If the printable plan summary in spec 0004's Follow-up is ever built, the educational framing element must be part of what prints.
- [ ] After shipping, add a line to the api's "Beta module invariants" gotcha recording that the coach is buffered and guarded, and that a guard failure substitutes a rendered plan rather than an error.

## Inline rationale

The decisive observation is that Beta has no output side check while `conversation` does. Once that is said out loud, the shape of the answer follows from the repo rather than from a product catalogue: there is already a guard that evaluates a complete model output against deterministic rules, substitutes safe copy on failure, and re chunks so the result still streams. Beta needs the same thing, and the reasons it is harder are specific and addressable.

Layer 1 is where most of the value is, and it exists because of a detail in the current code: the drafter's schema is built inside `runDrafter`, where the request is in scope, so it can be built per request. That turns three prose rules in `drafter.md` into structural facts. No full crimp entry exists for a pulley injury. No hangboard entry exists for someone with no hangboard. The mandatory caution is a required field for the pain behavior that mandates it. None of that is detection, so none of it can be evaded by phrasing.

The second useful detail is that both skill files specify output formats precisely, which lets layer 2's rules be scoped to the region where they apply. That is what makes a full crimp rule safe: run over the whole document it would fire on the skill file's own safety language ("no crimping of any kind"), but scoped to prescription lines it fires only on a prescription.

The reframing that took longest to get right is what layer 1 is. Written as "the correct exercises and doses for this injury" it is a clinical artifact, and hardening a clinical artifact into a schema is a bigger act than it looks: it converts one person's judgement into a ceiling the product can never exceed, and it needs standing to make. Written as "only what `drafter.md` explicitly requires and forbids" it is a fidelity constraint, and it needs only careful reading.

The sharpest form of that test is the one to keep: **an allowlist needs to know everything that is valid, a prohibition list needs only to read the file.** The first is judgement, the second is transcription. Applying it removed the largest single piece of the original design, the enumerated exercise vocabulary, once the author confirmed those lists were illustrative rather than exhaustive. Enumerating an illustrative list closes it, and closing it would have narrowed what the product can prescribe while calling that fidelity.

What is left is smaller but entirely defensible, and it happens to be safer in a second way too: the dropped allowlist was also the main way this layer could have failed legitimate plans. The same test caught two smaller things earlier, a dose ceiling that was a judgement dressed as a transcription, and a stage rule written as "stages 1 or 2" when the prompt only supports "stage 1".

The positioning change followed the same instinct. The temptation was to add warnings. The audit showed the framing already appears in five places and is good in most of them, and that the single unreliable one is the plan itself, because the only thing saying it there is a sentence the model is asked to write. Moving that sentence from the model to the page, and deleting it from `coach.md` in the same change, makes it reliable without making the surface noisier.

The uncomfortable part is buffering. Beta's plans are long and the wait is real, and the temptation is to stream segment by segment and guard each one. The reason not to is that Beta's UI already carries a warning about partial plans, written because partial plans are dangerous here. A design that makes the partial plan a routine state is moving the wrong way on a clinical surface, and the honest fix for the wait is a better first paint, not a weaker guard.
