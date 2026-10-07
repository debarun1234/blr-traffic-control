# Log-based metrics + alert policies + uptime check.
# The app emits structured JSON logs with an `event` field (contract in docs/architecture.md, "Log events"):
#   tick_failed, feed_stale, ai_kill, budget_kill

variable "project_id" {
  type = string
}

variable "api_service_name" {
  type    = string
  default = "blr-api"
}

variable "worker_service_name" {
  type    = string
  default = "blr-worker"
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Email for alerts. Empty = policies are created without a notification channel (visible in the console only)."
}

variable "uptime_host" {
  type        = string
  description = "Hostname that serves /readyz through Firebase Hosting (site default domain or custom domain)."
}

variable "enable_uptime_check" {
  type    = bool
  default = true
}

variable "api_5xx_threshold" {
  type        = number
  default     = 5
  description = "5xx responses per 5-minute window before alerting."
}

variable "runbook_url" {
  type    = string
  default = "docs/runbook.md"
}

locals {
  run_filter_api    = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.api_service_name}\""
  run_filter_worker = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.worker_service_name}\""

  # A structured log line counts as event X when jsonPayload.event or jsonPayload.msg equals X.
  ev_tick_failed = "(jsonPayload.event=\"tick_failed\" OR jsonPayload.msg=\"tick_failed\")"
  ev_feed_stale  = "(jsonPayload.event=\"feed_stale\" OR jsonPayload.msg=\"feed_stale\")"
  ev_ai_kill     = "(jsonPayload.event=(\"ai_kill\" OR \"budget_kill\") OR jsonPayload.msg=(\"ai_kill\" OR \"budget_kill\"))"

  metrics = {
    blr_api_5xx = {
      description = "API responses with HTTP status >= 500"
      filter      = "${local.run_filter_api} AND httpRequest.status>=500"
    }
    blr_tick_failed = {
      description = "Worker tick failures"
      filter      = "${local.run_filter_worker} AND ${local.ev_tick_failed}"
    }
    blr_feed_stale = {
      description = "Feed marked stale (no successful tick within staleAfterMin)"
      filter      = "${local.run_filter_worker} AND ${local.ev_feed_stale}"
    }
    blr_ai_kill = {
      description = "AI kill switch or budget kill triggered"
      filter      = "resource.type=\"cloud_run_revision\" AND ${local.ev_ai_kill}"
    }
  }

  alerts = {
    blr_api_5xx = {
      name      = "BLR API 5xx burst"
      threshold = var.api_5xx_threshold
      what      = "The API returned more than ${var.api_5xx_threshold} 5xx responses in 5 minutes. Check Cloud Run logs for blr-api; see runbook 'API errors'."
    }
    blr_tick_failed = {
      name      = "BLR tick failure"
      threshold = 0
      what      = "The feed tick failed. State may go stale. See runbook 'Stale feed'."
    }
    blr_feed_stale = {
      name      = "BLR feed stale"
      threshold = 0
      what      = "The state feed is stale; the UI shows a stale banner. See runbook 'Stale feed'."
    }
    blr_ai_kill = {
      name      = "BLR AI kill / budget kill"
      threshold = 0
      what      = "AI or paid connectors were switched off (manual kill or budget threshold). See runbook 'Budget kill'."
    }
  }
}

resource "google_logging_metric" "this" {
  for_each = local.metrics

  project     = var.project_id
  name        = each.key
  description = each.value.description
  filter      = each.value.filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_notification_channel" "email" {
  count = var.alert_email != "" ? 1 : 0

  project      = var.project_id
  display_name = "blr alerts (email)"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.name]
}

resource "google_monitoring_alert_policy" "log_metric" {
  for_each = local.alerts

  project      = var.project_id
  display_name = each.value.name
  combiner     = "OR"

  conditions {
    display_name = each.value.name
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${each.key}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.channels

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "${each.value.what}\n\nRunbook: ${var.runbook_url}"
  }

  depends_on = [google_logging_metric.this]
}

resource "google_monitoring_uptime_check_config" "readyz" {
  count = var.enable_uptime_check ? 1 : 0

  project      = var.project_id
  display_name = "blr readyz"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path           = "/readyz"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.uptime_host
    }
  }

  content_matchers {
    content = "\"ok\":true"
    matcher = "CONTAINS_STRING"
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count = var.enable_uptime_check ? 1 : 0

  project      = var.project_id
  display_name = "BLR /readyz down"
  combiner     = "OR"

  conditions {
    display_name = "readyz failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.readyz[0].uptime_check_id}\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.channels

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "/readyz failed from at least two probe locations for 5 minutes. Store unreachable or deploy broken. Runbook: ${var.runbook_url}"
  }
}

output "notification_channel_ids" {
  description = "Channel resource names, reusable by the budget."
  value       = local.channels
}

output "metric_names" {
  value = sort(keys(google_logging_metric.this))
}
