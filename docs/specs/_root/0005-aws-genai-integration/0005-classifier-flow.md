# 0005 child: feedback classifier flow (SNS to Lambda to Bedrock to SES)

## Summary

When feedback arrives, a Lambda subscribed to the SNS topic asks a Claude model on Bedrock to classify it (bug, feature request, praise, other) and write a one line summary, then emails the owner the message with that classification attached. If Bedrock fails, the email still goes out plain. The flow is built in two rungs: first an SNS email subscription proves the event plumbing with no code, then the Lambda replaces it.

## Requirements

**User stories**:
- As the owner, I want each feedback submission in my inbox within a minute, pre classified, so that triage takes seconds.

**Acceptance criteria**:
- **AC-C1**: within about a minute of a submission, the owner receives an email containing source, category (visitor chosen, if any), the full message, createdAt, and the model's classification (label + one line summary).
- **AC-C2**: if the Bedrock call fails or returns an unparseable result, the email still delivers, marked "unclassified", within the same window. Classification failure never loses feedback delivery.
- **AC-C3**: if SES delivery fails, the Lambda invocation errors visibly: a CloudWatch alarm on the function's error metric notifies the owner by email through a separate ops subscription. (The Postgres row is the durable copy either way.)
- **AC-C4**: the only data crossing to AWS is the intake child's payload (id, source, category, message, createdAt). The handler never logs the message text; CloudWatch contains ids and outcomes only.
- **AC-C5**: least privilege holds: the Lambda role can invoke only the configured model resources, send email only from the verified identity, and write its own logs; the api's publisher user can only `sns:Publish` to this one topic ARN.

## Decision

Resources (all Terraform, in `infra/feedback.tf`):

