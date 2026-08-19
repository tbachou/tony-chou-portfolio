# 0005 child: Bedrock Guardrails on the Beta planner

## Summary

Beta gains a second safety net: Amazon Bedrock Guardrails, called as a standalone `ApplyGuardrail` check on the two places untrusted text enters and clinical prose leaves. Beta's models do not move. It keeps calling the direct Anthropic API on Sonnet 5, because Sonnet 5 is not available on Bedrock for this account and moving the clinical surface there would downgrade it by half a generation. The guardrail fails open, so an AWS outage degrades Beta to exactly today's audited posture rather than taking it down. It ships behind a three value flag (`off`, `shadow`, `enforce`) and runs in shadow first, because a false positive here means refusing help to an injured climber.

This child needs an amendment to the umbrella's cross child contract clause 1, which currently forbids any Beta visitor content from leaving Render and Anthropic. Every guardrail option violates that clause, because a guardrail must read the content to judge it. The proposed replacement wording is in "Decisions awaiting ratification" below. That amendment is the real decision here, and it is the engineer's to make.

## Requirements

**User stories**:
- As the owner, I want a second, independent safety net on Beta's clinical surface so that I can advertise the tool without the whole safety story resting on one screener call and my own prompt writing.
- As an injured climber, I want that net to be invisible when I am asking an ordinary question, so that describing a torn pulley in blunt words never gets me refused.
- As the owner, I want the net removable by an environment variable so that a bad policy or an AWS outage is a flag flip, not an incident.

**Acceptance criteria** (the contract `/develop` builds to and `/check verify` checks):

- **AC-G1**: with `BETA_GUARDRAIL_MODE` unset or `off`, Beta's behavior is byte for byte today's. No AWS call is made on any path, and every existing beta spec passes unchanged.
- **AC-G2**: in `shadow`, the visitor sees exactly what they see today: the same copy, the same token by token stream, the same timing within noise. Interventions are recorded as counter increments and structured log lines only, and nothing is withheld or rewritten.
- **AC-G3**: in `enforce`, an input intervention on the free text goals field blocks before the screener runs. No screener, drafter, or coach call is made, the visitor sees the existing refusal copy, and the reserved global slot is refunded with reason `guardrail`.
- **AC-G4**: in `enforce`, an output intervention on a coach segment withholds that segment and every segment after it. The visitor sees the new guardrail card, plus the existing "cut off, do not follow a partial plan" warning when earlier segments were already on screen, and the slot is refunded.
- **AC-G5**: the guardrail never overrides a clinical block. When the screener returns `red_flag` (including its fail closed coercion of an unparseable verdict) and the guardrail also intervened, the visitor sees the red flag card, not a guardrail response.
- **AC-G6**: fail open holds absolutely. Any `ApplyGuardrail` error, timeout, throttle, credential failure, or missing configuration lets the request proceed exactly as mode `off` would, logs one structured line, and increments `guardrailErrorCount`. Beta never becomes unavailable because AWS is.
- **AC-G7**: legitimate rehab content is never intervened on. A corpus of at least 30 realistic profiles across the three injury areas, deliberately including blunt injury description, profanity, constant pain wording, and ordinary climbing goals, produces zero input interventions and zero output interventions across a full shadow run before `enforce` is ever enabled.
- **AC-G8**: a masking only result is not a block. When the sensitive information policy anonymizes text and no filter, denied topic, or word policy returns a blocked action, the request proceeds with the masked text and the visitor is not refused.
- **AC-G9**: the data boundary holds as amended. Exactly two classes of text leave Render for AWS per plan (the goals free text on input, and each coach segment with its own stage JSON as grounding source on output). No structured enum field crosses. Bedrock model invocation logging and CloudTrail data events for Bedrock runtime are both off, verified by a documented console check, and no Beta text appears in any CloudWatch log line.
- **AC-G10**: the guardrail id and a numbered version are pinned in Render env. `DRAFT` is rejected at boot. A Terraform policy edit cannot change production behavior without an explicit env change.
- **AC-G11**: counters follow the module's established pattern. `guardrailFlagCount` (shadow observations), `guardrailBlockCount` (enforced interventions, riding the refund's atomic update), and `guardrailErrorCount` (fail open events, standalone and swallowed) each increment on their own event, and a lost tally write never disturbs the response.
- **AC-G12**: each `ApplyGuardrail` call is capped at 3 seconds with no retry, and `enforce` adds no more than about half a second to the time the first plan text becomes visible.

## Options considered

Five architectures were weighed, not two. Options 3 and 4 were added late and are the reason this section exists separately from the decision below: both look at first glance like stronger guarantees than the chosen option, and both turn out not to reach Beta at all.

### Option 1: standalone `ApplyGuardrail`, Beta stays on the direct Anthropic API (chosen)

The api calls the Bedrock `ApplyGuardrail` runtime API as a separate check either side of a model call that still goes to Anthropic directly.

**Pros**: the clinically audited model path is untouched, so Beta keeps Sonnet 5; the guardrail is removable by one env var; shadow mode is trivial because the check is already decoupled from generation; the check can be aimed precisely (goals only on input, one segment plus its own stage JSON on output) instead of at whatever the model call happens to contain.
**Cons**: two extra round trips on a surface that already makes three model calls; the guardrail is something the application chooses to call, so a future refactor that drops the call silently removes the layer; it violates cross child contract clause 1 as written.

### Option 2: move Beta onto Bedrock with an inline guardrail (runner up)

Beta joins the `AI_PROVIDER` token, its calls become Bedrock `InvokeModel` / `Converse` calls, and a `guardrailConfig` rides along on each one.

