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