- `aws_sns_topic` `portfolio-feedback-topic`; output its ARN for Render env.
- Rung 1: `aws_sns_topic_subscription` protocol email to the owner (proves plumbing; removed when rung 2 lands, or kept during transition).
- Rung 2: `aws_lambda_function` `portfolio-feedback-classifier`, Node 22 runtime, handler written in TypeScript in `infra/lambda/feedback-classifier/`; `aws_lambda_permission` + topic subscription protocol lambda. Packaging is a manual two step workflow documented in `infra/README.md`: `npm run build` (esbuild bundles to `dist/lambda.zip`), then `terraform apply` referencing the zip via `filename` plus `source_code_hash = filebase64sha256(...)`. No `local-exec` or `external` data sources, keeping applies reproducible. The handler directory becomes an npm workspace in the root `package.json`, so the repo's typecheck, lint, and test gates (and CI) cover it like any other workspace; it is never an ungated pocket of code.
- The api publisher user's Terraform managed policy (`sns:Publish` scoped to this topic ARN) also lives in `infra/feedback.tf`; Tony attaches it to the console created user by name.
- Bedrock call: AWS SDK v3 `@aws-sdk/client-bedrock-runtime` **Converse API** (verified current recommendation for simple calls). Model id from env `BEDROCK_MODEL_ID`; default `us.anthropic.claude-haiku-4-5-20251001-v1:0` (verified Geo US profile id; Haiku class is the cost right choice for a small classification call, and the account's catalog confirms it available). The Sonnet 5 profile works by changing the variable. Ids are configuration, never hardcoded in handler code. Note this Terraform variable and the provider swap child's Render env var share a name but are two independent settings; changing the model means updating both places by hand.
- Classification prompt: system prompt asks for strict JSON `{ "label": "bug|feature|praise|other", "summary": "<one line>" }`; the handler parses defensively and falls back to "unclassified" (AC-C2). Max output tokens small (about 200).
- Email: SES v2 `SendEmail` from and to the owner's verified identity (sandbox mode is sufficient since the only recipient is the owner). Subject carries source and label; body carries the full message and metadata.
- Alarm: `aws_cloudwatch_metric_alarm` on the function's `Errors` metric (threshold 1 in 5 minutes) notifying `portfolio-ops-topic` (email subscription, the owner).
- Retry semantics: SNS to Lambda default retries are accepted; duplicate emails are tolerable (at least once). No DLQ in v1 (Follow-up in the umbrella if volume ever warrants it).

**IAM (Lambda execution role)**, encoding the verified gotcha that us-east-2 requires the inference profile resource as well as the foundation model:

- `bedrock:InvokeModel` on `arn:aws:bedrock:*::foundation-model/*` AND `arn:aws:bedrock:us-east-2:<account>:inference-profile/*`. The region wildcard on the foundation model ARN is deliberate, not sloppy: AWS requires the caller to hold the foundation model permission in the source region AND every destination region of the Geo profile (us-east-1, us-east-2, us-west-2), and the wildcard covers exactly that requirement.
- `ses:SendEmail` scoped to the verified identity ARN
- CloudWatch Logs basic execution

## Value sourcing

| Action | Value produced | Source |
|---|---|---|
| Lambda classify | model id | env `BEDROCK_MODEL_ID` (Terraform variable, default above) |
| Lambda classify | label + summary | Bedrock Converse response, parsed; fallback "unclassified" on any failure |
| Lambda email | recipient and sender | Terraform variable `owner_email` (SES verified identity) |
| Alarm notification | recipient | ops topic email subscription (same `owner_email`) |
| Handler | region | Lambda's own region (us-east-2), no cross region config needed beyond the `us.` profile |

## Key invariants

- Feedback delivery never depends on classification success (AC-C2).
- Message text never appears in CloudWatch logs (AC-C4); the handler logs `{ id, label, outcome, durationMs }` only.
- All resources tagged per the umbrella; all IAM per AC-C5.

## Configuration required

- Terraform variables: `owner_email`, `bedrock_model_id` (default as above).
- Render env (from intake child): `SNS_FEEDBACK_TOPIC_ARN` set to this topic's output.

## Critical test scenarios

- Happy path: publish a test event, email arrives classified, verifies **AC-C1**.
- Failure case: point `BEDROCK_MODEL_ID` at a bogus id in a test invoke; email arrives "unclassified", verifies **AC-C2**.
- Failure case: SES identity unverified in a test invoke; invocation errors and the alarm email fires, verifies **AC-C3**.
- Boundary: inspect CloudWatch logs after the happy path; no message text present, verifies **AC-C4**.
- Handler unit tests (esbuild bundle has a small test harness): JSON parse fallback, payload shape validation, log discipline.

## Build plan

1. Terraform: topic + email subscription (rung 1); Render gets the ARN; end to end proof: submit feedback, raw email arrives. Satisfies plumbing for **AC-C1**.
2. Handler: TypeScript source, esbuild bundle script, unit tests for parse fallback and log discipline. Satisfies **AC-C2**, **AC-C4**.
3. Terraform: Lambda, role (per AC-C5), subscription swap, SES identity, ops topic + alarm. Satisfies **AC-C1**, **AC-C3**, **AC-C5**.
4. Live verification of all critical scenarios; then gate and commit (infra + handler are api adjacent but not Beta content; standard gate, no clinical pass needed for this child).

## Consequences

**Positive**: the owner's inbox becomes a triaged feedback stream; the flow exercises SNS, Lambda, Bedrock, SES, IAM, and CloudWatch alarms, the heart of AIP-C01 domains 2 through 5.
**Negative / tradeoffs**: at least once delivery means occasional duplicate emails; classification quality is unreviewed model output (acceptable for a single reader).
**Neutral**: SES stays in sandbox mode indefinitely; that is a feature here, not a limitation.

## Inline rationale

The two rung build proves each risk in isolation: rung 1 proves IAM, topic, and the api's publish path with zero code; rung 2 swaps in the compute. Converse over InvokeModel because the call is a simple single turn classification and Converse is the current AWS recommended unified interface. The alarm goes to a separate ops topic so a broken feedback topic cannot silence its own failure notifications.
