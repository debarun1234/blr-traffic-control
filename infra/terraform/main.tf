data "google_project" "this" {
  project_id = var.project_id
}

locals {
  labels = merge({
    app         = "blr-traffic-control"
    environment = var.environment
    managed-by  = "terraform"
  }, var.labels)

  firestore_location = var.firestore_location != "" ? var.firestore_location : var.region
  control_site_id    = var.control_site_id != "" ? var.control_site_id : "${substr(var.project_id, 0, 21)}-control"
  admin_site_id      = var.admin_site_id != "" ? var.admin_site_id : "${substr(var.project_id, 0, 23)}-admin"
  bucket_name        = "${var.project_id}-blr-data"

  authorized_domains = distinct(concat(
    [
      module.hosting.control_domain,
      module.hosting.admin_domain,
      module.hosting.control_auth_domain,
      module.hosting.admin_auth_domain,
    ],
    var.custom_domains,
    var.environment == "prod" ? [] : var.dev_authorized_domains,
  ))

  # Runtime configuration contract (documented in docs/architecture.md). Non-secret only.
  common_env = {
    NODE_ENV             = "production"
    GOOGLE_CLOUD_PROJECT = var.project_id
    GCP_PROJECT          = var.project_id
    GCP_REGION           = var.region
    INTERNAL_INVOKER_SA  = module.iam.invoker_email
    EXPORT_BUCKET        = module.storage.name
    SECRET_PREFIX        = module.secrets.connector_prefix
    VERTEX_LOCATION      = var.vertex_location
    AI_MODEL_T1          = var.ai_model_t1
    AI_MODEL_T2          = var.ai_model_t2
    AI_MODEL_T3          = var.ai_model_t3
  }
  api_env = {
    BOOTSTRAP_ADMIN_EMAILS = join(",", var.bootstrap_admin_emails)
  }
}

module "apis" {
  source = "./modules/apis"

  project_id              = var.project_id
  include_billing_budgets = var.create_budget
}

module "registry" {
  source = "./modules/registry"

  project_id = var.project_id
  region     = var.region
  labels     = local.labels

  depends_on = [module.apis]
}

module "iam" {
  source = "./modules/iam"

  project_id = var.project_id

  depends_on = [module.apis]
}

module "storage" {
  source = "./modules/storage"

  project_id     = var.project_id
  region         = var.region
  bucket_name    = local.bucket_name
  retention_days = var.bucket_retention_days
  force_destroy  = var.bucket_force_destroy
  writer_service_accounts = {
    api    = module.iam.api_email
    worker = module.iam.worker_email
  }
  labels = local.labels

  depends_on = [module.apis]
}

module "firestore" {
  source = "./modules/firestore"

  project_id             = var.project_id
  location_id            = local.firestore_location
  delete_protection      = var.delete_protection
  point_in_time_recovery = var.firestore_pitr

  depends_on = [module.apis]
}

module "hosting" {
  source = "./modules/hosting-support"

  project_id      = var.project_id
  control_site_id = local.control_site_id
  admin_site_id   = local.admin_site_id

  depends_on = [module.apis]
}

module "secrets" {
  source = "./modules/secrets"

  project_id     = var.project_id
  project_number = data.google_project.this.number
  reader_service_accounts = {
    api    = module.iam.api_email
    worker = module.iam.worker_email
  }
  oauth_client_id     = var.oauth_client_id
  oauth_client_secret = var.oauth_client_secret
  labels              = local.labels

  depends_on = [module.apis]
}

module "identity" {
  source = "./modules/identity"

  project_id          = var.project_id
  authorized_domains  = local.authorized_domains
  oauth_client_id     = var.oauth_client_id
  oauth_client_secret = var.oauth_client_secret

  depends_on = [module.apis, module.hosting]
}

module "run" {
  source = "./modules/run"

  project_id = var.project_id
  region     = var.region

  api_image    = var.api_image
  worker_image = var.worker_image

  api_service_account     = module.iam.api_email
  worker_service_account  = module.iam.worker_email
  invoker_service_account = module.iam.invoker_email

  api_min_instances         = var.api_min_instances
  api_max_instances         = var.api_max_instances
  api_cpu                   = var.api_cpu
  api_memory                = var.api_memory
  worker_cpu                = var.worker_cpu
  worker_memory             = var.worker_memory
  api_allow_unauthenticated = var.api_allow_unauthenticated
  deletion_protection       = var.delete_protection

  common_env = local.common_env
  api_env    = local.api_env
  labels     = local.labels

  depends_on = [module.apis, module.firestore, module.registry]
}

module "scheduler" {
  source = "./modules/scheduler"

  project_id              = var.project_id
  region                  = var.region
  worker_url              = module.run.worker_url
  invoker_service_account = module.iam.invoker_email
  time_zone               = var.scheduler_time_zone
  tick_schedules          = var.tick_schedules
  checks_schedule         = var.checks_schedule
  retention_schedule      = var.retention_schedule
  paused                  = var.scheduler_paused

  depends_on = [module.apis]
}

module "monitoring" {
  source = "./modules/monitoring"

  project_id          = var.project_id
  api_service_name    = module.run.api_name
  worker_service_name = module.run.worker_name
  alert_email         = var.alert_email
  uptime_host         = var.uptime_host != "" ? var.uptime_host : module.hosting.control_domain
  enable_uptime_check = var.enable_uptime_check

  depends_on = [module.apis]
}

module "budget" {
  source = "./modules/budget"

  project_id               = var.project_id
  project_number           = data.google_project.this.number
  worker_url               = module.run.worker_url
  invoker_service_account  = module.iam.invoker_email
  create_budget            = var.create_budget
  billing_account_id       = var.billing_account_id
  amount                   = var.budget_amount
  currency_code            = var.budget_currency
  notification_channel_ids = module.monitoring.notification_channel_ids

  depends_on = [module.apis]
}
