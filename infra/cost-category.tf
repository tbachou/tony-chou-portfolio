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
# That second failure was then measured, not just predicted. On 2026-08-21,
# with the by-name list still in place, the budget read $0.003 while real
# model spend for the month was $0.0289: five model line items had billed
# (Sonnet 4.6, Sonnet 4.5, Haiku 4.5, Opus 4.6, Opus 4.5) and the hand-written
# list matched exactly one of them. "Amazon Bedrock" matched nothing at all —
# no such service name exists in this account.
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
# Cost categories are fussy about which dimensions accept pattern matching.
# SERVICE is rejected outright — the API names the allowed set as USAGE_TYPE,
# RECORD_TYPE, LINKED_ACCOUNT_NAME, SERVICE_CODE, LINKED_ACCOUNT,
# BILLING_ENTITY, REGION — and SERVICE_CODE is rejected for CONTAINS.
# USAGE_TYPE is the one dimension that is both queryable and patternable,
# which is what makes this approach possible at all.

resource "aws_ce_cost_category" "model_spend" {
  name         = "ModelSpend"
  rule_version = "CostCategoryExpression.v1"

  rule {
    value = "bedrock-models"
    # AWS defaults this to REGULAR and returns it, so state it or terraform
    # plans a no-op change forever.
    type = "REGULAR"

    rule {
      dimension {
        key = "USAGE_TYPE"
        # Additive on purpose: each value only ever widens what matches, so
        # broadening this list cannot silently drop spend the budget was
        # already seeing.
        #
        #   TokenCount — every model's token billing (the only one of the
        #                three matching anything in this account today)
        #   TextUnit   — Bedrock Guardrails, which bills per text unit rather
        #                than per token, so token matching alone would miss it
        #   Bedrock    — anything Bedrock names in its own usage type, e.g.
        #                provisioned throughput model units
        #
        # The last two are here ahead of the spend they describe. Guardrails
        # is the next item on the AWS track, and the failure this whole file
        # exists to prevent is silent: better the pattern is already in place
        # than discovered missing after a month of unbudgeted charges.
        values        = ["TokenCount", "TextUnit", "Bedrock"]
        match_options = ["CONTAINS"]
      }
    }
  }

  # Anything that is not model token usage. Named rather than left implicit so
  # a budget filtering on this category cannot silently match everything.
  default_value = "other"
}

# WIRED into the Bedrock budget on 2026-08-21, after the backfill was verified.
#
# A cost category does not apply to existing cost data when it is created;
# AWS backfills it, which takes up to a day. That is why this was deliberately
# left unwired at creation on 2026-08-20 — pointing the budget at an empty
# category would have reproduced the exact $0.00 failure it exists to remove.
#
# The check that unblocked the swap, re-runnable any time:
#
#   aws ce get-cost-and-usage --region us-east-1 \
#     --time-period Start=<month-start>,End=<today> --granularity MONTHLY \
#     --metrics UnblendedCost --group-by Type=COST_CATEGORY,Key=ModelSpend
#
# It returned ProcessingStatus APPLIED and a "bedrock-models" group carrying
# $0.0289 against the by-name budget's $0.003. The budget was then repointed
# (see feedback.tf) and confirmed to report $0.029 afterwards — non-zero, and
# matching the category total to the cent.
#
# Do not swap this kind of filter and assume; the whole point is that this
# class of mistake is silent. Confirm a non-zero reading every time.
