# 0005 child: Bedrock Guardrails on the Beta planner

## Summary

Beta moves onto Bedrock along with everything else, and gains guardrails without imposing them on every surface. Two guardrails, split along a permissiveness seam: a **baseline** guardrail (prompt attack filtering and PII masking) applied account wide through Bedrock's enforced configuration, because those two things help on every surface and hurt none, plus a **clinical** guardrail (denied topics about medication and diagnosis, contextual grounding of the coach against the drafted plan) applied only to Beta's calls. Enforced and request level guardrails layer as a union with the most restrictive control winning, so Beta gets both and nothing else gets the clinical one.

Two things must be said plainly rather than buried. First, moving Beta to Bedrock **downgrades the clinical surface from Sonnet 5 to Sonnet 4.6**, because Sonnet 5 returns 403 for this account. The health feature will run a weaker model than it runs today. Second, the clinical guardrail cannot be delivered the way it looks like it should be: `@anthropic-ai/bedrock-sdk` cannot carry a request level `guardrailConfig`, so the clinical half is applied through standalone `ApplyGuardrail` calls from the api instead. That is enforcement by the application, not by Bedrock.

This child needs an amendment to the umbrella's cross child contract clause 1, and the amendment is now much larger than a screening exception: under this architecture all Beta visitor content goes to AWS for generation.

## Requirements

**User stories**:
- As the owner, I want every AI surface on Bedrock so that the AWS work is real and consistent, without every surface having to pass a guardrail it does not need.
- As the owner, I want a second, independent safety net on Beta's clinical surface so that I can advertise the tool without the whole safety story resting on one screener call and my own prompt writing.
- As an injured climber, I want that net to be invisible when I am asking an ordinary question, so that describing a torn pulley in blunt words never gets me refused.

**Acceptance criteria** (the contract `/develop` builds to and `/check verify` checks):

- **AC-G1**: Beta generates through Bedrock behind `AI_PROVIDER_BETA`, streaming included, verified live in the browser. With the flag unset Beta stays on the direct Anthropic API and behavior is byte for byte today's.
- **AC-G2**: `BedrockAnthropicService.streamMessage` and `.forceToolCall` have unit tests before Beta is pointed at them, covering the request shape (including the `cache_control` block), token streaming, usage field extraction, and timeout and retry option passing. Beta must not be the first thing to exercise those methods in production.
- **AC-G3**: the baseline guardrail is enforced account wide in us-east-2 and applies to Bedrock calls with no request parameter, proven by a call that trips it.
- **AC-G4**: enabling enforcement breaks nothing. A documented dry run, before enforcement is switched on, proves that the interview simulator, the feedback classifier, and Beta all still work under the baseline policy, that streaming is unaffected, and that no surface's system prompt trips the prompt attack filter.
- **AC-G5**: the clinical guardrail applies to Beta only. No clinical denied topic ever evaluates an interview simulator or feedback classifier call.
- **AC-G6**: with `BETA_GUARDRAIL_MODE` unset or `off`, no clinical `ApplyGuardrail` call is made on any path, and every existing beta spec passes unchanged.
- **AC-G7**: in `shadow`, the visitor sees exactly what they see today: the same copy, the same token by token stream, the same timing within noise. Interventions are recorded as counter increments and structured log lines only.
- **AC-G8**: in `enforce`, an input intervention blocks before the screener runs. No screener, drafter, or coach call is made, the visitor sees the existing refusal copy, and the reserved global slot is refunded with reason `guardrail`.
- **AC-G9**: in `enforce`, an output intervention on a coach segment withholds that segment and every segment after it. The visitor sees the new guardrail card, plus the existing "cut off, do not follow a partial plan" warning when earlier segments were already on screen, and the slot is refunded.
- **AC-G10**: the clinical guardrail never overrides a clinical block. When the screener returns `red_flag` (including its fail closed coercion of an unparseable verdict) and the guardrail also intervened, the visitor sees the red flag card.
- **AC-G11**: the clinical `ApplyGuardrail` call fails open. Any error, timeout, throttle, or missing configuration on that call lets the request proceed as mode `off` would, logs one structured line, and increments `guardrailErrorCount`. (This does **not** extend to Bedrock generation itself, which Beta now depends on; see Consequences.)
- **AC-G12**: a masking only result is not a block. When the sensitive information policy anonymizes text and no filter, denied topic, or word policy returns a blocked action, the request proceeds with the masked text and the visitor is not refused.
- **AC-G13**: legitimate rehab content is never intervened on. A corpus of at least 30 realistic profiles across the three injury areas, deliberately including blunt injury description, profanity, constant pain wording, and ordinary climbing goals, produces zero interventions across a full shadow run before `enforce` is enabled.
- **AC-G14**: the data boundary holds as amended, and no Beta content comes to rest on AWS. Bedrock model invocation logging and CloudTrail data events for Bedrock runtime are both off, verified by a documented console check, and no Beta text appears in any CloudWatch log line.
- **AC-G15**: both guardrails are pinned to numbered versions. `DRAFT` is rejected at boot for the clinical guardrail and is not accepted by the enforcement API for the baseline. A Terraform policy edit cannot change production behavior without an explicit promotion step.
- **AC-G16**: counters follow the module's established pattern. `guardrailFlagCount` (shadow), `guardrailBlockCount` (enforce, riding the refund's atomic update), and `guardrailErrorCount` (fail open) each increment on their own event, and a lost tally write never disturbs the response.

## Options considered

The prior question, whether Beta should stay on the direct Anthropic API, is **settled by the engineer's intent**: everything moves to Bedrock. What was open is how to apply a guardrail selectively once it does, since blanket application is explicitly not wanted. Four ways were weighed.

### Option A: per request `guardrailConfig` in application code only

Beta's calls carry a guardrail identifier; other surfaces do not.

**Pros**: simple, surgical, exactly as selective as wanted, and expressed entirely in one module's code.
**Cons**: a future code path that forgets the parameter silently loses the layer, with nothing outside the repo to catch it. And, decisively, **it is not expressible on the SDK this repo uses** (see the finding below).

