# 0005 rationale: AWS GenAI integration

## Context

Tony is actively applying for senior engineering roles and pursuing the AWS Certified Generative AI Developer Professional exam (AIP-C01, GA April 2026). He needs verifiable, production grade AWS GenAI experience, not console tutorials. At the same time the portfolio product has real gaps this program can close: there is no feedback channel for visitors, and all AI traffic runs through one provider path (the direct Anthropic API) with no exercised alternative.

Forces: a solo engineer with limited time (job applications compete for it); a hard privacy stance already audited into the Beta planner (visitor content is never persisted or logged); an existing split deployment (Vercel site, Render api, shared Prisma Postgres) that works and is cheap; exam domains that weight foundation model integration (31 percent), implementation (26 percent), and AI safety (20 percent); and a standing rule that resume claims must trace to shipped work.

Not deciding means the cert prep happens in disposable sandboxes that produce no portfolio value, and the feedback and provider resilience gaps stay open.

## Options considered

### Option 1: split hosting with a Terraform managed AWS enclave (chosen)

Keep Vercel and Render as they are. Add a small AWS footprint (SNS, Lambda, SES, Bedrock, IAM) defined in a new `infra/` Terraform workspace, carrying only the event driven GenAI features.

**Pros**:
- Each workload stays on the platform best suited to it; the story is "chosen per workload", which is true.
- Smallest possible AWS surface to operate and secure; cents per month.
- Infrastructure as code fits the repo's review gates and multi agent workflow.

**Cons**:
- Three consoles and billing surfaces; cross cloud IAM and data boundary need explicit care.
- The api to AWS hop adds one more failure domain to the feedback pipeline.

### Option 2: migrate everything to AWS

Move the api to ECS or App Runner, Postgres to RDS, and the site to Amplify or CloudFront, then build the GenAI features in a single cloud.

**Pros**:
- One cloud, one console, deep general AWS operational experience.
- A migration write up is itself an interview story.

**Cons**:
- Weeks of work with zero user visible improvement, during active job applications.
- Teaches SAA and DevOps material, not AIP-C01 material; SSE streaming and free tier economics get worse.
- Reads as resume driven development because it would be.

### Option 3: console first, no infrastructure as code

Click the resources together in the AWS console and write only the application code.

**Pros**:
- Fastest first demo.

**Cons**:
- Unreviewable, unreproducible, invisible to the repo and its gates; contradicts the engineering discipline story the portfolio exists to tell.

### Option 4: AWS CDK in TypeScript instead of Terraform

Same enclave, defined with CDK.

**Pros**:
- Infrastructure in the language Tony is branded on; loved by AWS native shops.

**Cons**:
- Terraform appears in far more job postings and is cloud agnostic, matching the split hosting narrative. Tony chose Terraform with scope kept small.

## Rationale

Option 1 wins on the forces that matter: time (no migration tax), truthfulness (the split is genuinely the right architecture, so the interview story writes itself), exam alignment (every child spec maps to AIP-C01 domains), and privacy (the enclave design forces the data boundary to be explicit instead of implicit). Options 2 and 3 each sacrifice one of those pillars; option 4 is a coin flip Tony settled on market breadth grounds.

The engineer set two constraints the umbrella encodes as law: Terraform scope stays small (plain pinned resources, no registry modules in v1), and the data boundary is refined rather than broken (feedback text transits AWS with consent language on the form; Beta planner content never leaves Render and Anthropic).

## Evidence

Verified 2026-08-19 by read only research agents against official sources; load bearing facts baked into the children:

- `@anthropic-ai/bedrock-sdk` 0.32.4: `AnthropicBedrock` client, standard AWS credential chain, region must be explicit (`awsRegion` or `AWS_REGION`); `messages.create` and streaming are shape identical to the direct SDK; `countTokens` and batches conveniences are absent (unused by this api); prompt caching only via explicit `cache_control` (unused by this api).
- us-east-2 has no in region Claude hosting; access is via cross region inference profiles (`us.` prefix). Verified profile id used as the default: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Newer models exist and ship as un dated ids; the builder confirms the current best id in the live console at build time and sets it by env var, never hardcodes it.
- IAM for Bedrock invocation must grant resources on BOTH `foundation-model/*` and the account's `inference-profile/*` (documented AWS gotcha; invoking a base model id on demand in us-east-2 fails with HTTP 400).
- Converse API (`@aws-sdk/client-bedrock-runtime`) is the recommended interface for simple classification calls from Lambda.
- Pricing: Sonnet class at 3 and 15 dollars per million input and output tokens; at tens of classification calls per day, well under 1 dollar per month.
- Research caveat kept honest: the agent could not independently corroborate the newest model family names on Anthropic's own docs pages and flagged them; the spec therefore treats the model id as configuration with a verified default, which is the correct design regardless.
- Community skill shortlist (installs pending the engineer's approval): `hashicorp/agent-skills@terraform-style-guide`, `aws/agent-toolkit-for-aws@aws-iam`, `aws/agent-toolkit-for-aws@aws-serverless`; each installable individually. HashiCorp's Terraform MCP server and the AWS Labs MCP exist and were deferred as setup weight not yet earned.

Related decisions recorded elsewhere: the CloudWatch versus Sentry split (CloudWatch for AWS side flows, Sentry planned for the Render api in the paused observability Phase 2) and Beta advertising prerequisites live in the project memory and observability plan, not this spec.
