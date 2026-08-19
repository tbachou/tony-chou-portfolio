# 0005-classifier-flow: SNS -> Lambda -> Bedrock -> SES.
#
# Two-rung history, both kept live per the child spec's Decision ("removed
# when rung 2 lands, or kept during transition"): rung 1 is a raw email
# subscription that proves the topic/publish path with zero code; rung 2 is
# the classifier Lambda. Both subscriptions exist on the same topic so a
# Lambda regression still leaves the owner a raw-email fallback.
#
# See docs/specs/_root/0005-aws-genai-integration/0005-classifier-flow.md
# for the full decision record and acceptance criteria (AC-C1..AC-C5).

data "aws_caller_identity" "current" {}

# --- Feedback topic -----------------------------------------------------

resource "aws_sns_topic" "feedback" {
  name = "portfolio-feedback-topic"
}

# Rung 1: raw email subscription, proves the plumbing with no code.
resource "aws_sns_topic_subscription" "feedback_email_rung1" {
  topic_arn = aws_sns_topic.feedback.arn
  protocol  = "email"
  endpoint  = var.owner_email
}

# Rung 2: Lambda subscription, the classifier.
resource "aws_sns_topic_subscription" "feedback_lambda" {
  topic_arn = aws_sns_topic.feedback.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.feedback_classifier.arn
}

resource "aws_lambda_permission" "feedback_sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.feedback_classifier.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.feedback.arn
}

# --- Api publisher policy (AC-C5: sns:Publish scoped to this one topic) -
#
# Policy only — no principal attachment. Per the umbrella's cross-child
# contract, Tony creates the api's publisher IAM user himself in the console
# and attaches this managed policy to it by name; Terraform never manages
# principals or their keys.

resource "aws_iam_policy" "feedback_publish" {
  name        = "portfolio-feedback-publish"
  description = "Allows publishing to the portfolio feedback SNS topic only (attached by hand to the api's publisher user)."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishToFeedbackTopic"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.feedback.arn
      }
    ]
  })
}

# --- Classifier Lambda ----------------------------------------------------
#
# Packaging is a manual two-step workflow (see README.md): `npm run build`
# in infra/lambda/feedback-classifier (esbuild bundles to dist/lambda.zip),
# then `terraform apply` reads that zip via filename + source_code_hash.
# No local-exec / external data sources, so applies stay reproducible.

locals {
  feedback_classifier_zip = "${path.module}/lambda/feedback-classifier/dist/lambda.zip"
}

resource "aws_iam_role" "feedback_classifier_exec" {
  name = "portfolio-feedback-classifier-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

# CloudWatch Logs basic execution (create log group + stream, put log events).
resource "aws_iam_role_policy_attachment" "feedback_classifier_logs" {
  role       = aws_iam_role.feedback_classifier_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# bedrock:InvokeModel, scoped per the verified gotcha in the child spec:
# us-east-2 requires the inference-profile resource in addition to the
# foundation-model resource. The foundation-model ARN's region wildcard is
# deliberate: AWS requires the caller to hold this permission in the source
# region AND every destination region of the Geo profile (us-east-1,
# us-east-2, us-west-2); the wildcard covers exactly that.
resource "aws_iam_role_policy" "feedback_classifier_bedrock" {
  name = "portfolio-feedback-classifier-bedrock"
  role = aws_iam_role.feedback_classifier_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeBedrockModel"
        Effect = "Allow"
        Action = "bedrock:InvokeModel"
        Resource = [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:us-east-2:${data.aws_caller_identity.current.account_id}:inference-profile/*",
        ]
      }
    ]
  })
}

# ses:SendEmail scoped to the one verified identity this Lambda sends from
# (and to — the owner is both sender and sole recipient).
resource "aws_iam_role_policy" "feedback_classifier_ses" {
  name = "portfolio-feedback-classifier-ses"
  role = aws_iam_role.feedback_classifier_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SendFromVerifiedIdentity"
        Effect   = "Allow"
        Action   = "ses:SendEmail"
        Resource = aws_sesv2_email_identity.owner.arn
      }
    ]
  })
}

resource "aws_lambda_function" "feedback_classifier" {
  function_name = "portfolio-feedback-classifier"
  role          = aws_iam_role.feedback_classifier_exec.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"

  filename         = local.feedback_classifier_zip
  source_code_hash = filebase64sha256(local.feedback_classifier_zip)

  timeout     = 30
  memory_size = 256

  environment {
    variables = {
      BEDROCK_MODEL_ID = var.bedrock_model_id
      OWNER_EMAIL      = var.owner_email
    }
  }
}

# --- SES identity -----------------------------------------------------
#
# SESv2 identity for the owner's address. Sandbox mode is sufficient since
# the only recipient is the owner (also the sender). Verification itself is
# a manual step (see README) — Terraform only declares the identity resource
# and starts the AWS-side verification email, it cannot click the link.

resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.owner_email
}

# --- Ops topic + alarm --------------------------------------------------
#
# Separate from the feedback topic on purpose (per the child spec's inline
# rationale): a broken feedback topic must not be able to silence its own
# failure notifications.

resource "aws_sns_topic" "ops" {
  name = "portfolio-ops-topic"
}

resource "aws_sns_topic_subscription" "ops_email" {
  topic_arn = aws_sns_topic.ops.arn
  protocol  = "email"
  endpoint  = var.owner_email
}

# AC-C3: if SES delivery fails, the Lambda invocation errors visibly, and
# this alarm on the function's Errors metric notifies the owner through the
# ops topic (separate from the feedback topic itself).
resource "aws_cloudwatch_metric_alarm" "feedback_classifier_errors" {
  alarm_name          = "portfolio-feedback-classifier-errors"
  alarm_description   = "Feedback classifier Lambda invocation errored (see AC-C3) — likely an SES delivery failure since classification failure never throws (AC-C2)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.feedback_classifier.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ops.arn]
  ok_actions          = [aws_sns_topic.ops.arn]
}
