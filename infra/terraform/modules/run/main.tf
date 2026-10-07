# Cloud Run services.
#
# Terraform owns the service *shape* (scaling, SA, env, ingress, IAM). The container image is owned by the deploy
# pipeline (`gcloud run deploy --image ...`), so image, labels and traffic are in ignore_changes: a later
# `terraform apply` never reverts a deploy or a rollback.

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "api_name" {
  type    = string
  default = "blr-api"
}

variable "worker_name" {
  type    = string
  default = "blr-worker"
}

variable "api_image" {
  type        = string
  description = "Initial image only. The deploy pipeline replaces it."
}

variable "worker_image" {
  type        = string
  description = "Initial image only. The deploy pipeline replaces it."
}

variable "api_service_account" {
  type = string
}

variable "worker_service_account" {
  type = string
}

variable "invoker_service_account" {
  type        = string
  description = "SA allowed to invoke the worker (Scheduler + Pub/Sub push)."
}

variable "api_min_instances" {
  type    = number
  default = 0
}

variable "api_max_instances" {
  type    = number
  default = 3
}

variable "api_concurrency" {
  type    = number
  default = 80
}

variable "api_cpu" {
  type    = string
  default = "1"
}

variable "api_memory" {
  type    = string
  default = "512Mi"
}

variable "api_timeout_seconds" {
  type    = number
  default = 60
}

variable "worker_max_instances" {
  type    = number
  default = 1
}

variable "worker_cpu" {
  type    = string
  default = "1"
}

variable "worker_memory" {
  type    = string
  default = "1Gi"
}

variable "worker_timeout_seconds" {
  type    = number
  default = 300
}

variable "api_allow_unauthenticated" {
  type        = bool
  default     = true
  description = "Firebase Hosting rewrites call Cloud Run without an identity token, so the API must be publicly invokable. Every /api route authenticates in-app."
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "common_env" {
  type        = map(string)
  default     = {}
  description = "Non-secret environment shared by both services."
}

variable "api_env" {
  type    = map(string)
  default = {}
}

variable "worker_env" {
  type    = map(string)
  default = {}
}

variable "labels" {
  type    = map(string)
  default = {}
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  location            = var.region
  name                = var.api_name
  description         = "Public API behind Firebase Hosting rewrites (/api/**, /ingest/**)."
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    service_account                  = var.api_service_account
    timeout                          = "${var.api_timeout_seconds}s"
    max_instance_request_concurrency = var.api_concurrency
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    containers {
      image = var.api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.api_cpu
          memory = var.api_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = merge(var.common_env, var.api_env)
        content {
          name  = env.key
          value = env.value
        }
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 20
        tcp_socket {
          port = 8080
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      template[0].revision,
      labels,
      client,
      client_version,
      traffic,
      launch_stage,
    ]
  }
}

resource "google_cloud_run_v2_service" "worker" {
  project             = var.project_id
  location            = var.region
  name                = var.worker_name
  description         = "Private worker: tick, checks, retention, budget kill switch. Invoked by Scheduler / Pub/Sub with OIDC."
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    service_account                  = var.worker_service_account
    timeout                          = "${var.worker_timeout_seconds}s"
    max_instance_request_concurrency = 4
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    scaling {
      min_instance_count = 0
      max_instance_count = var.worker_max_instances
    }

    containers {
      image = var.worker_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.worker_cpu
          memory = var.worker_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = merge(var.common_env, var.worker_env)
        content {
          name  = env.key
          value = env.value
        }
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 20
        tcp_socket {
          port = 8080
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      template[0].revision,
      labels,
      client,
      client_version,
      traffic,
      launch_stage,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count = var.api_allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.invoker_service_account}"
}

output "api_name" {
  value = google_cloud_run_v2_service.api.name
}

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "worker_name" {
  value = google_cloud_run_v2_service.worker.name
}

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}
