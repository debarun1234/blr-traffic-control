# ---- Core -------------------------------------------------------------------------------------------------------
variable "project_id" {
  type        = string
  description = "GCP project id (must exist and have billing enabled; see scripts/bootstrap.sh)."
}

variable "region" {
  type        = string
  default     = "asia-south1"
  description = "Region for Cloud Run, Scheduler, Artifact Registry, GCS and (by default) Firestore. asia-south1 = Mumbai."
}

variable "firestore_location" {
  type        = string
  default     = ""
  description = "Firestore location. Empty = same as region. Cannot be changed after creation."
}

variable "environment" {
  type        = string
  default     = "dev"
  description = "dev | prod. Drives deletion protection and a label; nothing else is environment-magic."

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Extra labels merged onto labelled resources."
}

# ---- Access -----------------------------------------------------------------------------------------------------
variable "bootstrap_admin_emails" {
  type        = list(string)
  description = "Emails treated as admin even without a users/{email} doc (BOOTSTRAP_ADMIN_EMAILS). Keep this list to 1-2 people."

  validation {
    condition     = length(var.bootstrap_admin_emails) > 0
    error_message = "Provide at least one bootstrap admin email, otherwise nobody can sign in."
  }
}

variable "custom_domains" {
  type        = list(string)
  default     = []
  description = "Extra domains to authorise for sign-in (custom Hosting domains). Add the domains in Firebase Hosting separately."
}

variable "dev_authorized_domains" {
  type        = list(string)
  default     = ["localhost"]
  description = "Dev-only authorised domains. Set to [] in prod."
}

variable "oauth_client_id" {
  type        = string
  default     = ""
  description = "Google OAuth Web client id (manual step, see docs/runbook.md). Empty = Google sign-in is not configured by Terraform."
}

variable "oauth_client_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Google OAuth Web client secret. Supply via TF_VAR_oauth_client_secret, never in a committed tfvars file."
}

# ---- Hosting ----------------------------------------------------------------------------------------------------
variable "control_site_id" {
  type        = string
  default     = ""
  description = "Hosting site id for the control app. Empty = <project_id>-control (truncated to 30 chars)."
}

variable "admin_site_id" {
  type        = string
  default     = ""
  description = "Hosting site id for the admin app. Empty = <project_id>-admin (truncated to 30 chars)."
}

# ---- Cloud Run --------------------------------------------------------------------------------------------------
variable "api_image" {
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
  description = "Initial image only; the deploy pipeline owns the image afterwards."
}

variable "worker_image" {
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
  description = "Initial image only; the deploy pipeline owns the image afterwards."
}

variable "api_min_instances" {
  type        = number
  default     = 0
  description = "0 = scale to zero (cheapest, cold starts). 1 removes cold starts at a fixed monthly cost."
}

variable "api_max_instances" {
  type        = number
  default     = 3
  description = "Hard ceiling on API instances; caps the worst-case bill."
}

variable "api_cpu" {
  type    = string
  default = "1"
}

variable "api_memory" {
  type    = string
  default = "512Mi"
}

variable "worker_cpu" {
  type    = string
  default = "1"
}

variable "worker_memory" {
  type    = string
  default = "1Gi"
}

variable "api_allow_unauthenticated" {
  type        = bool
  default     = true
  description = "Needed for Firebase Hosting rewrites. Set false only if you front the API with something that can attach identity tokens."
}

# ---- AI ---------------------------------------------------------------------------------------------------------
variable "vertex_location" {
  type        = string
  default     = "global"
  description = "Vertex AI location for Gemini calls. Verify model availability for your location."
}

variable "ai_model_t1" {
  type        = string
  default     = "gemini-2.5-flash-lite"
  description = "Cheapest tier. Verify the current model id; runtime can override via settings/app.ai.tiers."
}

variable "ai_model_t2" {
  type        = string
  default     = "gemini-2.5-flash"
  description = "Mid tier."
}

variable "ai_model_t3" {
  type        = string
  default     = "gemini-2.5-pro"
  description = "Strongest tier (commissioner brief only)."
}

# ---- Scheduler --------------------------------------------------------------------------------------------------
variable "scheduler_time_zone" {
  type    = string
  default = "Asia/Kolkata"
}

variable "tick_schedules" {
  type = map(object({
    schedule    = string
    description = string
  }))
  default = {
    "tick-day-a" = { schedule = "30-59/10 5 * * *", description = "05:30-05:50 every 10 min" }
    "tick-day-b" = { schedule = "*/10 6-21 * * *", description = "06:00-21:50 every 10 min" }
    "tick-day-c" = { schedule = "0-30/10 22 * * *", description = "22:00-22:30 every 10 min" }
    "tick-night" = { schedule = "0 23,0-5 * * *", description = "hourly 23:00-05:00" }
  }
  description = "Feed tick jobs (cron, evaluated in scheduler_time_zone)."
}

variable "checks_schedule" {
  type    = string
  default = "*/15 * * * *"
}

variable "retention_schedule" {
  type    = string
  default = "30 2 * * *"
}

variable "scheduler_paused" {
  type    = bool
  default = false
}

# ---- Data -------------------------------------------------------------------------------------------------------
variable "firestore_pitr" {
  type        = bool
  default     = false
  description = "Point-in-time recovery (7 days). Recommended for prod."
}

variable "delete_protection" {
  type        = bool
  default     = true
  description = "Firestore + Cloud Run deletion protection. Set false only in throwaway dev projects."
}

variable "bucket_force_destroy" {
  type    = bool
  default = false
}

variable "bucket_retention_days" {
  type    = number
  default = 30
}

# ---- Budget & monitoring ----------------------------------------------------------------------------------------
variable "create_budget" {
  type        = bool
  default     = false
  description = "Create the Billing budget with Terraform. Needs billing-account permission; otherwise create it by hand (docs/runbook.md)."
}

variable "billing_account_id" {
  type    = string
  default = ""
}

variable "budget_amount" {
  type        = number
  default     = 1000
  description = "Monthly budget in budget_currency units."
}

variable "budget_currency" {
  type        = string
  default     = "INR"
  description = "Must match the billing account currency."
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Where alert policies send email. Empty = no notification channel."
}

variable "enable_uptime_check" {
  type    = bool
  default = true
}

variable "uptime_host" {
  type        = string
  default     = ""
  description = "Host for the /readyz uptime check. Empty = control site default domain."
}
