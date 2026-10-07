# Secret Manager conventions
#   blr-oauth-client-id / blr-oauth-client-secret   managed here (values from variables, only if supplied)
#   blr-connector-<id>                              created by scripts/set-secret.sh, NEVER by Terraform or the API
# Runtime service accounts may read ONLY secrets whose name starts with the connector prefix.

variable "project_id" {
  type = string
}

variable "project_number" {
  type        = string
  description = "Needed for the IAM condition (resource.name uses the project number)."
}

variable "connector_prefix" {
  type    = string
  default = "blr-connector-"
}

variable "reader_service_accounts" {
  type        = map(string)
  description = "Map of label => service account email allowed to access connector secrets (e.g. api, worker)."
}

variable "oauth_client_id" {
  type    = string
  default = ""
}

variable "oauth_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "labels" {
  type    = map(string)
  default = {}
}

locals {
  store_oauth = var.oauth_client_id != "" && nonsensitive(var.oauth_client_secret != "")
}

resource "google_secret_manager_secret" "oauth_client_id" {
  count     = local.store_oauth ? 1 : 0
  project   = var.project_id
  secret_id = "blr-oauth-client-id"
  labels    = var.labels
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "oauth_client_id" {
  count       = local.store_oauth ? 1 : 0
  secret      = google_secret_manager_secret.oauth_client_id[0].id
  secret_data = var.oauth_client_id
}

resource "google_secret_manager_secret" "oauth_client_secret" {
  count     = local.store_oauth ? 1 : 0
  project   = var.project_id
  secret_id = "blr-oauth-client-secret"
  labels    = var.labels
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "oauth_client_secret" {
  count       = local.store_oauth ? 1 : 0
  secret      = google_secret_manager_secret.oauth_client_secret[0].id
  secret_data = var.oauth_client_secret
}

# Conditional project-level accessor binding: only blr-connector-* secrets.
resource "google_project_iam_member" "connector_secret_reader" {
  for_each = var.reader_service_accounts

  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${each.value}"

  condition {
    title       = "only-${var.connector_prefix}secrets"
    description = "Limit secret access to connector credentials"
    expression  = "resource.name.startsWith(\"projects/${var.project_number}/secrets/${var.connector_prefix}\")"
  }
}

output "connector_prefix" {
  value = var.connector_prefix
}

output "oauth_secrets_stored" {
  value = local.store_oauth
}
