# infra

Terraform for the portfolio's AWS GenAI program (spec
[0005-aws-genai-integration](../docs/specs/_root/0005-aws-genai-integration/index.md),
foundation child
[0005-aws-foundation.md](../docs/specs/_root/0005-aws-genai-integration/0005-aws-foundation.md),
classifier child
[0005-classifier-flow.md](../docs/specs/_root/0005-aws-genai-integration/0005-classifier-flow.md)).

Small, deliberately scoped surface: plain pinned resources, no registry
modules in v1. Region is us-east-2 throughout.

## One-time bootstrap (done)

Terraform state cannot store the bucket that stores it, so the state bucket
is created by hand, once, outside Terraform:

- **Bucket**: `portfolio-terraform-state-635474720027`
- **Region**: us-east-2
- **Versioning**: on
- **Encryption**: default (SSE-S3)
- **Public access**: blocked; ACLs disabled
- **Tags**: `project = genai-track`

The `635474720027` suffix is the AWS account id the bucket lives in —
deterministic and collision-free, so it's hardcoded directly in
[`backend.tf`](./backend.tf) (backend blocks can't read Terraform
variables). This bucket already exists; nothing in this repo creates it, and
`terraform destroy` will never touch it because it isn't a managed resource.

If it ever needs recreating (new account, disaster recovery), the AWS CLI
equivalent is:

```bash
aws s3api create-bucket \
  --bucket portfolio-terraform-state-<account-id> \
  --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2

aws s3api put-bucket-versioning \
  --bucket portfolio-terraform-state-<account-id> \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket portfolio-terraform-state-<account-id> \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

State locking uses Terraform's native S3 lockfile (`use_lockfile = true`,
Terraform >= 1.10) — no DynamoDB lock table.

## IAM principals (also done by hand, outside Terraform)

Per the umbrella spec's cross-child contract, Tony creates all IAM users,
roles with long-lived keys, and access keys in the AWS console himself.
Terraform only manages roles/policies that carry no secrets (e.g. the
Lambda execution role and the `portfolio-feedback-publish` policy below).
Principals created by hand:

- The apply profile used to run Terraform locally (see below).
- The api's publisher user, scoped to publishing one SNS topic. Terraform
  defines the scoping policy (`aws_iam_policy.feedback_publish` in
  [`feedback.tf`](./feedback.tf)); attach it to the console-created user by
  name after `terraform apply`.
- The provider-swap user (added when that child lands).

Access keys for any of these enter Render through its env var UI, never
through code, state, or chat.

## Apply workflow

Applies are run locally by Tony, never in CI (v1 scope explicitly excludes
CI applies — see the child spec's Consequences).

1. Configure an AWS CLI profile with `AdministratorAccess`. This is a
   deliberate, accepted tradeoff for a solo operator applying locally: a
   hand-scoped policy would need editing for every child this program adds,
   and gains nothing when the only caller is the person who owns the
   account.

   ```bash
   aws configure --profile portfolio-infra
   ```

2. Point Terraform at it, e.g.:

   ```bash
   export AWS_PROFILE=portfolio-infra
   ```

3. From `infra/`:

   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

4. Review the plan output yourself before approving — local applies mean
   the plan is only as reviewed as the person running it.

## Packaging the feedback classifier Lambda (two-step workflow)

The classifier Lambda (`aws_lambda_function.feedback_classifier` in
[`feedback.tf`](./feedback.tf)) is deployed from a zip that Terraform does
**not** build itself — no `local-exec` or `external` data source, so plans
stay reproducible and never run a bundler as a side effect. Packaging is a
manual two steps, always in this order:

1. **Build the bundle.**

   ```bash
   cd infra/lambda/feedback-classifier
   npm run build
   ```

   This runs `scripts/build.mjs`: esbuild bundles `src/index.ts` (and its
   local imports) into a single minified CommonJS file, then zips it to
   `dist/lambda.zip` with the Lambda-required root entry `index.js`
   (handler `index.handler`). `dist/` is gitignored — rebuild it fresh
   before every apply that touches the handler.

2. **Apply.**

   ```bash
   cd infra
   terraform apply
   ```

   `aws_lambda_function.feedback_classifier` reads the zip via `filename`
   and `source_code_hash = filebase64sha256(...)`; Terraform only pushes a
   new Lambda version when the zip's hash actually changed.

If you skip step 1 (or the zip is missing), `terraform plan`/`apply` will
fail on `filebase64sha256` — there is no fallback that special-cases a
missing file, by design, so a stale or absent bundle is never applied
silently.

## Manual rollout steps

These cannot be scripted or Terraform-managed; do them once per environment
after `terraform apply`, and re-do the confirmations if a subscription is
ever recreated:

- **SNS email subscription confirmations.** Two topics carry an `email`
  protocol subscription to `var.owner_email`: the feedback topic's rung-1
  subscription (`aws_sns_topic_subscription.feedback_email_rung1`) and the
  ops topic's alarm subscription (`aws_sns_topic_subscription.ops_email`).
  AWS emails a confirmation link to `owner_email` for each; until it's
  clicked, that subscription silently drops notifications (SNS does not
  retry or alert on an unconfirmed subscription). Confirm both.
- **SES identity verification.** `aws_sesv2_email_identity.owner` declares
  the identity but cannot click the verification link AWS sends to
  `owner_email`. Until verified, `ses:SendEmail` from the Lambda fails
  (which *will* trip the CloudWatch alarm below, correctly, but every
  feedback email is lost until this is done — verify it before relying on
  the pipeline). SES stays in sandbox mode indefinitely, which is fine
  here: the only sender and only recipient are the same verified address.
- **CloudWatch alarm sanity check.** After the first real (or manual test)
  invocation, confirm `portfolio-feedback-classifier-errors` shows
  `OK`/`INSUFFICIENT_DATA` as expected in the CloudWatch console — this
  alarm is the only signal for an SES failure (AC-C3), so a
  misconfiguration here fails silently otherwise.
- **First Bedrock invocation.** Per the umbrella spec, the Anthropic First
  Time Use form must be submitted once (any Claude model card in the
  Bedrock Model catalog, account-wide) before `bedrock:InvokeModel` will
  succeed; the very first call can transiently `AccessDenied` for up to
  ~15 minutes while the marketplace subscription completes.
- **Attach the publisher policy.** `aws_iam_policy.feedback_publish` is
  created by Terraform but not attached to anything — attach it by name to
  the api's console-created publisher user (see IAM principals above), then
  set `SNS_FEEDBACK_TOPIC_ARN` in Render to the `feedback_topic_arn`
  output.

## Variables

Set required variables via a local, gitignored `terraform.tfvars` or
`-var` flags — never commit real values. See [`variables.tf`](./variables.tf)
for the full list (currently `owner_email`, `bedrock_model_id`).

## Conventions

- Every managed resource carries `project = "genai-track"` and
  `managed_by = "terraform"` via provider `default_tags` in
  [`providers.tf`](./providers.tf).
- Resource names prefix `portfolio-` (e.g. `portfolio-feedback-topic`).
- No secret material — access keys, connection strings, API keys — ever
  appears in this directory's `.tf` files, in a committed `.tfvars` file, or
  by design in state. See [`.gitignore`](./.gitignore).
- `outputs.tf` starts empty; later children add outputs there rather than
  creating a second outputs file.
- The Lambda handler is a real npm workspace
  (`infra/lambda/feedback-classifier`, registered in the root
  `package.json`), so the repo's root `npm run lint`, `npx tsc --noEmit`,
  and its own `npm test` cover it like any other workspace — it is never an
  ungated pocket of code.

## Layout

```
infra/
  README.md          this file
  versions.tf         terraform >= 1.10, aws provider pinned ~> 6.0
  backend.tf          s3 backend: bucket, key, region, use_lockfile = true
  providers.tf        aws provider, region us-east-2, default_tags
  variables.tf         owner_email, bedrock_model_id, and similar knobs
  outputs.tf           topic ARNs, SES identity ARN, function name
  feedback.tf          0005-classifier-flow: SNS, Lambda, IAM, SES, alarm
  lambda/
    feedback-classifier/  TypeScript handler, its own npm workspace
      src/               index.ts (handler), payload/classify/email modules
      scripts/build.mjs  esbuild + zip -> dist/lambda.zip (see Packaging above)
      dist/              gitignored build output
```
