variable "project_id" {
  type = string
}

variable "name_prefix" {
  type    = string
  default = "blr"
}

variable "api_roles" {
  type = list(string)
  default = [
    "roles/datastore.user",   # Firestore read/write via Admin SDK
    "roles/aiplatform.user",  # Gemini on Vertex AI (no API key)
    "roles/logging.logWriter" # structured logs
  ]
  description = "Project-level roles for the API runtime service account. Secret access and bucket access are granted narrowly elsewhere."
}

variable "worker_roles" {
  type = list(string)
  default = [
    "roles/datastore.user",
    "roles/logging.logWriter"
  ]
  description = "Project-level roles for the worker runtime service account."
}

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-api"
  display_name = "blr-api runtime"
  description  = "Cloud Run runtime identity for the public API. No keys are ever created for it."
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-worker"
  display_name = "blr-worker runtime"
  description  = "Cloud Run runtime identity for the private worker."
}

resource "google_service_account" "invoker" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-invoker"
  display_name = "blr scheduler/pubsub invoker"
  description  = "Identity used by Cloud Scheduler and Pub/Sub push to call the worker with OIDC. Holds run.invoker on the worker only."
}

resource "google_project_iam_member" "api" {
  for_each = toset(var.api_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker" {
  for_each = toset(var.worker_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.worker.email}"
}

# The Pub/Sub service agent must be able to mint OIDC tokens as the invoker SA for authenticated push.
resource "google_project_service_identity" "pubsub" {
  provider = google-beta
  project  = var.project_id
  service  = "pubsub.googleapis.com"
}

resource "google_service_account_iam_member" "pubsub_token_creator" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub.email}"
}

output "api_email" {
  value = google_service_account.api.email
}

output "worker_email" {
  value = google_service_account.worker.email
}

output "invoker_email" {
  value = google_service_account.invoker.email
}