### Option B: IAM condition key `bedrock:GuardrailIdentifier`, scoped by model ARN

An IAM policy allows inference only when the request carries a named guardrail, with the `Resource` scoped to particular foundation model ARNs so only some surfaces are covered.

**Pros**: unbypassable at the permission layer, and selective within a single IAM user without needing separate credentials.
**Cons**: it discriminates by **model**, not by application. It only works if Beta uses a model id no other surface uses, and if Beta and the interview simulator both want Sonnet 4.6 there is nothing to key on. Verified against the AWS reference policies: the condition reads the guardrail identifier **present in the request**, so it also inherits option A's blocker completely. Since the SDK cannot put an identifier in the request, the paired `Deny` on `StringNotEquals` would reject every Beta call outright. Option B does not merely fail to help here, it would break the surface.

### Option C: two guardrails split along a permissiveness seam (chosen)

A permissive **baseline** guardrail applied account wide through `PutEnforcedGuardrailConfiguration`, plus a Beta specific **clinical** guardrail applied only to Beta's calls. Enforced and request level guardrails layer as a union with the most restrictive winning, so Beta gets both.

**Pros**: the insight that makes it work is that "guardrail" is not one thing. Prompt attack filtering and PII redaction are good on every surface in this program and have almost no false positive risk on any of them. Clinical denied topics and contextual grounding are Beta specific and would be actively harmful elsewhere. Splitting along that seam gives an **unbypassable floor everywhere** plus **depth where it matters**, and it needs none of the model id gymnastics option B depends on. The floor half is genuinely unforgettable: enforcement is server side and needs no request parameter, so no code path can drop it.
**Cons**: two guardrail resources and two mental models. Billing counts text units per guardrail ARN per request, so Beta's calls pay for both. The floor cannot be shadow tested in place, because enforcement has no shadow mode, so proving it safe takes a deliberate dry run. And the clinical half cannot be delivered as a request parameter, so it is applied by the api instead and is therefore not unbypassable.

### Option D: one guardrail account wide

A single guardrail, clinical policy included, enforced across the account.

**Pros**: one resource, one policy, nothing to forget anywhere.
**Cons**: rejected. The feedback classifier Lambda reads arbitrary visitor text and its documented failure mode is a silent fall back to "unclassified" (child spec AC-C2), so a clinical guardrail firing there would degrade classification invisibly. The interview simulator would eat latency, cost, and a refusal path it has no use for.

## The finding that reshapes option C

**`@anthropic-ai/bedrock-sdk` cannot carry a request level guardrail.** Verified 2026-08-19 against the AWS guardrails documentation and a matching open issue against Anthropic's own Bedrock path (`anthropics/claude-agent-sdk-python` issue 999, opened 2026-05-28, still open, no maintainer response).

The mechanics: on the `InvokeModel` and `InvokeModelWithResponseStream` path, a guardrail is requested through the `X-Amzn-Bedrock-GuardrailIdentifier` and `X-Amzn-Bedrock-GuardrailVersion` headers. When those headers are present, Bedrock additionally requires a top level `amazon-bedrock-guardrailConfig` object in the request body, and expects natural language segments wrapped in `<amazon-bedrock-guardrails-guardContent_...>` marker tags (with `tool_use` and `tool_result` blocks left unwrapped). The Anthropic SDKs emit Anthropic Messages shaped bodies with neither, so Bedrock rejects the call with HTTP 400 "Guardrail was enabled but input is in incorrect format" **before the model is invoked**. It fails closed and loudly, which is the one mercy here.

`guardrailConfig` as a first class parameter belongs to the `Converse` and `ConverseStream` operations, which this repo does not use for chat. `infra/bedrock.tf` and the provider swap child deliberately chose `@anthropic-ai/bedrock-sdk` precisely because `messages.create` and `messages.stream` are shape identical to the direct SDK, which is what made the provider swap a zero consumer change refactor.

Three ways out, and the third is chosen:

1. **Smuggle the header and body fields through the Anthropic SDK.** Undocumented, unsupported, and the sibling SDK's issue shows it is exactly the thing that breaks. It would also need the marker tag wrapping, which means reimplementing Bedrock's tagging format by hand inside a clinical surface. Rejected.
2. **Move Beta to the raw `Converse` API** via `@aws-sdk/client-bedrock-runtime`. This is where `guardrailConfig`, `guardContent` tagging, and `streamProcessingMode` all work properly. But it means rewriting `forceToolCall` and `streamMessage` against a different message shape, a different tool call shape, and a different streaming event model, for Beta only, which splits the provider abstraction the last child just built. Rejected for this child, recorded in Follow-up as the honest long term answer if request level guardrails become important.
3. **Apply the clinical guardrail through standalone `ApplyGuardrail` calls** from the api, while Beta's generation goes through Bedrock like everything else. Chosen. The AWS documentation describes `ApplyGuardrail` as explicitly decoupled from model invocation and designed for exactly this, and the SDK issue names it as the workaround. The cost is that the clinical layer is enforced by the api reading a verdict, not by Bedrock refusing to answer, so it carries option A's forgettable property. The baseline half remains unbypassable, which is where the floor belongs.

**Net effect on option C**: the split survives intact and so does its reasoning. The floor is enforced by AWS; the depth is enforced by the application. That asymmetry is a real weakening of what option C promised and is recorded as such.

## Decisions awaiting ratification

**None of these is settled until the engineer ratifies it.**

### D1. Beta moves to Bedrock, and guardrails are split into baseline and clinical

**Chosen**: option C. Beta joins the `AI_PROVIDER` abstraction through the `AI_PROVIDER_BETA` flag the provider swap child reserved for exactly this, generating on Bedrock like every other surface. A permissive baseline guardrail is enforced account wide; a clinical guardrail is applied to Beta's calls only, through `ApplyGuardrail`. **Runner up**: option A, per request configuration only, which is what option C degrades to if account enforcement cannot be made safe.

