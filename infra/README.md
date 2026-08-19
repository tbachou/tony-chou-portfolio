# infra

Terraform for the portfolio's AWS GenAI program (spec
[0005-aws-genai-integration](../docs/specs/_root/0005-aws-genai-integration/index.md),
foundation child
[0005-aws-foundation.md](../docs/specs/_root/0005-aws-genai-integration/0005-aws-foundation.md)).

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
Terraform only manages roles/policies that carry no secrets (e.g. a Lambda
execution role added by a later child). Principals created by hand:

- The apply profile used to run Terraform locally (see below).
- The api's publisher user (scoped to publishing one SNS topic; added when
  the feedback-intake child lands).
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

## Layout

```
infra/
  README.md          this file
  versions.tf         terraform >= 1.10, aws provider pinned ~> 6.0
  backend.tf          s3 backend: bucket, key, region, use_lockfile = true
  providers.tf        aws provider, region us-east-2, default_tags
  variables.tf         owner_email, bedrock_model_id, and similar knobs
  outputs.tf           empty; children add outputs
  feedback.tf          (classifier child adds this)
  lambda/               (classifier child adds handler source here)
```
