# --- Bedrock access for the api (spec 0005 provider-swap) ----------------
#
# Grants the Render api's IAM user (portfolio-api) permission to invoke
# Claude on Bedrock when AI_PROVIDER=bedrock. Only the interview simulator
# moves onto this path; Beta stays on the direct Anthropic API by design
# (AC-P3), so this credential never touches the clinical surface.
#
# Two actions, not one — this is the difference from the classifier Lambda's
# policy in feedback.tf, which needs only InvokeModel because it makes a
# single non-streaming Converse call:
#   - InvokeModel                   <- messages.create (forceToolCall)
#   - InvokeModelWithResponseStream <- messages.stream (every chat turn)
# Granting only the first fails every streaming turn with AccessDenied.
#
# The foundation-model ARN's region wildcard is deliberate and matches the
# Lambda's policy: a `us.` Geo inference profile requires the caller to hold
# the permission in the source region AND every destination region
# (us-east-1, us-east-2, us-west-2).

resource "aws_iam_policy" "api_bedrock_invoke" {
  name        = "portfolio-api-bedrock-invoke"
  description = "Invoke Claude on Bedrock from the Render api (AI_PROVIDER=bedrock)."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeBedrockModel"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:us-east-2:${data.aws_caller_identity.current.account_id}:inference-profile/*",
        ]
      }
    ]
  })
}

# The api's IAM user is created by hand in the console (no access keys in
# Terraform state, by design), so Terraform reads it rather than owning it.
# Unlike aws_iam_policy.feedback_publish — which was written before the user
# existed and is therefore left unattached for a manual console step — the
# user exists now, so the attachment is recorded in code instead of being a
# checklist item that can be forgotten.
data "aws_iam_user" "api" {
  user_name = "portfolio-api"
}

resource "aws_iam_user_policy_attachment" "api_bedrock_invoke" {
  user       = data.aws_iam_user.api.user_name
  policy_arn = aws_iam_policy.api_bedrock_invoke.arn
}