This supersedes spec 0005 AC-P3's clause that Beta keeps the direct path. That clause was scoped to the provider swap child and explicitly deferred the question here, so this is the intended succession, not a contradiction.

### D2. Which policy goes in which guardrail

**Chosen**: the seam is false positive risk, not subject matter. Anything that is safe on an interview transcript, a feedback message, and a rehab plan alike goes in the baseline. Anything tuned to clinical language stays Beta specific. **Runner up**: putting PII masking in the clinical guardrail too, so Beta's boundary story does not depend on an account wide setting.

### D3. Failure mode: the clinical call fails open

**Chosen**: any failure of the clinical `ApplyGuardrail` call lets the request proceed. **Runner up**: fail closed.

The reasoning has changed since Beta moved to Bedrock and must be restated honestly. Previously fail open was defensible because Beta did not depend on AWS at all, so degrading to today's audited posture cost nothing. **That is no longer true**: Beta now generates on Bedrock, so an AWS outage takes Beta down whatever the guardrail does. What survives of the argument is narrower and still sound: when generation has succeeded and only the guardrail call failed, turning that into a visitor facing error converts a working plan into an outage for a layer that is additive. Layer one (the code blocks, the fail closed screener, conservative drafter rules) is unaffected either way.

### D4. Rollout: shadow first for the clinical guardrail, dry run first for the baseline

**Chosen**: `BETA_GUARDRAIL_MODE` with values `off`, `shadow`, `enforce` for the clinical half, deployed at `shadow`. For the baseline half there is no shadow mode, because enforcement is server side and binary, so its equivalent is a deliberate dry run: exercise the baseline policy against representative prompts from all three surfaces using standalone `ApplyGuardrail` calls, which are free standing and affect nothing, and only then switch enforcement on. **Runner up**: enforce both from the start.

### D5. The data boundary amendment (much larger than before)

Clause 1 currently reads, in part: "Beta planner visitor content (injury details, goals, plans) never leaves Render and the direct Anthropic API." Under this architecture that is not merely narrowed, it is **withdrawn**. All Beta visitor content now goes to AWS for generation, not two slices for screening.

**Proposed replacement wording for clause 1** (the feedback half is unchanged):

> 1. **Data boundary (refined 2026-08-19; amended by the Guardrails child, pending ratification).** Beta planner visitor content is processed on AWS. Beta's three agent calls run on Amazon Bedrock in us-east-2, so the full assembled prompt (the skill files plus the visitor's structured answers and free text goals) and the full generated plan pass through Bedrock for generation. The account enforced baseline guardrail evaluates those calls, and Beta's clinical guardrail additionally sends the goals text and each coach output segment, with the matching drafter stage object as grounding source, to the Bedrock `ApplyGuardrail` API. **The previous promise, that Beta visitor content never leaves Render and the direct Anthropic API, is withdrawn.** What replaces it is narrower and is the whole of the commitment: no Beta visitor content is ever persisted anywhere outside Postgres on Render, and Postgres holds only anonymous counters for Beta, never content. Bedrock model invocation logging stays off, CloudTrail data events for Bedrock runtime stay off, no S3 or DynamoDB holds Beta content, and no CloudWatch log line may contain it. Feedback text remains a separate, consented class: the form labels it "do not include personal or medical details", and it may transit AWS (SNS, Lambda, Bedrock, SES) for classification and delivery, but is never persisted on AWS (no S3, no DynamoDB, no CloudWatch log line containing the text). Postgres on Render remains the only store.

**Runner up**: keep Beta on the direct Anthropic API so the stronger clause survives, and apply the clinical guardrail through `ApplyGuardrail` alone. This is worth naming because it is now the **only** option that preserves both Sonnet 5 and the original boundary promise, and it costs only the consistency of having everything on Bedrock.

## Decision

### The two guardrails

**`portfolio-baseline-guardrail`**, account enforced, deliberately permissive. Every policy in it is chosen because it is beneficial on an interview transcript, a feedback message, and a rehab plan alike.

| Policy | Setting | Why it is safe everywhere |
|---|---|---|
| `PROMPT_ATTACK` | HIGH, input | every surface takes untrusted text; none has a legitimate reason to accept instruction injection |
| Sensitive information | `NAME`, `EMAIL`, `PHONE`, `ADDRESS`, anonymize (never block), input | masking cannot refuse anyone; `AGE` is excluded because it is clinically relevant to a rehab plan |
| `HATE`, `SEXUAL` | LOW, both directions | no surface has a legitimate use |

Deliberately **not** in the baseline: denied topics of any kind, `VIOLENCE`, `INSULTS`, `MISCONDUCT`, profanity, and contextual grounding. Each of those is either clinical or a false positive risk on at least one surface.

**`portfolio-beta-clinical-guardrail`**, applied by the api to Beta only, through `ApplyGuardrail`.

| Policy | Setting | Reasoning |
|---|---|---|
| Denied topics (output only) | `medication_and_dosage`, `diagnosis_as_fact`, `invasive_or_procedural_treatment` | the subtlest part; see the definitions below |
| `VIOLENCE` | NONE input, LOW output | "it popped", "I tore a pulley" is the product's own vocabulary and the likeliest false positive on this surface |
| `INSULTS` | NONE input, MEDIUM output | a frustrated climber swearing at their finger must still get help |
| `MISCONDUCT` | LOW input, MEDIUM output | catches the coach drifting into unsafe instruction |
| Word filter | managed profanity, output only | same reason as `INSULTS` |
| Contextual grounding | stage segments only, grounding 0.5, relevance 0.5 | the strongest fit in the whole design |

**Denied topics are output only.** On input, the screener skill file already treats requests for medication advice or diagnosis as `off_topic`. Duplicating that on input would refuse a visitor who merely mentions they took ibuprofen. The coach must never *answer* those things, which is what these catch. Each definition names its exclusions, because the exclusions are what keep the product working:

