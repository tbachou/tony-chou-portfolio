# 0005. AWS GenAI integration (umbrella)

**Date**: 2026-08-19
**Status**: Proposed

## Summary

The portfolio gains a small AWS footprint in us-east-2, managed as code with Terraform, to serve two goals at once: real product features (a visitor feedback pipeline with AI classification, and running an existing agent on Amazon Bedrock) and hands on preparation for the AWS Certified Generative AI Developer exam (AIP-C01). Hosting stays split on purpose: the site stays on Vercel, the api stays on Render, and AWS carries only event driven GenAI infrastructure. Feedback text may pass through AWS for classification but is never stored there; the Beta planner's visitor content never leaves Render and Anthropic at all.

## Structure

Child specs, in build order:

1. [0005-aws-foundation.md](0005-aws-foundation.md): the Terraform scaffold, state backend, IAM baseline, tagging, and region conventions every other child builds on.
2. [0005-feedback-intake.md](0005-feedback-intake.md): the anonymous feedback form (Beta and portfolio surfaces), api endpoint, Postgres table, and the SNS publish hook.
3. [0005-classifier-flow.md](0005-classifier-flow.md): SNS to Lambda to Bedrock to SES. Classifies each feedback message and emails the owner.
4. [0005-provider-swap.md](0005-provider-swap.md): the AI_PROVIDER flag that can serve the interview simulator through Bedrock instead of the direct Anthropic API.

Planned future children, added when their build is reached (listed in Follow-up): Bedrock Guardrails on the Beta planner, and a Bedrock Knowledge Base RAG source for the interview agent.

## Cross child contract

Every child must honor these. They are the umbrella's law, and a child may tighten but never loosen them.

1. **Data boundary (refined 2026-08-19).** Beta planner visitor content (injury details, goals, plans) never leaves Render and the direct Anthropic API. Feedback text is a separate, consented class: the form labels it "do not include personal or medical details", and it may transit AWS (SNS, Lambda, Bedrock, SES) for classification and delivery, but is never persisted on AWS (no S3, no DynamoDB, no CloudWatch log line containing the text). Postgres on Render remains the only store.
2. **Credentials are one directional.** The api holds AWS credentials scoped to publishing one SNS topic. AWS never holds database credentials or Anthropic keys for the Render side. Tony creates all IAM users, roles, and keys in the console himself; keys enter Render through its env UI, never through code, state, or chat.
3. **Region**: us-east-2. Claude models reach Bedrock there through cross region inference profiles (ids prefixed `us.`) when not directly hosted.
4. **Tagging**: every Terraform managed resource carries `project = "genai-track"` through provider `default_tags`. After first spend, Tony activates the tag for cost allocation and creates the tag filtered budget (see Follow-up).
5. **Naming**: resources prefix `portfolio-` (for example `portfolio-feedback-topic`).
6. **Small scope Terraform**: only resources these children need. No modules from registries in v1; plain resources, pinned provider versions.

## Requirements

Umbrella level acceptance criteria (each child adds its own):

- **AC-1**: All AWS resources for this program are defined in `infra/` Terraform; nothing hand created except the bootstrap state bucket and IAM principals Tony creates himself.
- **AC-2**: The data boundary in the cross child contract holds end to end and is asserted in each child's tests where code can enforce it (payload builders, log scrubbing).
- **AC-3**: The feedback pipeline works end to end: a visitor submits feedback, the row lands in Postgres, and Tony receives a classified email.
- **AC-4**: The interview simulator can serve traffic through Bedrock behind `AI_PROVIDER=bedrock` and revert by flipping the flag, with no code change.

## Decision

**Chosen option**: split hosting with a Terraform managed AWS enclave (Option 1 in rationale.md).

The site stays on Vercel and the api on Render; AWS carries only the event driven GenAI pieces, defined as code in a new `infra/` workspace with S3 backed state using Terraform's native S3 locking (Terraform 1.10 or newer, no DynamoDB lock table).

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Build plan

Tracer Bullet ordering (the repo's default approach): stand the thinnest end to end thread up first, then thicken. Task detail lives in each child; this is the cross child order.

1. Foundation: bootstrap state bucket (manual, documented), Terraform scaffold, providers, tags, outputs. Satisfies **AC-1**.
2. Intake thin thread: migration, POST endpoint, minimal form on the portfolio surface, SNS publish stub behind an env flag (logs instead of publishing until the topic exists). Satisfies **AC-3** partially, **AC-2**.
3. Classifier thin thread: topic, SNS email subscription first (no Lambda), prove the event arrives as an email. Then replace with Lambda, Bedrock classification, SES formatted email. Satisfies **AC-3**.
4. Intake thickening: Beta surface form, rate limits hardened, copy pass. Satisfies **AC-3**.
5. Provider swap: abstraction seam, error normalization, `AI_PROVIDER` flag, Bedrock path for the interview simulator, provider tagged logging. Satisfies **AC-4**.
6. Rollout steps: Anthropic First Time Use form submitted once from any Claude model card in the Model catalog (account wide, covers all commercial regions; the first invocation can transiently fail with AccessDenied for up to about 15 minutes while the marketplace subscription completes); SES identity verification; confirming the SNS email subscriptions by clicking their confirmation emails (feedback topic rung 1, and the ops topic); budget tag activation; Render env vars; one gated push per child (each passes the predeploy audit; the intake child touches Beta surfaces, so its push includes the clinical auditor).

## Consequences

**Positive**:
- Real production GenAI on AWS with receipts, aligned to about 88 percent of AIP-C01 exam weight across the four children.
- The feedback loop the product lacked, with zero PII held.
- Infrastructure decisions become reviewable text instead of console clicks.

**Negative / tradeoffs**:
- Two clouds plus a PaaS means three consoles, three billing surfaces, three failure domains; the cross child contract and cross referenced comments are the mitigation, not a cure.
- Bedrock has no free tier; cost is expected in cents per month at current caps, guarded by budgets, but it is real spend.
- Terraform state introduces a bootstrap chicken and egg (the state bucket) and a new operational artifact to protect.

**Neutral**:
- The api gains an AWS SDK dependency (SNS client) even when the flag is off.
- `docs/scope/` still does not exist; this umbrella's build plan is the source of truth until a scope is created.

## Follow-up

- [ ] Write child specs for Bedrock Guardrails on Beta (hard prerequisite before broadly advertising Beta) and Knowledge Base RAG, when their builds are reached.
- [ ] Install the three community skills shortlisted for this program (`hashicorp/agent-skills@terraform-style-guide`, `aws/agent-toolkit-for-aws@aws-iam`, `aws/agent-toolkit-for-aws@aws-serverless`) pending Tony's approval, then reference them in root AGENTS.md and the new `infra/AGENTS.md`.
- [ ] After first AWS spend: activate the `project` cost allocation tag and create the tag filtered `genai-infra` budget.
- [ ] Run /sync (or /audit infra) after the foundation lands so `infra/` gets its own AGENTS.md and the root AGENTS.md learns the new workspace.
- [ ] Observability Phase 2 (Sentry on the api, admin spaces, AccessRequest cleanup) stays paused and is a prerequisite for advertising Beta, tracked outside this spec.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
