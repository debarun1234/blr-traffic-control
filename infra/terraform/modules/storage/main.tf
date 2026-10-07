variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "bucket_name" {
  type        = string
  description = "Globally unique bucket name."
}

variable "retention_days" {
  type    = number
  default = 30
}

variable "force_destroy" {
  type    = bool
  default = false
}

variable "writer_service_accounts" {
  type        = map(string)
  default     = {}
  description = "Map of static label => service account email granted roles/storage.objectUser on this bucket only (map keys must be known at plan time)."
}

variable "labels" {
  type    = map(string)
  default = {}
}

resource "google_storage_bucket" "data" {
  project  = var.project_id
  name     = var.bucket_name
  location = var.region
  labels   = var.labels

  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.force_destroy

  versioning {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = var.retention_days
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "writers" {
  for_each = var.writer_service_accounts
  bucket   = google_storage_bucket.data.name
  role     = "roles/storage.objectUser"
  member   = "serviceAccount:${each.value}"
}

output "name" {
  value = google_storage_bucket.data.name
}

output "url" {
  value = google_storage_bucket.data.url
}
