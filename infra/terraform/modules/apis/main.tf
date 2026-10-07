variable "project_id" {
  type        = string
  description = "GCP project id."
}

variable "include_billing_budgets" {
  type        = bool
  default     = false
  description = "Also enable the Billing Budgets API (only needed when the budget resource is managed here)."
}

locals {
  base_apis = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "pubsub.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "aiplatform.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "apikeys.googleapis.com",
    "cloudbilling.googleapis.com",
  ]
  apis = toset(concat(local.base_apis, var.include_billing_budgets ? ["billingbudgets.googleapis.com"] : []))
}

resource "google_project_service" "this" {
  for_each = local.apis

  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

output "enabled" {
  description = "Enabled API names."
  value       = sort([for s in google_project_service.this : s.service])
}
