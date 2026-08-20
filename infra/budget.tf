# Account-wide spend guard.
#
# This budget predates the terraform config: it was created by hand in the
# console, which is why it is adopted with an import block rather than
# created. Everything else in this directory is managed, and an unmanaged
# budget is exactly the thing that quietly drifts, so it is brought in.
#
# It covers ALL AWS spend, not one service. The narrower Bedrock budget in
# feedback.tf sits underneath it and fires first if model spend is the cause.

variable "account_monthly_budget_usd" {
  description = "Ceiling for total monthly AWS spend across every service."
  type        = string
  default     = "50"
}

# Adopted from the console on 2026-08-20 with:
#   import { to = aws_budgets_budget.account_monthly
#            id = "635474720027:My Monthly Cost Budget" }
# The block is removed now that state holds it; re-add it if state is ever
# rebuilt from scratch, or terraform will try to create a duplicate budget
# and fail on the name already existing.

resource "aws_budgets_budget" "account_monthly" {
  name         = "My Monthly Cost Budget"
  budget_type  = "COST"
  limit_amount = var.account_monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Credits and refunds do not count as spend. Written as the console wrote
  # it, rather than as the equivalent cost_types booleans, so adopting this
  # budget changes nothing about it: an import should take ownership of what
  # exists, not quietly restate it in a different shape on the first apply.
  #
  # Excluding them is the point of the rule: counting a credit as negative
  # spend would let the alert go quiet exactly when a bill was offset rather
  # than avoided.
  # Required alongside filter_expression, and matches what the budget uses.
  metrics = ["UnblendedCost"]

  # The account's default billing view. Stated explicitly because the console
  # set it explicitly, and leaving it out would have terraform clear the
  # field on the first apply.
  billing_view_arn = "arn:aws:billing::635474720027:billingview/primary"


  filter_expression {
    not {
      dimensions {
        key    = "RECORD_TYPE"
        values = ["Credit", "Refund"]
      }
    }
  }

  # 85% of actual spend, so there is room to react before the ceiling.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 85
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.owner_email]
  }

  # Forecast over 100%, which fires early in a month that is trending high.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.owner_email]
  }
}