- `medication_and_dosage`: naming, recommending, or dosing any drug, supplement, injection, or painkiller. Excludes: describing pain levels, exercise dosage in sets, reps, load, or frequency, and advising the visitor to see a professional.
- `diagnosis_as_fact`: asserting a specific named diagnosis, tear grade, or structural classification as fact about this person, or interpreting imaging results. Excludes: referring to the injury area the visitor selected, and general education about how that kind of injury behaves.
- `invasive_or_procedural_treatment`: recommending surgery, injections, manipulation, or prescriptive taping and splinting as treatment. Excludes: telling the visitor a professional may consider such options.

Deliberately **not** included: a self harm or crisis denied topic. A visitor in genuine distress writing "the pain is unbearable" is a real edge case, but a guardrail block is the worst available response to it, and the phrase is also ordinary climbing injury language. Left open in Follow-up rather than guessed at.

**Contextual grounding**, the strongest fit, because the coach's job per its skill file is literally "rewrite this JSON, keep every number, add nothing":

- **Source**: the single drafter stage object matching that segment, serialized, not the whole plan. Cheaper and semantically correct.
- **Query**: a fixed string synthesized from the structured fields only, for example "A staged return to climbing plan for a shoulder_impingement, 6 weeks after onset, for a sport climber at 5.11a." No free text enters the query.
- **Critical exclusion**: the coach's opening and closing paragraphs are legitimately not grounded in the JSON, since the skill file mandates a fixed warm opening and a closing that adds a referral reminder. Applying grounding to them would fire on every plan. Those segments are sent as plain text with no grounding source, so the grounding policy does not evaluate them. This is why segmentation happens at heading boundaries: the coach skill file requires the opening and closing to carry no heading and every stage to carry a `## Stage n:` heading, so the split is already deterministic.

### Where the calls sit

| Order | Step | Change |
|---|---|---|
| 1 | Checked red flag box, hard block in code | unchanged, still first, still costs nothing |
| 2 | Constant rest pain escalation, hard block in code | unchanged |
| 3 | `reserveGlobalSlot()` | unchanged |
| **3a** | **Clinical `ApplyGuardrail` on `input.goals`** | new |
| 4 | Screener, `forceToolCall` | **now on Bedrock**, baseline guardrail applies server side |
| 5 | Drafter, `forceToolCall` | **now on Bedrock**, baseline applies |
| 6 | Coach, `streamMessage` | **now on Bedrock**, baseline applies; segment accumulator added |
| **6a** | **Clinical `ApplyGuardrail` per coach segment** | new |

The input call is sequential rather than run in parallel with the screener, because PII masking has to be applied before the model sees the text, because a blocked input then saves three model calls, and because it keeps the precedence rule below clean. The cost is one round trip, roughly 100 to 300 milliseconds, on a path already several seconds long.

Input scope stays exactly as scoped before: **only `input.goals`**, never the assembled `buildVisitorProfile` string. The DTO caps `goals` at 200 characters, and every other field is an enum validated by `IsIn` or a grade constrained by regex to 12 characters, so `goals` is the only untrusted free text in the whole request. Sending Beta's own `<visitor_profile>` scaffolding into a prompt attack filter would be asking for a false positive on our own tags.

### Precedence when layers disagree

1. **Screener `red_flag` wins over everything.** Telling someone who described numbness "we cannot process that" instead of "please see a doctor trained in nerve evaluation" is a strictly worse outcome. The guardrail intervention is still counted and logged.
2. **Clinical input intervention beats `off_topic`.** Both produce the same visible refusal, so only the counter differs. Attribute it to the guardrail, which fired first.
3. **`off_topic` unchanged** when the guardrail was clean.
4. On output there is no competing layer, so an intervention is terminal.
5. **A baseline block arrives differently**: it comes back as a Bedrock error or a blocked completion on the generation call itself, not as a verdict the api asked for. It is handled by the existing upstream error path and surfaces as the friendly error.

### A masking result is not a block

`ApplyGuardrail` returns `action: GUARDRAIL_INTERVENED` when the sensitive information policy merely anonymizes, exactly as when a content filter blocks. A naive `action === 'GUARDRAIL_INTERVENED'` check would refuse every visitor who types a name. Treat the result as a **block** only when a content filter, denied topic, or word policy reports a blocked action, and as a **mask** when the only intervention came from the sensitive information policy. On a mask, pass the guardrail's returned masked text downstream in place of the raw goals.

### Streaming

Unchanged from the previous design, and it survives precisely because the clinical guardrail is a standalone call rather than an inline one. Had it been inline, Bedrock's own `streamProcessingMode` would have governed this and the choice would not have been ours.

- The coach's token callback appends to a buffer. A segment closes when a new `## ` heading arrives at a line start, and the final segment closes when the stream ends.
- In `shadow`: tokens are emitted immediately as they arrive, exactly as today. When a segment closes, the `ApplyGuardrail` call is fired without being awaited, purely to record a verdict. Nothing is withheld, so shadow is genuinely invisible.
- In `enforce`: tokens are held in the segment buffer. When a segment closes its verdict is awaited, then the whole segment is emitted as one `plan_delta` if clean, or the stream is terminated if not.

The difference between modes is one `await` at one call site. The honest cost: **in `enforce` the plan appears segment by segment rather than token by token.** That still satisfies spec 0004 AC-4, but it is visible and it is the main thing to watch during the soak.

Rejected alternatives: per token guarding costs one billed call per chunk with a one text unit minimum; buffering the whole output before display kills progressive streaming; guarding after the fact cannot block anything.

### What the visitor sees

Reuse where the meaning matches, add new copy only where it does not.

| Event | What the visitor gets | New copy |
|---|---|---|
| Input intervention (`enforce`) | the **existing refusal path**: `error` carrying `REFUSAL_MESSAGE`. Identical in meaning to an `off_topic` verdict, and no web client change needed | no |
| Output intervention (`enforce`) | a **new** `guardrail_block` SSE event and card. The existing failure copy claims something went wrong on our side, which would be a lie, and its retry button would invite a loop | yes, one constant |
| Output intervention with text already shown | the new card **plus** the existing "cut off, do not follow a partial plan" warning | no |
| Screener red flag, guardrail also fired | the existing red flag card | no |
| Baseline guardrail block on generation | the existing friendly error, through the normal upstream error path | no |
| Clinical guardrail unavailable | nothing; identical to mode `off` | no |

