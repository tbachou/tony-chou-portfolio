# Foundation child leaves this empty; later children add their own outputs
# here rather than creating a second outputs file.
#
# 0005-classifier-flow adds the topic ARNs and the SES identity ARN below.

output "feedback_topic_arn" {
  description = "ARN of the SNS topic feedback submissions are published to. Set as the api's SNS_FEEDBACK_TOPIC_ARN Render env var (0005-feedback-intake)."
  value       = aws_sns_topic.feedback.arn
}

output "ops_topic_arn" {
  description = "ARN of the SNS ops topic. The classifier Lambda's error alarm notifies it; nothing else publishes here in v1."
  value       = aws_sns_topic.ops.arn
}

output "feedback_classifier_function_name" {
  description = "Name of the feedback classifier Lambda function, for console lookups and manual test invokes."
  value       = aws_lambda_function.feedback_classifier.function_name
}

output "ses_owner_identity_arn" {
  description = "ARN of the SES v2 email identity (owner_email) the classifier Lambda sends from and to. Must be verified manually (see README) before SES will deliver — SES stays in sandbox mode by design."
  value       = aws_sesv2_email_identity.owner.arn
}
