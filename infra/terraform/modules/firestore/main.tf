variable "project_id" {
  type = string
}

variable "location_id" {
  type        = string
  description = "Firestore location (asia-south1 = Mumbai)."
}

variable "delete_protection" {
  type    = bool
  default = true
}

variable "point_in_time_recovery" {
  type        = bool
  default     = false
  description = "7-day PITR. Adds storage cost; recommended for prod."
}

variable "ttl_collections" {
  type        = list(string)
  description = "Collections whose documents carry an `expireAt` timestamp; Firestore deletes them after it passes."
  default     = ["state_hist", "connector_runs", "probe_obs", "ai_cache", "counters", "checks", "ratelimit"]
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.location_id
  type        = "FIRESTORE_NATIVE"

  concurrency_mode                  = "OPTIMISTIC"
  point_in_time_recovery_enablement = var.point_in_time_recovery ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = var.delete_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  deletion_policy                   = var.delete_protection ? "ABANDON" : "DELETE"
}

# TTL on expireAt. Built-in single-field indexes are intentionally kept: the worker's /internal/retention sweep queries
# `expireAt < now` as a fallback for TTL lag, and that query needs the index.
resource "google_firestore_field" "ttl" {
  for_each = toset(var.ttl_collections)

  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = each.value
  field      = "expireAt"

  ttl_config {}
}

output "database" {
  value = google_firestore_database.default.name
}

output "location_id" {
  value = google_firestore_database.default.location_id
}