New constant in `beta.constants.ts`, human written like every other safety string there:

> `GUARDRAIL_OUTPUT_BLOCK_MESSAGE`: "Beta stopped this plan partway through. The wording it was writing did not pass Beta's own safety check, so the rest was not shown. Nothing you entered was stored, and this attempt did not count against your daily limit. Drafting a fresh plan usually works. If it stops again, this tool is not the right fit for your situation, and a physical therapist or sports medicine doctor is."

Deploy skew note: the web client's SSE switch has no `default` branch, so a stale cached client receiving `guardrail_block` ignores it, never sets `terminal`, and falls through to the existing "connection dropped" error, which also shows the partial plan warning. That degradation is safe, and the window is only the gap between the Vercel and Render deploys of one push.

### Observability and counters

Follows the module's established pattern: one column per outcome, additively migrated onto `BetaDailyUsageCounter`, still zero visitor content.

| Column | Counts | Incremented from |
|---|---|---|
| `guardrailFlagCount` | shadow observations: an intervention that would have blocked, plus a mask that would have applied | standalone `safeIncrement`, swallowed and logged |
| `guardrailBlockCount` | enforced clinical interventions, input and output alike | rides `refundGlobalSlot('guardrail')`'s atomic update, like the existing reasons |
| `guardrailErrorCount` | fail open events on the clinical call | standalone `safeIncrement`, swallowed and logged |

`guardrailErrorCount` earns its column because in a fail open design it is the only durable signal that the layer has silently stopped working, and Render's free tier logs do not persist.

Structured log line per clinical call, carrying no visitor text: `{ guardrail: 'input' | 'output', mode, segment, action, topPolicy, durationMs, outcome }`. `topPolicy` is a policy name such as `denied_topic:medication_and_dosage`, never the matched text.

One new refund reason, `guardrail`, joining `error`, `red_flag`, and `refusal`.

### Code shape

- Beta stops constructor injecting the concrete `AnthropicService` and takes the `AiProvider` token instead, resolved by `AI_PROVIDER_BETA` with fallback to `AI_PROVIDER`. The `BETA_PROVIDER = 'anthropic'` constant in `beta.service.ts` becomes the resolved provider name and keeps feeding the per call log line's `provider` field.
- A new `BetaGuardrailService` issues `ApplyGuardrailCommand` from `@aws-sdk/client-bedrock-runtime` (already a dependency of the classifier Lambda). It exposes `checkInput(goals)` and `checkSegment(text, stageJson | null, query)`, each returning `{ action: 'none' | 'mask' | 'block', maskedText?, policy? }` and each swallowing its own failures into `action: 'none'` plus the error tally.
- `beta.service.ts` still contains no provider conditionals. The provider choice lives in the factory, and the guardrail service is mode aware internally.

### Terraform and IAM

New file `infra/guardrails.tf`:

- `aws_bedrock_guardrail` `portfolio-baseline-guardrail` and `portfolio-beta-clinical-guardrail`, plus an `aws_bedrock_guardrail_version` for each. Versions are immutable, which is what makes pinning meaningful.
- `aws_iam_policy` `portfolio-api-guardrail-apply`: one `bedrock:ApplyGuardrail` statement scoped to the **clinical** guardrail ARN, attached to the existing console created `portfolio-api` user that `infra/bedrock.tf` already reads with `data "aws_iam_user" "api"`. Kept separate from `portfolio-api-bedrock-invoke` so it can be detached alone.
- The account enforced configuration for the baseline is **not** Terraform managed. The AWS provider appears not to expose the resource yet (provider issue 47400 open as of 2026-08), so it is a documented console or CLI step in `infra/README.md`, and it is the one exception to umbrella AC-1 that this child creates. Record it as an exception rather than pretending otherwise.

Two ARN details that are easy to get wrong:

- The `ApplyGuardrail` resource is `arn:aws:bedrock:us-east-2:<account>:guardrail/<id>` with **no region wildcard**, deliberately unlike the foundation model ARNs in `bedrock.tf` and `feedback.tf`. Those need a wildcard because a `us.` Geo inference profile requires the permission in every destination region. `ApplyGuardrail` is a single region call against a single region resource.
- The `ApplyGuardrail` statement's resource is the **unversioned** guardrail ARN. The version is a request parameter, not part of the authorized resource, so version pinning is enforced by the boot guard, not by IAM.

The verified account enforcement request shape, since the baseline depends on it:

| Field | Required | Notes |
|---|---|---|
| `configId` | no | pattern `[a-z0-9]+` |
| `guardrailInferenceConfig.guardrailIdentifier` | yes | id or guardrail ARN |
| `guardrailInferenceConfig.guardrailVersion` | yes | pattern `[1-9][0-9]{0,7}`, so a published numeric version. **`DRAFT` is not accepted** |
| `guardrailInferenceConfig.modelEnforcement` | no | `includedModels` and `excludedModels`; absent means all models |
| `guardrailInferenceConfig.selectiveContentGuarding` | no | `system` and `messages`, each `SELECTIVE` or `COMPREHENSIVE`, both defaulting to `COMPREHENSIVE` |

`modelEnforcement` exists but should not be relied on here. The documented pattern for both model lists allows exactly one dot (`[a-z0-9-]{1,63}[.][a-z0-9-]{1,63}` plus optional suffixes), while this account calls `us.` Geo inference profile ids, which carry two. Whether an inference profile id can be named in those lists at all is unverified, and the baseline is meant to apply everywhere anyway, so leave `modelEnforcement` absent.