**Pros**: one call instead of three, so no added round trips; the guardrail cannot be forgotten on a call that is already carrying it; input and output are evaluated by the same integrated path; it is the shape AWS documentation treats as the default.
**Cons**: **Sonnet 5 is not available on Bedrock for this account** (verified 2026-08-19: 403 "not available for this account" while the console catalog still lists it), so the drafter, the clinical reasoning core, drops to Sonnet 4.6. Buying a safety layer by downgrading the model doing the clinical reasoning is the wrong trade on this surface. It also gives up the precise aiming of option 1 (the guardrail sees the whole prompt, including Beta's own skill files, which are dense with injury and loading language), and it does not even avoid the new IAM grant: `bedrock:ApplyGuardrail` on the guardrail ARN is required for the inline case too.

### Option 3: account level enforced guardrail configuration

`PutEnforcedGuardrailConfiguration` designates one guardrail version that applies to Bedrock model invocations from the account whether or not the calling code asks for it. Considered seriously and **rejected**. Verified against the AWS API reference and the Guardrails enforcements user guide on 2026-08-19.

The verified request shape, because the scoping it does and does not offer is the whole argument:

| Field | Required | Notes |
|---|---|---|
| `configId` | no | pattern `[a-z0-9]+` |
| `guardrailInferenceConfig.guardrailIdentifier` | yes | id or guardrail ARN |
| `guardrailInferenceConfig.guardrailVersion` | yes | pattern `[1-9][0-9]{0,7}`, so a published numeric version. **`DRAFT` is not accepted** |
| `guardrailInferenceConfig.modelEnforcement` | no | `includedModels` and `excludedModels`. Absent means all models |
| `guardrailInferenceConfig.selectiveContentGuarding` | no | `system` and `messages`, each `SELECTIVE` or `COMPREHENSIVE`, both defaulting to `COMPREHENSIVE` |

Companion operations are `ListEnforcedGuardrailsConfiguration` and `DeleteEnforcedGuardrailConfiguration`. It must be set in every region where enforcement is wanted. An organization level equivalent exists through an AWS Organizations `BEDROCK_POLICY`.

So the scoping available is **per model**, and there is **no per principal, per role, or per application scoping**. That is the shape that decides this.

**Pros**: genuinely stronger than a guardrail the application chooses to call. It cannot be bypassed by a code path that forgets it, and it survives a refactor that drops the call. A guardrail bound to an enforcement configuration also cannot be deleted by default.

**Cons**:
- **It cannot reach Beta.** Enforcement applies to `InvokeModel`, `InvokeModelWithResponseStream`, `Converse`, and `ConverseStream`, that is, invocations that go through Bedrock. Under the chosen architecture Beta's model calls go to Anthropic directly, so the clinical surface this spec exists to protect is precisely the surface it misses.
- **Its coverage of the other two surfaces is a liability, not a benefit.** It would apply to the feedback classifier Lambda, which reads arbitrary visitor text, where a guardrail tuned for clinical rehab content would produce false positives. The classifier's documented failure mode is a silent fall back to "unclassified" (child spec AC-C2), so that degradation would be quiet rather than loud. It would also apply to the interview simulator, which only discusses work history, adding latency, cost, and a refusal path for no safety benefit.
- **`modelEnforcement` is a weaker escape hatch than it looks.** It scopes by model, and this account's three surfaces would need separating by principal, not by model. It might exclude the classifier (Haiku) from a Sonnet tuned policy, but it cannot distinguish two applications sharing a model. Worse, the documented pattern for both model lists allows exactly one dot (`[a-z0-9-]{1,63}[.][a-z0-9-]{1,63}` plus optional suffixes), while this account calls `us.` Geo inference profile ids, which carry two. Whether an inference profile id can be named in these lists at all needs verifying before anyone relies on it.
- **`COMPREHENSIVE` is the default**, so an enforced guardrail evaluates whole prompts including system prompts. Beta's drafter skill file is dense with injury, loading, and pain language, so that is a large false positive surface. Setting `system: SELECTIVE` avoids it, but only by trusting the caller to tag content correctly, which puts the bypass back into application code and gives away the property that made this option attractive.
- **Enforcement layers rather than replaces.** Organization, account, and request guardrails all apply, the effective control is their union with the most restrictive winning, and billing counts text units per guardrail ARN per request. Stacking it on top of the chosen design multiplies cost rather than replacing it.
- **Operationally it fights the rest of this program.** The Terraform AWS provider appears not to expose the resource yet (provider issue 47400 open as of 2026-08), so it would be a console or CLI step outside `infra/`, against umbrella AC-1. And an account wide setting is the opposite of the removable design here: rollback becomes an AWS change affecting other surfaces rather than a Render env var flip.

**Verdict: net negative under the recommended architecture.** It covers everything except the target, and its coverage of the rest is a cost. Not carried forward, and not raised as a complement either.

### Option 4: IAM enforcement through the `bedrock:GuardrailIdentifier` condition key

An IAM policy that allows `InvokeModel` only when the request carries a named guardrail and version, with an explicit `Deny` for anything else, plus an `ApplyGuardrail` allow on the guardrail ARN.

**Pros**: makes option 2 unforgettable at the permission layer rather than the code layer. Crucially it is scoped **per principal**, since it rides the policy attached to the `portfolio-api` user, so unlike option 3 it would cover Beta without also imposing a clinical policy on the interview simulator and the classifier Lambda. If unbypassable enforcement is wanted, this is the right mechanism, not option 3. Version pinning is expressible directly in the condition (`guardrail/<id>:1`), and the AWS reference policies show the exact `Allow` plus `Deny` pair.
**Cons**: it is a hardening of option 2, not an alternative to it, so it inherits option 2's Sonnet 5 problem completely. It also has documented holes: a caller can still narrow what gets evaluated using guardrail input tags on the request (the response is always evaluated), and roles carrying this condition break `InvokeAgent` and `RetrieveAndGenerate`, which make internal `InvokeModel` calls without a guardrail. Same conclusion as option 3: it never reaches a direct Anthropic call.

### Option 5: do nothing, leave clause 1 intact

Decline the amendment and keep Beta on a single safety layer.

**Pros**: costs nothing, adds no dependency, and preserves the cleanest sentence in the umbrella ("Beta planner visitor content never leaves Render and the direct Anthropic API"), which is a genuine part of the product's story.
**Cons**: the whole safety story then rests on one screener call and prompt files written by the same person who wrote the tool, with no independent check on the only free prose a visitor reads. The umbrella already names guardrails a hard prerequisite before advertising Beta broadly.

## Decisions awaiting ratification

Five calls are made here. Each is the recommended position with its runner up. **None is settled until the engineer ratifies it**, and the boundary amendment in particular is a change to the umbrella's law, not a detail.

### D1. Architecture: standalone `ApplyGuardrail`, Beta stays on the direct Anthropic path

**Chosen**: option 1, call the Bedrock `ApplyGuardrail` API directly from the api, as a separate check either side of a model call that still goes to the direct Anthropic API. **Runner up**: option 2, move Beta onto Bedrock and attach the guardrail inline to `InvokeModel`. Options 3 and 4 (account level enforcement, IAM condition key enforcement) were evaluated and rejected as unreachable rather than inferior; see Options considered.

Bedrock does not offer Sonnet 5 to this account (verified 2026-08-19: a 403 reading "not available for this account", while the console catalog still lists it). Bedrock tops out here at Sonnet 4.6, which is what the interview simulator now runs on. Beta's drafter is the clinical reasoning core and runs Sonnet 5 today. The inline option therefore buys guardrail integration by downgrading the clinically audited surface by half a generation, which is the wrong trade on the one surface where model quality is a safety property. The standalone call also leaves the audited model path byte for byte untouched and removable by one env var, which is what makes the shadow rollout below possible at all.

**The strongest counter argument, argued rather than waved away.** The honest weakness of option 1 is that a guardrail the application chooses to call can be dropped by a future refactor, and options 3 and 4 both fix exactly that. That is a real safety property on a clinical surface, and it only becomes available if Beta moves onto Bedrock. It is the best case anyone has made for option 2, and it deserves a straight answer rather than a footnote.

**The recommendation does not change, for four reasons.**

1. The trade is still first layer quality for second layer enforcement, which is backwards. Layer one (the code blocks, the fail closed screener, a Sonnet 5 drafter reasoning conservatively) is the audited, load bearing layer. Making layer two unforgettable by weakening layer one is a worse position than a strong layer one plus a forgettable layer two.
2. If unbypassability is what is wanted, **option 4 is the right mechanism, not option 3.** The IAM condition key is scoped per principal, so it covers the api's calls without imposing a clinical guardrail policy on the interview simulator or the classifier. Option 3's all or nothing account scope makes it a poor fit regardless of which architecture wins, so it should not be counted as a reason to prefer option 2.
3. The threat being defended against is one engineer, working alone, deleting a call in a module whose `AGENTS.md` carries an explicit invariants list and whose mocked tests assert the call is made. IAM is a stronger guarantee than a test, but not by enough to pay a model generation for it at this scale.
4. Unbypassable also means unremovable in a hurry. This spec's whole shape (default off, shadow, enforce, rollback by env var) exists because a false positive here refuses help to an injured person. Enforcement at the permission layer removes the flag flip.

**The condition that would flip this**, stated so it is falsifiable: if Sonnet 5 becomes available on Bedrock for this account, option 2 loses its only real cost, and option 2 plus option 4 becomes the better architecture. That is worth re checking rather than assuming, and it is enrolled in Follow-up.

Until then the mitigation for the forgettable call is local: the invariants below, the tests that assert the call is made, and a line in the api's `AGENTS.md` gotchas.

### D2. Coverage: visitor input plus coach output only

**Chosen**: guard the visitor's free text goals on the way in, and each coach segment on the way out. **Runner up**: guard all four hops (input, screener output, drafter output, coach output).

Those two are where untrusted text enters and where free prose leaves. The screener and drafter both run through `forceToolCall` with a constrained schema: the screener returns one of three enum values, the drafter returns typed stage objects that `parseDraftPlan` then validates in code. A content guardrail over an enum adds cost and latency for nearly nothing. Reading the code sharpened this further: the only untrusted free text in the whole request is `goals`, capped at 200 characters by the DTO, since every other field is either an enum validated by `IsIn` or `preInjuryGrade`, which a regex restricts to `[A-Za-z0-9 .+/-]{1,12}`. So the input guard's payload is tiny and its marginal value rests mainly on the prompt attack filter, a genuinely different detector from the screener's judgement. The output guard is where the real value sits.

### D3. Failure mode: fail open, with an api side counter and an AWS side alarm

**Chosen**: any guardrail failure lets the request proceed as it would today. **Runner up**: fail closed.

This is a second layer. Layer one is shipped and clinically audited: two code enforced hard blocks that run before any model call, a screener that fails closed on an unparseable verdict, deterministic human written red flag copy, and conservative rules in the drafter skill file. Failing open degrades to that audited posture. Failing closed would let an AWS availability event take down a tool whose entire safety story does not depend on AWS, in exchange for a net that is additive rather than load bearing. One correction to the framing: a CloudWatch alarm cannot see a fail open event, because the failure is an exception on Render, not a metric AWS emits. So the alarm covers intervention volume (a spike means abuse or a broken policy) and the durable fail open signal is the `guardrailErrorCount` column in Postgres, since Render's free tier logs are ephemeral.

### D4. Rollout: shadow first, then enforce behind a flag

**Chosen**: `BETA_GUARDRAIL_MODE` with values `off`, `shadow`, `enforce`, deployed at `shadow`, promoted only after a clean corpus run. **Runner up**: enforce from the start.

You cannot tune a policy you have never seen fire, and the cost of a false positive here is refusing help to an injured person. Shadow mode makes the calls, records the verdicts, and changes nothing the visitor sees or receives. Note one consequence that must not be glossed: masking (D5's PII policy) is a behavior change, so it applies only in `enforce`. Shadow records how often masking would have applied, and the substitution path is covered by mocked unit tests rather than by production traffic.

### D5. The data boundary amendment (the real decision)

Umbrella cross child contract clause 1 currently reads, in part: "Beta planner visitor content (injury details, goals, plans) never leaves Render and the direct Anthropic API." A guardrail must read the content to judge it, so **every option in this spec violates that clause as written**. It cannot be satisfied by implementation care; it has to be amended or this child does not get built.

**Proposed replacement wording for clause 1** (the rest of the clause, covering feedback text, is unchanged):

> 1. **Data boundary (refined 2026-08-19; amended by the Guardrails child, pending ratification).** Beta planner visitor content (injury details, goals, plans) is generated only by Render and the direct Anthropic API, and is never persisted anywhere outside Postgres on Render. Two narrow exceptions carry Beta text to AWS for safety screening only, never for generation and never to rest: (a) the visitor's free text goals field, and (b) each segment of the coach's generated prose (which may quote that goals text) together with the matching drafter stage object as its grounding source. Both go to the Bedrock `ApplyGuardrail` API in us-east-2 and nowhere else. Nothing else from a Beta request crosses: the structured enum fields, the hashed IP, and the counters never leave Render. Bedrock model invocation logging stays off, CloudTrail data events for Bedrock runtime stay off, and no Beta text may appear in any CloudWatch log line. Feedback text remains a separate, consented class: the form labels it "do not include personal or medical details", and it may transit AWS (SNS, Lambda, Bedrock, SES) for classification and delivery, but is never persisted on AWS (no S3, no DynamoDB, no CloudWatch log line containing the text). Postgres on Render remains the only store.

**Runner up**: leave clause 1 as written and do not build this child, accepting that Beta's safety story stays a single layer. That is a coherent position, and it is cheaper. The case for amending is that the clause was written to prevent visitor content coming to rest on AWS, and a transient screening read that is never stored honors that intent while the literal wording forbids it.

## Decision

### Where the calls sit in the pipeline

Beta's pipeline has five stages today. The guardrail adds two positions, both after the existing code enforced blocks so that nothing changes about the cheapest and most important safety path.

| Order | Step | Change |
|---|---|---|
| 1 | Checked red flag box, hard block in code | unchanged, still runs before anything else and costs nothing |
| 2 | Constant rest pain escalation, hard block in code | unchanged |
| 3 | `reserveGlobalSlot()` | unchanged |
| **3a** | **Input `ApplyGuardrail` on `input.goals`** | **new** |
| 4 | Screener, `forceToolCall`, fails closed | unchanged |
| 5 | Drafter, `forceToolCall` | unchanged |
| 6 | Coach, `streamMessage` | **segment accumulator added around it** |
| **6a** | **Output `ApplyGuardrail` per coach segment** | **new** |

The input call is sequential, not run in parallel with the screener. Parallel would hide its latency, but it makes PII masking impossible (a mask has to be applied before the model sees the text), it wastes a screener call on every blocked input, and it muddies the precedence rule below. The measured cost of sequencing is one round trip, roughly 100 to 300 milliseconds, on a path whose time to first token is already several seconds of screener plus drafter. If the p95 for that call is measured above about 500 milliseconds in shadow, revisit and go parallel with blocking only.

The guardrail runs after `reserveGlobalSlot()` on purpose, so guardrail spend sits inside the same envelope the screener already sits in. It is bounded by the same in memory throttle (3 requests per hour per IP) and the same daily caps.

### Precedence when the layers disagree

Strict order, evaluated in this sequence:

1. **Screener `red_flag` wins over everything.** If the screener flags a warning sign and the guardrail also intervened, the visitor gets the red flag card and its human written copy. Telling someone who described numbness "we cannot process that" instead of "please see a doctor trained in nerve evaluation" is a strictly worse outcome. The guardrail intervention is still counted and logged.
2. **Guardrail input intervention beats `off_topic`.** Both produce the same visible refusal, so the only difference is which counter moves. Attribute it to the guardrail, since it fired first.
3. **`off_topic` unchanged** when the guardrail was clean.
4. On output there is no competing layer, so a guardrail intervention is terminal.

### A masking result is not a block (AC-G8)

`ApplyGuardrail` returns `action: GUARDRAIL_INTERVENED` when the sensitive information policy merely anonymizes text, exactly as it does when a content filter blocks. A naive `action === 'GUARDRAIL_INTERVENED'` check would therefore refuse every visitor who types a name. The service must inspect the assessments and treat the result as a **block** only when a content filter, denied topic, or word policy reports a blocked action, and as a **mask** when the only intervention came from the sensitive information policy. On a mask, take the guardrail's returned masked text and pass that to the screener and drafter in place of the raw goals.

### The guardrail policy

One guardrail resource, one policy set, applied differently by direction because the standalone API lets the caller choose what to send. The subtlety here is that Beta's whole subject matter is injury, pain, and the body. A naive medical denied topic would break the product on its first request.

**Content filters** (strength per direction):

| Filter | Input | Output | Reasoning |
|---|---|---|---|
| `PROMPT_ATTACK` | HIGH | not applicable (input only) | the main reason the input guard exists; a different detector from the screener's `off_topic` judgement |
| `VIOLENCE` | NONE | LOW | "it popped", "I tore a pulley", "it ripped" is the product's own vocabulary. This is the single most likely false positive on this surface, so it is off on input entirely |
| `INSULTS` | NONE | MEDIUM | a frustrated climber swearing at their finger or at the tool must still get help |
| `MISCONDUCT` | LOW | MEDIUM | output side catches the coach drifting into unsafe instruction |
| `HATE` | LOW | MEDIUM | no legitimate input use |
| `SEXUAL` | LOW | MEDIUM | no legitimate input use |

**Denied topics: output only.** On input, the screener skill file already treats "requests for diagnosis, medication advice, or treatment of conditions outside the three supported injury areas" as `off_topic`. Adding the same topics on input duplicates that and would refuse a visitor who merely mentions they took ibuprofen. The coach, however, must never *answer* those things, and that is what these catch. Each definition names its exclusions explicitly, because the exclusions are what keep the product working:

- `medication_and_dosage`: naming, recommending, or dosing any drug, supplement, injection, or painkiller. Excludes: describing pain levels, exercise dosage in sets, reps, load, or frequency, and advising the visitor to see a professional.
- `diagnosis_as_fact`: asserting a specific named diagnosis, tear grade, or structural classification as a fact about this person, or interpreting scan or imaging results. Excludes: referring to the injury area the visitor themselves selected, and general education about how that kind of injury usually behaves.
- `invasive_or_procedural_treatment`: recommending surgery, injections, manipulation, or prescriptive taping and splinting as treatment. Excludes: telling the visitor a professional may consider such options.

Deliberately **not** included: a self harm or crisis denied topic. A visitor in genuine distress writing "the pain is unbearable" is a real edge case on a health adjacent surface, but a guardrail *block* is the worst available response to it, and the phrase is also ordinary climbing injury language. This is left open and raised in Follow-up rather than guessed at.

**Word filters**: managed profanity list on output only, off on input, for the same reason as `INSULTS`. No custom word list in v1.

**Sensitive information filters**: input only, `ANONYMIZE` (mask), never `BLOCK`, for `NAME`, `EMAIL`, `PHONE`, and `ADDRESS`. Masking is invisible to the visitor and cannot refuse anyone, and it means an accidentally typed name never reaches Anthropic, which is a real if small improvement on the boundary. `AGE` is deliberately excluded because age is clinically relevant to a rehab plan. Watch `NAME` during shadow: route and gym names ("Midnight Lightning") may be detected as names, and if the shadow mask rate on `NAME` is material, drop `NAME` from the list rather than shipping mangled goals. No sensitive information policy on output; the coach cannot emit PII it was never given, and masking prose would mangle it.

**Contextual grounding check**: output, and only on stage segments. This is the strongest fit in the whole policy. The coach's job, per its skill file, is literally "rewrite this JSON, keep every number, add nothing", so the drafter's output is a perfect grounding source and the check catches the exact failure that matters clinically: the coach inventing clinical content that was never drafted.

- **Source**: the single drafter stage object matching that segment, serialized, not the whole plan. Per stage sourcing is both cheaper and semantically correct.
- **Query**: a fixed string synthesized from the structured fields only, for example "A staged return to climbing plan for a shoulder_impingement, 6 weeks after onset, for a sport climber at 5.11a." No free text goes into the query, so the output guard call carries no visitor free text except whatever the coach itself chose to echo.
- **Thresholds**: grounding 0.5, relevance 0.5 as a starting point, tuned during shadow. These numbers are a start, not a finding.
- **Critical exclusion**: the coach's opening and closing paragraphs are legitimately not grounded in the JSON (the skill file mandates a fixed warm opening and a closing that adds a professional referral reminder). Applying grounding to them would fire on every single plan. Those two segments are sent as plain text with no grounding source, so the grounding policy simply does not evaluate them. This is exactly why segmentation is done at heading boundaries: the coach skill file requires the opening and closing to carry no heading, and every stage to carry a `## Stage n:` heading, so the split is already deterministic in the format the coach is contracted to produce.

### How streaming is handled

The coach streams, and it is the only free prose the visitor reads, so this is the load bearing UX decision.

**Segment accumulation, with mode controlling only whether release waits on the verdict.**

- The coach's token callback appends to a buffer. A segment closes when a new `## ` heading arrives at a line start, and the final segment closes when the stream ends.
- In `shadow`: tokens are emitted to the visitor immediately as they arrive, exactly as today. When a segment closes, the `ApplyGuardrail` call is fired without being awaited, purely to record a verdict. Nothing is ever withheld, so shadow is genuinely invisible (AC-G2).
- In `enforce`: tokens are held in the segment buffer instead of emitted. When a segment closes, its verdict is awaited, then the whole segment is emitted as one `plan_delta` if clean, or the stream is terminated if not.

The difference between modes is one `await` at one call site, not two implementations. Rejected alternatives and why: guarding per token or per chunk costs one billed call per chunk with a one text unit minimum and adds latency to every token; buffering the entire output and guarding it whole before display kills the progressive stream that AC-4 of spec 0004 requires; guarding after the fact cannot block anything, because the text is already on screen.

The honest cost: **in `enforce` the plan appears segment by segment rather than token by token.** That still satisfies AC-4's "streams in progressively rather than appearing all at once", but it is a visible change and it is the main thing to look at during the shadow soak.

### What the visitor sees

Reuse where the meaning already matches; add new copy only where it does not.

| Event | What the visitor gets | New copy needed |
|---|---|---|
| Input intervention (`enforce`) | The **existing refusal path**: the `error` event carrying `REFUSAL_MESSAGE`, rendering today's "That didn't work" card. The meaning is identical to an `off_topic` screener verdict, the copy already fits, and no web client change is needed | no |
| Output intervention (`enforce`) | A **new** `guardrail_block` SSE event and a new card. The existing failure copy says "Something went wrong on our side", which would be a lie, and its "Try again" button would invite a retry loop | yes, one new constant |
| Output intervention with text already shown | The new card **plus** the existing "cut off, do not follow a partial plan" warning, unchanged | no |
| Screener red flag, guardrail also fired | The existing red flag card, unchanged (AC-G5) | no |
| Guardrail unavailable | Nothing. The visitor's experience is identical to mode `off` | no |

New constant in `beta.constants.ts`, human written like every other safety string in that file (the deterministic copy convention exists precisely so safety critical wording is never model written):

> `GUARDRAIL_OUTPUT_BLOCK_MESSAGE`: "Beta stopped this plan partway through. The wording it was writing did not pass Beta's own safety check, so the rest was not shown. Nothing you entered was stored, and this attempt did not count against your daily limit. Drafting a fresh plan usually works. If it stops again, this tool is not the right fit for your situation, and a physical therapist or sports medicine doctor is."

One deploy skew note: the web client's SSE switch has no `default` branch, so a stale cached client that receives `guardrail_block` ignores it, never sets `terminal`, and falls through to the existing "connection dropped before the plan finished" error, which also shows the partial plan warning. That degradation is safe (it never presents a truncated plan as complete), and the window is only the gap between the Vercel and Render deploys of the same push.

### Observability and counters

Follows the module's established pattern exactly: one column per outcome, incremented on its own event, additively migrated onto `BetaDailyUsageCounter`. Still zero visitor content, so AC-6 of spec 0004 is untouched.

| Column | Counts | Incremented from |
|---|---|---|
| `guardrailFlagCount` | Shadow mode observations: an intervention that *would* have blocked, plus a mask that *would* have applied | standalone `safeIncrement`, swallowed and logged, so a lost tally cannot disturb the response |
| `guardrailBlockCount` | Enforced interventions, input and output alike | rides `refundGlobalSlot('guardrail')`'s atomic update alongside the `planCount` decrement, like the existing `error` / `red_flag` / `refusal` reasons |
| `guardrailErrorCount` | Fail open events: any error, timeout, or throttle on an `ApplyGuardrail` call | standalone `safeIncrement`, swallowed and logged |

`guardrailErrorCount` earns its place despite the column count: in a fail open design it is the only durable signal that the second layer has silently stopped working, and Render's free tier logs do not persist.

Structured log line per guardrail call, matching the per agent JSON logging convention and carrying no visitor text: `{ guardrail: 'input' | 'output', mode, segment, action, topPolicy, durationMs, outcome }`. `topPolicy` is a policy name such as `denied_topic:medication_and_dosage`, never the matched text.

One new refund reason, `guardrail`, joining `error`, `red_flag`, and `refusal` in `RefundReason` and `REFUND_REASON_COLUMN`.

### Code shape

A new `BetaGuardrailService` in the beta module, injecting an AWS SDK v3 `BedrockRuntimeClient` and issuing `ApplyGuardrailCommand` from `@aws-sdk/client-bedrock-runtime` (the same package the classifier Lambda already uses). It exposes two methods, `checkInput(goals)` and `checkSegment(text, stageJson | null, query)`, each returning a neutral verdict shape (`{ action: 'none' | 'mask' | 'block', maskedText?, policy? }`) and each swallowing its own failures into `action: 'none'` plus the error tally.

This does **not** go through the `AiProvider` seam. A guardrail is not a model call, and Beta deliberately does not hold the `AI_PROVIDER` token. Spec 0005 AC-P3 continues to hold: `beta.service.ts` gains no provider conditionals, still constructor injects the concrete `AnthropicService`, and its `BETA_PROVIDER = 'anthropic'` log field stays correct.

### Terraform and IAM

New file `infra/guardrails.tf`:

- `aws_bedrock_guardrail` named `portfolio-beta-guardrail`, carrying the policy above, plus the two required blocked message strings (never shown to a visitor, since the api renders its own copy, but the API requires them).
- `aws_bedrock_guardrail_version` for each promoted policy revision. Versions are immutable, which is what makes the env pin below meaningful.
- `aws_iam_policy` `portfolio-api-guardrail-apply`: a single `bedrock:ApplyGuardrail` statement scoped to the guardrail ARN. Kept as its own policy rather than folded into `portfolio-api-bedrock-invoke`, so it can be detached alone, mirroring the "either credential can be revoked alone" instinct already in `infra/bedrock.tf`.
- `aws_iam_user_policy_attachment` onto the existing console created `portfolio-api` user, which `infra/bedrock.tf` already reads with `data "aws_iam_user" "api"`.

**The new grant is genuinely new, and it is not avoidable by choosing a different architecture.** `bedrock:ApplyGuardrail` is a distinct data plane action from `bedrock:InvokeModel`, and its resource is the **guardrail** ARN, not a model ARN. The existing `portfolio-api-bedrock-invoke` policy grants only `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on `foundation-model` and `inference-profile` resources, so it covers neither the action nor the resource. Worth stating plainly because it is a natural wrong assumption: the inline architecture (option 2) needs this same grant too. The AWS reference policies for enforcing a guardrail on inference carry an explicit `ApplyGuardrail` allow statement alongside the `InvokeModel` statements, so choosing inline is not a way to skip it.

Two ARN details that are easy to get wrong:

- Resource is `arn:aws:bedrock:us-east-2:<account>:guardrail/<id>` with **no region wildcard**, deliberately unlike the foundation model ARNs in `bedrock.tf` and `feedback.tf`. Those need a wildcard because a `us.` Geo inference profile requires the permission in every destination region. `ApplyGuardrail` is a single region call against a single region resource, so a wildcard there would be over granting. Worth a comment in the file, since the neighbouring files teach the opposite habit.
- The `ApplyGuardrail` statement's resource is the **unversioned** guardrail ARN (`guardrail/<id>`). The version is a request parameter, not part of the authorized resource. Version pinning is therefore an application concern here, enforced by the boot guard, not by IAM.

Control plane actions (`bedrock:CreateGuardrail`, `UpdateGuardrail`, `CreateGuardrailVersion`) belong to Terraform running under the admin profile, which already holds them. The api user never gets a control plane action.
- `aws_cloudwatch_metric_alarm` on the guardrail's `InvocationsIntervened` metric (namespace `AWS/Bedrock/Guardrails`, dimensioned by guardrail id and version), threshold more than 5 interventions in 15 minutes, notifying the existing `portfolio-ops-topic`. Confirm at build time that this metric is published for standalone `ApplyGuardrail` calls and not only for inline model invocations. If it is not, drop the alarm and rely on `guardrailErrorCount` and `guardrailBlockCount`, and record that in Follow-up rather than inventing a substitute.

Explicitly **not** created: Bedrock model invocation logging, and CloudTrail data events for Bedrock runtime. Both would put Beta visitor text at rest in AWS and both would break the amended clause 1. Note that the AWS guardrails documentation actively recommends CloudTrail data events as the way to review `ApplyGuardrail` calls and spot `AccessDenied` misconfiguration. This spec declines that diagnostic on purpose, and accepts diagnosing permission problems from the api's own error tally and structured logs instead. State both refusals in the Terraform file as comments so nobody enables them later while debugging.

Also explicitly **not** created: an account level enforced guardrail configuration (`PutEnforcedGuardrailConfiguration`). It cannot reach Beta, and enabling it would silently apply this clinical policy to the interview simulator and the feedback classifier Lambda, where it adds cost and false positives and, in the classifier's case, degrades invisibly into "unclassified". Rejected in Options considered, option 3. If a later change makes anyone reach for it, read that option first.

### Version pinning

`BEDROCK_GUARDRAIL_VERSION` is pinned to a numbered version in Render, never `DRAFT`. Terraform creating a new version does not change production behavior; promoting it is a separate env var flip with the same rollback ergonomics as `BETA_GUARDRAIL_MODE`. The boot guard rejects the literal `DRAFT` and any non numeric value (AC-G10).

## Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Input check | text sent to AWS | `input.goals` only, already capped at 200 characters by the DTO. Omitted entirely when goals is absent, which skips the call |
| Input check | masked text used downstream | the `outputs[0].text` field of the `ApplyGuardrail` response, used only in `enforce` |
| Output check | text sent to AWS | one coach segment, split at `## ` line starts |
| Output check | grounding source | the matching drafter stage object from the already parsed `DraftPlan`, serialized. Null for the opening and closing segments |
| Output check | grounding query | synthesized from `injuryArea`, `onsetWeeksAgo`, `discipline`, `preInjuryGrade`, all enum or regex constrained. No free text |
| Both | guardrail id and version | env `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION` |
| Both | region and credentials | env `AWS_REGION` plus the `portfolio-api` user keys already in Render for the provider swap |
| Both | mode | env `BETA_GUARDRAIL_MODE`, resolved once at construction |
| Block response | visitor copy, input | existing `REFUSAL_MESSAGE` constant |
| Block response | visitor copy, output | new `GUARDRAIL_OUTPUT_BLOCK_MESSAGE` constant, human written |
| Counters | which column moves | the resolved mode plus the verdict, per the table above |

## Key invariants

- Every invariant in the api's "Beta module invariants" gotcha holds unchanged. The two code enforced hard blocks still run before any model call and before any guardrail call. `planCount` is still success only. No visitor content is written or logged.
- The guardrail is **additive and removable**. Mode `off` is the default and is byte for byte today's behavior.
- The guardrail can never manufacture a clinical outcome. It can refuse, and it can withhold, but the red flag copy and the referral advice remain human written constants reached only by the existing paths.
- Fail open is absolute. There is no guardrail failure that makes Beta less available than mode `off`.
- Only two text classes cross to AWS, and neither comes to rest there.
- Spec 0005 AC-P3 still holds: Beta stays on the direct Anthropic path with no provider conditionals in `beta.service.ts`.

## Security model and data boundary

Public unauthenticated endpoint, unchanged. No new visitor facing surface, no new stored data beyond three integer columns. Still consumer wellness education, still no PHI, still no HIPAA scope, exactly as spec 0004 named it.

What changes is the boundary, and it changes only if the engineer ratifies the D5 amendment. Under the amended clause: goals text and coach prose transit `ApplyGuardrail` in us-east-2 for a synchronous judgement and are never stored, never logged, and never used for generation. The credential is the existing `portfolio-api` IAM user, gaining exactly one new action scoped to exactly one resource ARN. AWS still holds no database credential and no Anthropic key. The negative half of the boundary (model invocation logging off, Bedrock runtime CloudTrail data events off, no Beta text in any CloudWatch line) is as much a part of the contract as the positive half, and AC-G9 makes it checkable.

## Configuration required

- `BETA_GUARDRAIL_MODE`: `off` (default, and the value on first deploy of the code), `shadow`, or `enforce`.
- `BEDROCK_GUARDRAIL_ID`: the guardrail id from the Terraform output.
- `BEDROCK_GUARDRAIL_VERSION`: a numbered version string. `DRAFT` and non numeric values are rejected at boot.
- Reuses `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` already present in Render for the provider swap child.
- New constant `GUARDRAIL_CALL_TIMEOUT_MS = 3_000` in `beta.constants.ts`, deliberately far below the model path's `AGENT_CALL_TIMEOUT_MS` of 60 seconds, because this call sits inside the visible stream. No retry: a retry doubles the visible latency for a layer that is allowed to fail.
- Boot guard mirroring the provider swap's: when mode is not `off`, id and version must be present and valid, or boot fails with a clear message. No live AWS call at boot.

## Cost and latency

**Billing unit**: Bedrock Guardrails bills per text unit of 1,000 characters, rounded up, with a minimum of one unit per call. Contextual grounding is metered separately and bills the source text as well as the response.

Per plan, at the shapes above:

| Payload | Calls | Text units |
|---|---|---|
| Input (goals, at most 200 characters) | 1 | 1 |
| Output segments (opening, 4 to 5 stages, closing) | 6 to 7 | about 7 on the standard meter |
| Grounding (per stage source plus segment, about 500 characters each) | included above | about 10 on the grounding meter |

That is roughly 8 standard text units and 10 grounding text units per completed plan. At Beta's hard cap of 40 plans per day every single day, that is about 10,000 standard and 12,000 grounding text units per month. At published 2026 Bedrock Guardrails rates that lands **under about ten dollars a month in the absolute worst case**, and in cents at a portfolio site's realistic traffic. Confirm the current per unit rate at build time and fold it into the tag filtered budget rather than trusting this estimate.

Worst case is bounded the same way Beta's model spend already is: the input guard sits inside `reserveGlobalSlot()`, and refused attempts refund the slot, so a determined abuser can drive guardrail calls exactly as far as they can already drive screener calls, which the 3 per hour per IP in memory throttle bounds. The guardrail adds no new abuse surface, only a proportional increment to an existing one.

**Latency**:

- Input: one sequential round trip, roughly 100 to 300 milliseconds, added to a time to first token already dominated by a screener call plus a full drafter call.
- Output in `shadow`: zero added latency, because the calls are not awaited.
- Output in `enforce`: roughly 150 to 300 milliseconds per segment, awaited. Time to first visible text rises by about the input call plus one segment check, so about half a second (AC-G12). The rest of the added time is spread across segment boundaries and is felt as chunkier streaming rather than as waiting.

## Critical test scenarios

All mocked, no network, per the repo's convention. `BetaGuardrailService` is mocked in `beta.service.spec.ts`; its own spec mocks the `send` method of `@aws-sdk/client-bedrock-runtime`.

- Mode `off`: zero `ApplyGuardrail` calls on every path, and the existing beta specs pass untouched. Verifies **AC-G1**.
- Shadow: calls are fired but never awaited before an emit, nothing is withheld, tokens arrive in the same order and shape as today, `guardrailFlagCount` increments. Verifies **AC-G2**.
- Enforce, input block: screener, drafter, and coach mocks are never called, the emitted event is `error` with `REFUSAL_MESSAGE`, and the refund carries reason `guardrail`. Verifies **AC-G3**.
- Enforce, output block on segment 3: segments 1 and 2 were emitted, segment 3 and everything after are not, a `guardrail_block` event is emitted, and the slot is refunded. Verifies **AC-G4**.
- Precedence: screener returns `red_flag` and the input guardrail also returned a block. The visitor gets the red flag card. Same test with the screener's fail closed coercion (an unparseable verdict). Verifies **AC-G5**.
- Fail open, four ways: the client throws, the call times out at 3 seconds, the call is throttled, and the credentials are rejected. In every case the plan completes normally and `guardrailErrorCount` increments once. Verifies **AC-G6**.
- Mask versus block: a response with `action: GUARDRAIL_INTERVENED` whose only assessment is a sensitive information `ANONYMIZE` proceeds with the masked text, and the screener mock receives the masked string. Verifies **AC-G8**.
- Payload discipline: assert the exact strings passed to the guardrail client. The input call carries only `goals`, never the assembled visitor profile (sending the profile would also risk the prompt attack filter tripping on Beta's own scaffolding tags). The output call carries one segment, and a grounding source only for `## Stage` segments. Verifies **AC-G9**.
- Boot guard: mode `shadow` with a missing id, and mode `enforce` with version `DRAFT`, each fail at construction with a clear message. Verifies **AC-G10**.
- Live corpus run (manual, in shadow, not a unit test): at least 30 realistic profiles across the three injury areas, including blunt injury description, profanity, constant pain wording, and ordinary goals. Zero interventions required before `enforce` is enabled. Verifies **AC-G7**.

## Build plan

Tracer Bullet ordering, the repo's default: a thin thread through every layer first, then thicken the policy. The thread is deliberately arranged so nothing a visitor sees changes until step 8.

1. `BetaGuardrailService` skeleton: client construction, mode resolution, boot guard, timeout constant, and a hard no op at mode `off`. Wired into `beta.service.ts` with the flag unset. Fully mocked spec. Satisfies **AC-G1**, **AC-G6**, **AC-G10**.
2. `infra/guardrails.tf` with a **minimal** policy: prompt attack HIGH on input, nothing else. First numbered version. `portfolio-api-guardrail-apply` policy and the user attachment. Terraform output for the id. Tony sets the Render env vars. Satisfies **AC-G9**, **AC-G10**.
3. Prisma migration adding the three tally columns (additive, no backfill), the `guardrail` refund reason, and the standalone increment paths. Satisfies **AC-G11**.
4. Input path in `shadow`: guard `input.goals` before the screener, record only. Verified live on a dev boot against the real guardrail. Satisfies **AC-G2**, **AC-G6**.
5. Output path in `shadow`: the segment accumulator around the coach stream, fire and forget per segment, per stage grounding source, tokens still emitted immediately. Satisfies **AC-G2**.
6. Thicken the policy to the full table above: content filter strengths, three denied topics with their exclusions, output profanity, input PII anonymize, contextual grounding thresholds. New numbered version, promoted by env flip. Satisfies **AC-G7**.
7. The corpus run and threshold tuning. Zero false positives is the gate on proceeding, not a nice to have. Satisfies **AC-G7**.
8. Enforce path: precedence rule, input block routed through the existing refusal, output segment withholding, the new `guardrail_block` event and card copy, the mask versus block distinction and the substitution, refund wiring, and the web client change shipped in the same push. Satisfies **AC-G3**, **AC-G4**, **AC-G5**, **AC-G8**, **AC-G11**, **AC-G12**.
9. CloudWatch alarm on `InvocationsIntervened` to the ops topic, after confirming the metric exists for standalone calls. Satisfies the observability half of **AC-G6**.
10. Gate and ship: `/predeploy-audit` with the clinical safety auditor, since this is a health adjacent surface and step 8 changes what an injured visitor sees. Deploy at `shadow`. Promote to `enforce` only after the soak, as an env change, not a deploy.

## Migration plan

**Strategy**: feature flagged, three phases, no data migration beyond three additive counter columns that default to zero.

**Phases**:
1. Code deployed with `BETA_GUARDRAIL_MODE` unset. Zero behavior change, zero AWS calls, zero cost. The migration lands here.
2. Flip to `shadow` in Render. Calls are made and recorded, nothing the visitor sees changes. Soak until the corpus run and the observed shadow rates are clean.
3. Flip to `enforce`. Behavior changes for the first time: blocking, masking, and segment paced streaming all begin together.

**Rollback**: set `BETA_GUARDRAIL_MODE=off` and restart. No code revert, no migration reversal, no AWS change. The counter columns are inert when the flag is off.

**Risks**: the phase 3 flip changes three things at once (blocking, masking, stream pacing), so a regression there needs bisecting by inspection rather than by flag. Splitting the flag further was considered and rejected as more configuration surface than a hobby project should carry; the mitigation is that phase 2 has already measured the block rate and the mask rate separately, so only the pacing change is unmeasured at flip time.

## Consequences

**Positive**:
- Beta gets a second, independent safety layer that does not depend on the prompts the same author wrote, which is the honest weakness of the current single layer design.
- The contextual grounding check catches the one clinical failure a prompt cannot reliably prevent: the coach inventing content the drafter never drafted.
- Guardrails, `ApplyGuardrail`, and guardrail versioning are direct AIP-C01 exam surface, exercised in production rather than in a tutorial.
- Removing it is one env var, so this never becomes load bearing infrastructure by accident.

**Negative and tradeoffs**:
- The umbrella's cleanest promise ("Beta content never leaves Render and Anthropic") stops being true. That is a real loss in the story, not just in the wording, and it is why D5 is surfaced rather than buried.
- `enforce` changes the streaming feel from token by token to segment by segment. That is the most likely thing a visitor actually notices, and it is a cost paid for a net that fires rarely.
- Three more columns on `BetaDailyUsageCounter`, a table spec 0004's own follow-up already flagged as heading toward a generalized redesign.
- Beta's request path gains an AWS dependency and an AWS SDK client on a surface that had exactly two external dependencies before.
- A guardrail policy is a tuning artifact, not a build artifact. It needs revisiting whenever the coach's prompt changes, and nothing in the repo will remind anyone of that.

**Neutral**:
- Beta stays on Sonnet 5 and on the direct Anthropic path, so the provider swap child's AC-P3 is unaffected and `AI_PROVIDER_BETA` stays reserved and unimplemented.
- The api gains `@aws-sdk/client-bedrock-runtime`, which the classifier Lambda already uses, so it is not a new dependency for the repo, only for this workspace.

## Follow-up

- [ ] **Ratify or reject the D5 amendment to cross child contract clause 1.** Nothing else in this spec can be built until that is settled.
- [ ] Decide the self harm and crisis question: whether a visitor expressing genuine distress should be detected at all, and if so what the response is. A guardrail block is the wrong answer, so this may belong in the screener with its own human written referral copy rather than here.
- [ ] Confirm current Bedrock Guardrails per text unit pricing at build time and add it to the tag filtered `genai-infra` budget.
- [ ] Confirm that `InvocationsIntervened` is published for standalone `ApplyGuardrail` calls. If not, drop the alarm from the build plan and record why.
- [ ] Re check Sonnet 5's Bedrock availability for this account whenever the architecture is revisited. **This is the trigger that flips D1**: if Sonnet 5 becomes available, option 2 (inline) plus option 4 (the `bedrock:GuardrailIdentifier` IAM condition key on the `portfolio-api` user) becomes the better architecture, because it buys unbypassable enforcement without a model downgrade. Nothing else about this spec would need to change first.
- [ ] Verify whether `us.` Geo inference profile ids can be named in `modelEnforcement.includedModels` or `excludedModels` at all. The documented pattern allows one dot; those ids carry two. Not needed for this child, since option 3 is rejected, but it would be load bearing for anyone reaching for account level enforcement later.
- [ ] The provider swap child still names Sonnet 5 as its Bedrock default, which is now stale: the interview simulator is live on `us.anthropic.claude-sonnet-4-6`. That child needs a correction pass, independent of this one.
- [ ] After shipping, add a line to the api's "Beta module invariants" gotcha recording that the guardrail is additive, fail open, and flag removable, so a later change does not mistake it for a load bearing block.

## Inline rationale

The decisive fact is the Bedrock model catalog, not the guardrail design. Sonnet 5 is unavailable to this account on Bedrock, so the inline guardrail option (move Beta to Bedrock, attach the guardrail to the model call) is not the tidy integration it looks like: it pays for a second safety layer by downgrading the model doing the clinical reasoning. On a surface whose safety story is partly "a good model, given conservative rules, drafting conservatively", that is a bad trade. The standalone `ApplyGuardrail` call costs two extra round trips and buys the layer with the audited path untouched.

Reading the code moved two things. First, the input guard is smaller than it looks: the only untrusted free text in a Beta request is a 200 character `goals` field, since every other input is an enum or a regex constrained grade, so the input call is one text unit and its real contribution is the prompt attack filter rather than a general content net. Second, the coach's output format turned out to be the key to the streaming problem. Its skill file already contracts for headingless opening and closing paragraphs and `## Stage n:` headings for every stage, which gives a deterministic segmentation, a per stage grounding source from the drafter's own JSON, and a principled reason to exempt the two segments that are legitimately ungrounded. Without that format contract, contextual grounding would fire on every plan and the whole output policy would collapse into content filters.

Two stronger looking mechanisms were checked against the AWS API reference and set aside. Account level enforcement and the `bedrock:GuardrailIdentifier` IAM condition key both make a guardrail impossible to skip, which is exactly the weakness of the chosen option, and both only reach invocations that pass through Bedrock. Beta does not, and moving it there is the trade option 2 already failed. Reading the account level API shape settled it further: its only scoping is per model, never per principal or per application, so it would impose a clinical policy on the interview simulator and the classifier Lambda as the price of covering Beta, and the classifier's failure mode is a silent fall back to "unclassified", meaning that damage would not even be visible. The unskippable versions of this control are therefore available for every surface in this program except the one that most needs them. If that ever becomes worth paying for, the mechanism is the IAM condition key, which is per principal, not account level enforcement.

The rest follows from what layer this is. It is the second one, behind a shipped and clinically audited first, so it fails open, it ships in shadow, and its default is off.
