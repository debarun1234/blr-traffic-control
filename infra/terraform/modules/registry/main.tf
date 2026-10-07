variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "repository_id" {
  type    = string
  default = "blr"
}

variable "keep_count" {
  type        = number
  default     = 10
  description = "Most recent image versions always kept (rollback headroom)."
}

variable "labels" {
  type    = map(string)
  default = {}
}

resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "blr-traffic-control container images (api, worker)"
  labels        = var.labels

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.keep_count
    }
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "2592000s"
    }
  }
}

output "repository_id" {
  value = google_artifact_registry_repository.docker.repository_id
}

output "repository_url" {
  description = "Docker repository prefix, e.g. asia-south1-docker.pkg.dev/PROJECT/blr"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}