Also explicitly **not** created: Bedrock model invocation logging, and CloudTrail data events for Bedrock runtime. Both would put Beta visitor text at rest on AWS and break the amended clause 1. The AWS guardrails documentation actively recommends CloudTrail data events for reviewing `ApplyGuardrail` calls; this spec declines that diagnostic on purpose and accepts diagnosing permission problems from the api's own error tally instead. State both refusals as comments in the Terraform file.

### Two things that must be proven before enforcement is switched on

Both concern the baseline half, and both are cheap to test and expensive to discover in production.

1. **Does an account enforced guardrail work at all against an Anthropic Messages shaped body?** The finding above shows that a *request level* guardrail on that path fails with HTTP 400 because the body lacks `amazon-bedrock-guardrailConfig`. It is not documented whether server side enforcement injects the guardrail without that requirement or applies the same validation. If it applies the same validation, **switching enforcement on breaks every Bedrock call in the account**, including the interview simulator that is live today. Test it on one throwaway call before touching anything else.
2. **What does enforcement do to streaming?** `streamProcessingMode` is a request parameter with no equivalent in the enforcement configuration. If enforcement defaults to synchronous processing, the coach's stream and the interview simulator's stream would both buffer before delivery, which would be a visible regression on two surfaces.

If either fails, the fallback is stated now so it is not invented under pressure: keep the split, and apply **both** guardrails from the api through `ApplyGuardrail`, with the baseline applied to every surface's calls in application code. That loses unbypassability and gains a small amount of latency, and it is still better than one blanket guardrail.

## Value sourcing

| Action | Value produced | Source |
|---|---|---|
| Beta generation | provider | `AI_PROVIDER_BETA`, falling back to `AI_PROVIDER` |
| Beta generation | model id | env `BEDROCK_MODEL_ID`, Sonnet 4.6 Geo profile |
| Clinical input check | text sent | `input.goals` only, capped at 200 characters. Absent goals skips the call |
| Clinical input check | masked text | `outputs[0].text` of the response, used only in `enforce` |
| Clinical output check | text sent | one coach segment, split at `## ` line starts |
| Clinical output check | grounding source | the matching drafter stage object from the parsed `DraftPlan`. Null for opening and closing |
| Clinical output check | grounding query | synthesized from `injuryArea`, `onsetWeeksAgo`, `discipline`, `preInjuryGrade`, all constrained. No free text |
| Clinical check | guardrail id and version | env `BEDROCK_CLINICAL_GUARDRAIL_ID`, `BEDROCK_CLINICAL_GUARDRAIL_VERSION` |
| Baseline check | guardrail id and version | the account enforcement configuration, not a request parameter |
| Both | region and credentials | env `AWS_REGION` and the `portfolio-api` user keys already in Render |
| Clinical mode | mode | env `BETA_GUARDRAIL_MODE`, resolved once at construction |
| Block response, input | visitor copy | existing `REFUSAL_MESSAGE` |
| Block response, output | visitor copy | new `GUARDRAIL_OUTPUT_BLOCK_MESSAGE` |

## Key invariants

- Every invariant in the api's "Beta module invariants" gotcha holds unchanged. Both code enforced hard blocks still run before any model call and before any guardrail call. `planCount` is still success only. No visitor content is written or logged.
- The clinical guardrail can never manufacture a clinical outcome. It can refuse and withhold; the red flag copy and referral advice remain human written constants reached only by the existing paths.
- The clinical guardrail is additive and removable by one env var.
- No clinical policy ever evaluates a non Beta surface.
- No Beta content comes to rest on AWS.
- **Withdrawn**: the previous invariant that Beta stays available when AWS is not. Beta now generates on Bedrock and depends on it.

## Configuration required

- `AI_PROVIDER_BETA`: `anthropic` (default) or `bedrock`. Implements the flag the provider swap child reserved.
- `BETA_GUARDRAIL_MODE`: `off` (default), `shadow`, or `enforce`, governing the clinical guardrail only.
- `BEDROCK_CLINICAL_GUARDRAIL_ID` and `BEDROCK_CLINICAL_GUARDRAIL_VERSION`: a numbered version; `DRAFT` and non numeric values rejected at boot.
- Reuses `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID`.
- New constant `GUARDRAIL_CALL_TIMEOUT_MS = 3_000` in `beta.constants.ts`, far below the model path's 60 second `AGENT_CALL_TIMEOUT_MS`, because this call sits inside the visible stream. No retry: retrying doubles visible latency for a layer allowed to fail.
- Boot guard mirroring the provider swap's: when the clinical mode is not `off`, id and version must be present and valid, or boot fails with a clear message. No live AWS call at boot.

## Cost and latency

**Billing**: per text unit of 1,000 characters, rounded up, minimum one unit per call. Contextual grounding is metered separately and bills the source as well as the response. Consumption counts **per guardrail ARN per request**, so Beta's generation calls pay the baseline once each, and Beta's clinical calls pay the clinical guardrail on top.

Per completed plan:

| Payload | Calls | Text units |
|---|---|---|
| Baseline on three generation calls | 3 | roughly 4 to 6, mostly the drafter's large prompt |
| Clinical input (goals, at most 200 characters) | 1 | 1 |
| Clinical output segments (opening, 4 to 5 stages, closing) | 6 to 7 | about 7 on the standard meter |
| Clinical grounding (per stage source plus segment) | included above | about 10 on the grounding meter |

Roughly 12 to 14 standard text units and 10 grounding units per plan, up from the 8 and 10 of the previous design, because the baseline now bills on generation too. At the hard cap of 40 plans per day every day, that is about 16,000 standard and 12,000 grounding units per month for Beta. The interview simulator and classifier also start paying the baseline on every call, which is new spend on surfaces that had none. At published 2026 rates the whole program stays in low single digit dollars per month at worst, but the number should be confirmed at build time and folded into the tag filtered budget rather than trusted from here.

Worst case is bounded as before: the clinical input guard sits inside `reserveGlobalSlot()`, refused attempts refund the slot, so an abuser can drive guardrail calls exactly as far as they can already drive screener calls, which the 3 per hour per IP throttle bounds.

