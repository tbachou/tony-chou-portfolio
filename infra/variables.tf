variable "owner_email" {
  description = "Email address that receives operational notifications (SNS/SES deliveries) from this program, e.g. classified feedback emails."
  type        = string
}

variable "bedrock_model_id" {
  description = <<-EOT
    Bedrock model id (cross-region inference profile, `us.` prefixed) used by
    GenAI children of this program. Kept as configuration rather than
    hardcoded in code: confirm the current best id in the Bedrock console
    Model catalog before relying on the default in production.
  EOT
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "bedrock_monthly_budget_usd" {
  description = <<-EOT
    Monthly USD budget for Bedrock spend. Alerts only — AWS has no true hard
    spend cap, so this is a smoke detector, not a sprinkler. The real ceiling
    is the classifier's reserved concurrency plus the api's per-IP rate limits.
  EOT
  type        = string
  default     = "25"
}

variable "classifier_reserved_concurrency" {
  description = <<-EOT
    Max concurrent executions of the feedback classifier, which bounds how many
    Bedrock calls the flow can make at once regardless of publish volume.
    Excess invocations throttle and SNS retries with backoff. Sized well above
    the api's 5/hour-per-IP limit while still capping a distributed burst.
  EOT
  type        = number
  default     = 5
}
