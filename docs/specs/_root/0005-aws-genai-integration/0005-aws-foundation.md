# 0005 child: AWS foundation (Terraform scaffold)

## Summary

A new `infra/` workspace holds all Terraform for the program: pinned providers, S3 backed state with Terraform's native lockfile, default tags, and the shared outputs other children consume. One manual bootstrap step (the state bucket) is documented rather than automated, because state cannot store the bucket that stores it.

## Requirements

**User stories**:
- As the owner, I want every AWS resource defined as reviewable code so that infrastructure passes the same gates as application code.

**Acceptance criteria**:
- **AC-F1**: `terraform plan` and `apply` run cleanly from `infra/` on Terraform 1.10 or newer, with state in the bootstrap S3 bucket using native S3 locking (`use_lockfile = true`), no DynamoDB table.
- **AC-F2**: every managed resource carries `project = "genai-track"` and `managed_by = "terraform"` tags via provider `default_tags`; region is us-east-2.
- **AC-F3**: `infra/README.md` documents the one time bootstrap (bucket create with versioning and encryption) and the apply workflow, including that Tony runs applies locally with his own AWS profile. The apply profile uses `AdministratorAccess`, stated and accepted in the README: a solo operator applying locally gains nothing from a hand scoped policy that would need editing every child, and the tradeoff is already accepted in Consequences.
- **AC-F4**: no secret material (access keys, connection strings, API keys) appears in Terraform code, variables files committed to git, or state by design; the only IAM principals with long lived keys are created by Tony in the console, outside Terraform.

## Decision

Plain Terraform, no registry modules in v1. Layout:

```
infra/
  README.md          bootstrap and apply workflow
  versions.tf        terraform >= 1.10, aws provider pinned (~> latest major at build time)
  backend.tf         s3 backend: bucket, key "portfolio/terraform.tfstate", region, use_lockfile = true
  providers.tf       aws provider, region us-east-2, default_tags
  variables.tf       owner_email, model id, and similar knobs
  outputs.tf         topic ARNs and other values children publish
  feedback.tf        (classifier child adds this)
  lambda/            (classifier child adds handler source here)
```

Division of labor for IAM, per the umbrella contract: Terraform manages roles and policies that carry no secrets (the Lambda execution role, policy documents). Tony creates in the console, by hand: the bootstrap admin for applies, the api publisher user, the provider swap user, and all access keys. Terraform may define the managed policies those users attach, referenced by name in README instructions.

## Build plan

1. Tony (console): create the state bucket `portfolio-terraform-state-<account-id>` in us-east-2 with versioning and default encryption (the suffix is the AWS account id: deterministic, collision free, and safe to hardcode in the committed `backend.tf`, which cannot read variables); create his apply profile (`AdministratorAccess`, per AC-F3). Documented in README. Satisfies **AC-F3**.
2. Builder: scaffold the files above; `terraform init` and an empty `plan` pass. Satisfies **AC-F1**, **AC-F2**.
3. Builder: add a `.gitignore` for `.terraform/`, `*.tfstate*`, `*.tfvars` (committed `.tfvars.example` only). Satisfies **AC-F4**.
4. Gate and commit; run /audit or /sync so `infra/` gains an AGENTS.md (umbrella Follow-up).

## Consequences

**Positive**: every later child is a reviewable diff to `infra/`.
**Negative / tradeoffs**: local applies mean the plan output is only as reviewed as the person running it; CI applies are deliberately out of scope for v1.
**Neutral**: the state bucket is the one resource that outlives `terraform destroy`.

## Inline rationale

S3 native locking (Terraform 1.10) removes the DynamoDB lock table that used to be the standard tax on this setup, one less resource and one less exam era anachronism. Local applies fit a solo operator; CI applies would need cloud credentials in GitHub, a bigger security decision than this program warrants.