**Latency**:
- Baseline on generation: unknown until measured, and it is on the critical path of every call on every surface. Measure during the dry run.
- Clinical input: one sequential round trip, roughly 100 to 300 milliseconds.
- Clinical output in `shadow`: zero, the calls are not awaited.
- Clinical output in `enforce`: roughly 150 to 300 milliseconds per segment, awaited. Time to first visible text rises by about half a second; the rest is felt as chunkier streaming.

## Critical test scenarios

All mocked, no network, per the repo's convention.

- `BedrockAnthropicService` unit tests, new: request shape including the `cache_control` block, `onToken` delivery, usage field extraction, timeout and retry option passing, for both `streamMessage` and `forceToolCall`. Verifies **AC-G2**.
- Beta on Bedrock: full plan generated with `AI_PROVIDER_BETA=bedrock`, streamed in the browser; regression suite green with the flag unset. Verifies **AC-G1**.
- Baseline dry run (manual): representative prompts from all three surfaces passed to the baseline policy through `ApplyGuardrail`, including each surface's full system prompt, with zero interventions required. Verifies **AC-G4**.
- Clinical mode `off`: zero `ApplyGuardrail` calls on every path, existing beta specs untouched. Verifies **AC-G6**.
- Shadow: calls fired but never awaited before an emit, nothing withheld, token order and shape unchanged, `guardrailFlagCount` increments. Verifies **AC-G7**.
- Enforce, input block: screener, drafter, and coach mocks never called; emitted event is `error` with `REFUSAL_MESSAGE`; refund reason `guardrail`. Verifies **AC-G8**.
- Enforce, output block on segment 3: segments 1 and 2 emitted, 3 and after not, `guardrail_block` emitted, slot refunded. Verifies **AC-G9**.
- Precedence: screener `red_flag` plus a guardrail block yields the red flag card; repeated for the fail closed coercion. Verifies **AC-G10**.
- Fail open, four ways: client throws, times out at 3 seconds, is throttled, credentials rejected. Plan completes normally, `guardrailErrorCount` increments once. Verifies **AC-G11**.
- Mask versus block: `GUARDRAIL_INTERVENED` whose only assessment is a sensitive information `ANONYMIZE` proceeds with masked text, and the screener mock receives the masked string. Verifies **AC-G12**.
- Payload discipline: assert exact strings passed to the guardrail client. Input carries only `goals`; output carries one segment with a grounding source only for `## Stage` segments. Verifies **AC-G14**.
- Boot guard: clinical mode `shadow` with a missing id, and `enforce` with version `DRAFT`, each fail at construction. Verifies **AC-G15**.
- Live corpus run (manual, in shadow): at least 30 realistic profiles including blunt injury description, profanity, constant pain wording, and ordinary goals. Zero interventions before `enforce`. Verifies **AC-G13**.

## Build plan

Tracer Bullet ordering. Nothing a visitor sees changes until step 8, and the two riskiest steps (2 and 6) are gated by proof rather than by hope.

1. `BedrockAnthropicService` unit tests for `streamMessage` and `forceToolCall`, closing review finding B-5 **before** the clinical surface depends on that class. Satisfies **AC-G2**.
2. **Gate**: prove the two open questions about account enforcement on a throwaway call, before any other AWS change. Does enforcement work against an Anthropic Messages shaped body, and what does it do to streaming? If either fails, take the stated fallback and revise this plan. Satisfies **AC-G3** groundwork.
3. Beta onto Bedrock: implement `AI_PROVIDER_BETA`, move Beta from the concrete `AnthropicService` to the token, make the `provider` log field reflect the resolved choice. Verified live with the flag on. Satisfies **AC-G1**.
4. `BetaGuardrailService` skeleton: client, mode resolution, boot guard, timeout constant, hard no op at mode `off`. Fully mocked spec. Satisfies **AC-G6**, **AC-G11**, **AC-G15**.
5. `infra/guardrails.tf`: both guardrails with minimal policies, first numbered versions, the `portfolio-api-guardrail-apply` policy and attachment, outputs for the ids. Tony sets the Render env vars. Satisfies **AC-G5**, **AC-G15**.
6. Baseline dry run across all three surfaces, then enable account enforcement through the console or CLI, documented in `infra/README.md` as the AC-1 exception. Satisfies **AC-G3**, **AC-G4**.
7. Prisma migration adding the three tally columns, the `guardrail` refund reason, the standalone increment paths. Satisfies **AC-G16**.
8. Clinical input and output paths in `shadow`: guard `goals` before the screener, add the segment accumulator around the coach stream with per stage grounding sources, fire and forget, tokens still immediate. Satisfies **AC-G7**.
9. Thicken the clinical policy to the full table, new numbered version, promoted by env flip. Then the corpus run and threshold tuning; zero false positives is the gate on proceeding. Satisfies **AC-G13**.
10. Enforce path: precedence, input block through the existing refusal, output segment withholding, `guardrail_block` event and card, mask versus block handling and substitution, refund wiring, web client change in the same push. Satisfies **AC-G8**, **AC-G9**, **AC-G10**, **AC-G12**, **AC-G16**.
11. Gate and ship: `/predeploy-audit` with the clinical safety auditor, since this is a health adjacent surface, step 3 changes which model reasons about injuries, and step 10 changes what an injured visitor sees. Deploy at `shadow`, promote to `enforce` after the soak as an env change.

## Migration plan

**Strategy**: feature flagged, four phases, no data migration beyond three additive counter columns defaulting to zero.

**Phases**:
1. Tests and the enforcement gate. No production change.
2. Beta onto Bedrock behind `AI_PROVIDER_BETA`. **This is the phase that changes the clinical model** from Sonnet 5 to Sonnet 4.6, and it is worth pausing on rather than passing through.
3. Baseline enforcement on, after the dry run. Affects all three surfaces at once.
4. Clinical guardrail `off`, then `shadow`, then `enforce`.

