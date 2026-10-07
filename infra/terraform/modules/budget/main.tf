# Budget kill-switch plumbing:
#   Billing budget --(Pub/Sub)--> topic blr-budget --(OIDC push)--> worker /internal/budget
# The topic and the push subscription are always created. The Billing budget itself is optional because it needs
# billing-account permissions (roles/billing.costsManager) that a project-level deployer usually lacks.
# Manual alternative: Console > Billing > Budgets & alerts > Create budget > "Connect a Pub/Sub topic" > blr-budget.

variable "project_id" {
  type = string
}

variable "project_number" {
  type = string
}

variable "worker_url" {
  type = string
}

variable "invoker_service_account" {
  type = string
}

variable "create_budget" {
  type    = bool
  default = false
}

variable "billing_account_id" {
  type        = string
  default     = ""
  description = "Billing account id (XXXXXX-XXXXXX-XXXXXX). Required when create_budget = true."
}

variable "amount" {
  type        = number
  default     = 1000
  description = "Monthly budget in currency_code units. The worker disables paid features at 100% of this."
}

variable "currency_code" {
  type        = string
  default     = "INR"
  description = "Must equal the billing account currency."
}

variable "thresholds" {
  type    = list(number)
  default = [0.5, 0.8, 1.0]
}

variable "notification_channel_ids" {
  type    = list(string)
  default = []
}

resource "google_pubsub_topic" "budget" {
  project = var.project_id
  name    = "blr-budget"
}

resource "google_pubsub_subscription" "budget_push" {
  project = var.project_id
  name    = "blr-budget-push"
  topic   = google_pubsub_topic.budget.id

  ack_deadline_seconds       = 30
  message_retention_duration = "86400s"

  expiration_policy {
    ttl = ""
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }

  push_config {
    push_endpoint = "${var.worker_url}/internal/budget"
    oidc_token {
      service_account_email = var.invoker_service_account
      audience              = var.worker_url
    }
  }
}

resource "google_billing_budget" "this" {
  count = var.create_budget ? 1 : 0

  billing_account = var.billing_account_id
  display_name    = "blr-traffic-control (${var.project_id})"

  budget_filter {
    projects = ["projects/${var.project_number}"]
  }

  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(floor(var.amount))
    }
  }

  dynamic "threshold_rules" {
    for_each = var.thresholds
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    pubsub_topic                     = google_pubsub_topic.budget.id
    schema_version                   = "1.0"
    monitoring_notification_channels = var.notification_channel_ids
    disable_default_iam_recipients   = false
  }

  lifecycle {
    precondition {
      condition     = var.billing_account_id != ""
      error_message = "billing_account_id is required when create_budget = true."
    }
  }
}

output "topic" {
  value = google_pubsub_topic.budget.id
}

output "subscription" {
  value = google_pubsub_subscription.budget_push.id
}
