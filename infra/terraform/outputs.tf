output "project_id" {
  value = var.project_id
}

output "project_number" {
  value = data.google_project.this.number
}

output "region" {
  value = var.region
}

output "artifact_repository" {
  description = "Docker repository prefix; images are <prefix>/api:<sha> and <prefix>/worker:<sha>."
  value       = module.registry.repository_url
}

output "api_service" {
  value = module.run.api_name
}

output "worker_service" {
  value = module.run.worker_name
}

output "api_url" {
  value = module.run.api_url
}

output "worker_url" {
  value = module.run.worker_url
}

output "api_service_account" {
  value = module.iam.api_email
}

output "worker_service_account" {
  value = module.iam.worker_email
}

output "invoker_service_account" {
  value = module.iam.invoker_email
}

output "hosting_site_control" {
  value = module.hosting.control_site_id
}

output "hosting_site_admin" {
  value = module.hosting.admin_site_id
}

output "control_url" {
  value = "https://${module.hosting.control_domain}"
}

output "admin_url" {
  value = "https://${module.hosting.admin_domain}"
}

output "auth_domain_control" {
  description = "Add https://<this>/__/auth/handler as an authorised redirect URI on the OAuth client."
  value       = module.hosting.control_auth_domain
}

output "auth_domain_admin" {
  description = "Add https://<this>/__/auth/handler as an authorised redirect URI on the OAuth client."
  value       = module.hosting.admin_auth_domain
}

output "firebase_config" {
  description = "Public Firebase web config consumed by scripts/deploy.sh to write config.js."
  value       = module.hosting.firebase_config
}

output "bucket" {
  value = module.storage.name
}

output "budget_topic" {
  value = module.budget.topic
}

output "scheduler_jobs" {
  value = module.scheduler.job_names
}

output "google_sign_in_configured" {
  description = "false until oauth_client_id/oauth_client_secret are supplied."
  value       = module.identity.google_provider_configured
}

output "maps_browser_key" {
  description = "Public browser key for the Google basemap (empty when unset)."
  value       = var.maps_browser_key
}

output "maps_map_id" {
  value = var.maps_map_id
}