**Rollback**: phase 4 by env var. Phase 3 by deleting the enforcement configuration in the console. Phase 2 by unsetting `AI_PROVIDER_BETA`, which returns Beta to Sonnet 5 on the direct API. Phases are independently reversible, which is the main reason for the ordering.

**Risks**: phase 3 is the only one that changes three surfaces simultaneously and the only one not reversible by an env var, which is why the gate in step 2 and the dry run in step 6 both sit in front of it. Phase 4's flip changes blocking, masking, and stream pacing together; the soak measures the first two, so only pacing is unmeasured at flip time.

## Consequences

**Positive**:
- Every AI surface runs on Bedrock, which is the consistency the engineer wants and a stronger claim than a partial migration.
- An unbypassable floor (prompt attack, PII masking) now covers surfaces that had no guardrail at all, including the feedback classifier reading arbitrary visitor text.
- The clinical depth lands only where it belongs, so the classifier's silent "unclassified" failure mode is never triggered by a policy meant for rehab prose.
- Contextual grounding catches the one clinical failure a prompt cannot reliably prevent: the coach inventing content the drafter never drafted.

**Negative and tradeoffs**:
- **The clinical surface runs a weaker model.** Sonnet 5 returns 403 for this account on Bedrock, so Beta's drafter, the clinical reasoning core, drops to Sonnet 4.6. The health feature will reason about injuries with half a generation less capability than it does today, in exchange for consistency and guardrail coverage. This is the single most consequential line in this spec. **Falsifiable trigger for reversing it**: if Sonnet 5 becomes available on Bedrock for this account, phase 2 should be revisited immediately and the model restored. Until then, the clinical safety auditor should be told explicitly that the model changed.
- **Beta now depends on AWS to function at all.** The previous posture, where an AWS problem could not touch Beta, is gone. Fail open on the guardrail no longer buys availability, only the narrower guarantee that a guardrail hiccup does not discard a plan that generated fine.
- **The clinical guardrail is not unbypassable.** The SDK cannot carry a request level guardrail, so the api enforces it by reading a verdict. A future refactor that drops the call silently removes the layer, mitigated only by the module's invariants list and tests.
- The umbrella's cleanest promise is withdrawn, not narrowed. All Beta visitor content now goes to AWS for generation.
- `enforce` changes streaming from token by token to segment by segment, the most likely thing a visitor notices, paid for a net that fires rarely.
- Account enforcement is the one resource this program cannot express in Terraform, so umbrella AC-1 gains a documented exception.
- Three more columns on `BetaDailyUsageCounter`, a table spec 0004 already flagged as heading toward a generalized redesign.
- A guardrail policy is a tuning artifact, not a build artifact. It needs revisiting whenever the coach's prompt changes, and nothing in the repo will remind anyone.

**Neutral**:
- `@aws-sdk/client-bedrock-runtime` becomes an api dependency; it is already used by the classifier Lambda, so it is new to this workspace only.
- `AI_PROVIDER_BETA` stops being a reserved name and becomes real, as the provider swap child intended.

## Follow-up

- [ ] **Ratify or reject the D5 amendment to cross child contract clause 1.** It is now a withdrawal, not a narrowing. Nothing else here can be built until it is settled.
- [ ] **Run the step 2 gate before anything else.** If account enforcement cannot work against an Anthropic Messages shaped body, or forces synchronous streaming, option C's floor half is not deliverable as described and this spec needs revising, not patching.
- [ ] Re check Sonnet 5's Bedrock availability whenever this is revisited. It is the trigger that would restore the clinical model.
- [ ] Decide the self harm and crisis question: whether a visitor expressing genuine distress should be detected at all, and what the response is. A guardrail block is the wrong answer, so it may belong in the screener with its own human written referral copy.
- [ ] Consider moving Beta to the raw `Converse` API if request level guardrails ever become important enough to justify splitting the provider abstraction. That is the only path to an inline, unbypassable clinical guardrail.
- [ ] Confirm current Bedrock Guardrails per text unit pricing at build time and add it to the tag filtered `genai-infra` budget, including the new baseline spend on the interview simulator and classifier.
- [ ] Confirm that `InvocationsIntervened` is published for standalone `ApplyGuardrail` calls before relying on a CloudWatch alarm; if not, the counters carry it alone.
- [ ] Verify whether `us.` Geo inference profile ids can be named in `modelEnforcement.includedModels` or `excludedModels`. Not needed while the baseline applies everywhere, but load bearing if anyone ever scopes it.
- [ ] The provider swap child still names Sonnet 5 as its Bedrock default, which is stale: the interview simulator is live on `us.anthropic.claude-sonnet-4-6`. That child needs a correction pass, independent of this one.
- [ ] After shipping, add a line to the api's "Beta module invariants" gotcha recording that the clinical guardrail is additive, fail open, and flag removable, so a later change does not mistake it for a load bearing block.

## Inline rationale

The engineer's intent settles the question the previous draft spent its length on: everything goes to Bedrock, Beta included. What remained was how to apply guardrails without applying them everywhere, and the answer that survives contact with the details is that "guardrail" is not one thing. Prompt attack filtering and PII masking are good on an interview transcript, a feedback message, and a rehab plan alike. Clinical denied topics and grounding against a drafted plan are good on exactly one of those and harmful on another, because the classifier's failure mode is silent. Splitting along that seam is what lets the floor be enforced account wide while the depth stays local.

Two details did real work. The coach's output format, which contracts for headingless opening and closing paragraphs and `## Stage n:` headings, gives deterministic segmentation, a per stage grounding source from the drafter's own JSON, and a principled reason to exempt the two segments that are legitimately ungrounded; without it, contextual grounding would fire on every plan. And the DTO, which caps `goals` at 200 characters and constrains every other field to an enum or a regex, means the input guard has exactly one small payload to inspect.

The uncomfortable part is the model. Moving the clinical surface to Bedrock costs half a generation of capability on the agent that reasons about injuries, in exchange for consistency and coverage. That is a defensible trade and it is the engineer's to make, but it should be made with the sentence said out loud rather than discovered later in a diff.
