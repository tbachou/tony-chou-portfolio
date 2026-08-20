# A durable way to identify model spend, independent of what AWS decides to
# call each model.
#
# The problem this exists for: Cost Explorer bills Bedrock model usage through
# AWS Marketplace, under a service name PER MODEL. In this account that is
# "Claude Haiku 4.5 (Amazon Bedrock Edition)", not "Amazon Bedrock". The
# budget in feedback.tf filtered on the latter and read $0.00 against real
# charges until 2026-08-20. Listing model names by hand fixes today and breaks
# again the first time a new model is used, because nobody can predict the
# name before it appears on a bill.
#
# Tags cannot solve it either: Bedrock model spend carries no resource tags,
# so it groups under an empty `project` value even with the cost allocation
# tag active.
#
# What IS stable is the usage type. Every Bedrock model bills token usage as
# "<region>-MP:<region>_InputTokenCount-Units" and the matching output type,
# so matching on "TokenCount" catches any model, in any region, present or
# future. Verified against this account's real usage types before writing.
#
# Cost categories are fussy about which dimensions accept pattern matching:
# SERVICE is rejected outright, and SERVICE_CODE is rejected for CONTAINS.
# USAGE_TYPE is the one dimension that is both queryable and patternable,
# which is what makes this approach possible at all.

resource "aws_ce_cost_category" "model_spend" {
  name         = "ModelSpend"
  rule_version = "CostCategoryExpression.v1"

  rule {
    value = "bedrock-models"

    rule {
      dimension {
        key           = "USAGE_TYPE"
        values        = ["TokenCount"]
        match_options = ["CONTAINS"]
      }
    }
  }

  # Anything that is not model token usage. Named rather than left implicit so
  # a budget filtering on this category cannot silently match everything.
  default_value = "other"
}

# NOT wired into the Bedrock budget yet, deliberately.
#
# A cost category does not apply to existing cost data when it is created;
# AWS backfills it, which takes up to a day. Confirmed at creation: every
# dollar still grouped under an empty ModelSpend value. Pointing the budget
# here before the category populates would make it read $0.00 again, which
# is the exact failure this whole exercise exists to remove.
#
# So feedback.tf keeps its by-name filter, which works today, until this is
# verified. To check whether it has populated:
#
#   aws ce get-cost-and-usage --region us-east-1 \
#     --time-period Start=<month-start>,End=<today> --granularity MONTHLY \
#     --metrics UnblendedCost --group-by Type=COST_CATEGORY,Key=ModelSpend
#
# When a "bedrock-models" group appears carrying the model spend, swap the
# budget's cost_filter to:
#
#   cost_filter {
#     name   = "ModelSpend"
#     values = ["bedrock-models"]
#   }
#
# and confirm the budget still reports non-zero afterwards. Do not swap and
# assume; the whole point is that this class of mistake is silent.
