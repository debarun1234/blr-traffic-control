# Cloud Scheduler -> worker (OIDC). Cron has no "from 05:30" syntax, so the day window is split into several jobs.

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "worker_url" {
  type        = string
  description = "Worker service URL; also the OIDC audience."
}

variable "invoker_service_account" {
  type = string
}

variable "time_zone" {
  type    = string
  default = "Asia/Kolkata"
}

variable "tick_schedules" {
  type = map(object({
    schedule    = string
    description = string
  }))
  description = "Feed tick jobs. Default: every 5 min at the 07-11 and 16-21 peaks, every 10 min for the rest of 05:30-22:30 IST, hourly otherwise."
  default = {
    "tick-day-a"   = { schedule = "30-59/10 5 * * *", description = "05:30-05:50 every 10 min" }
    "tick-day-b"   = { schedule = "*/10 6,11-15,21 * * *", description = "06:00-06:50, 11:00-15:50 and 21:00-21:50 every 10 min" }
    "tick-peak-am" = { schedule = "*/5 7-10 * * *", description = "07:00-10:55 every 5 min (morning peak)" }
    "tick-peak-pm" = { schedule = "*/5 16-20 * * *", description = "16:00-20:55 every 5 min (evening peak)" }
    "tick-day-c"   = { schedule = "0-30/10 22 * * *", description = "22:00-22:30 every 10 min" }
    "tick-night"   = { schedule = "0 23,0-5 * * *", description = "hourly 23:00-05:00" }
  }
}

variable "checks_schedule" {
  type    = string
  default = "*/15 * * * *"
}

variable "retention_schedule" {
  type    = string
  default = "30 2 * * *"
}

variable "paused" {
  type        = bool
  default     = false
  description = "Create jobs paused (useful for a fresh env before the first deploy)."
}

locals {
  jobs = merge(
    { for k, v in var.tick_schedules : k => {
      schedule = v.schedule, description = v.description, path = "/internal/tick", retries = 0
    } },
    {
      "checks"    = { schedule = var.checks_schedule, description = "system checks", path = "/internal/checks", retries = 1 }
      "retention" = { schedule = var.retention_schedule, description = "retention sweep", path = "/internal/retention", retries = 1 }
    }
  )
}

resource "google_cloud_scheduler_job" "this" {
  for_each = local.jobs

  project          = var.project_id
  region           = var.region
  name             = "blr-${each.key}"
  description      = each.value.description
  schedule         = each.value.schedule
  time_zone        = var.time_zone
  attempt_deadline = "330s"
  paused           = var.paused

  retry_config {
    retry_count          = each.value.retries
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_retry_duration   = "120s"
  }

  http_target {
    http_method = "POST"
    uri         = "${var.worker_url}${each.value.path}"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode("{}")

    oidc_token {
      service_account_email = var.invoker_service_account
      audience              = var.worker_url
    }
  }
}

output "job_names" {
  value = sort([for j in google_cloud_scheduler_job.this : j.name])
}
