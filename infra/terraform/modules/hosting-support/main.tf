# Firebase project enablement, the two Hosting sites and the web app whose public config the front-ends need.
# The sites themselves are deployed with the Firebase CLI (firebase.json); Terraform only creates them.

variable "project_id" {
  type = string
}

variable "control_site_id" {
  type        = string
  description = "Hosting site id for the control-room app (globally unique, 4-30 chars)."
}

variable "admin_site_id" {
  type        = string
  description = "Hosting site id for the admin app (globally unique, 4-30 chars)."
}

variable "web_app_display_name" {
  type    = string
  default = "blr-traffic-control web"
}

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id
}

resource "google_firebase_web_app" "web" {
  provider        = google-beta
  project         = var.project_id
  display_name    = var.web_app_display_name
  deletion_policy = "DELETE"

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_site" "control" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.control_site_id
  # No app_id: a Firebase web app can be linked to only ONE Hosting site (the API rejects a second link with
  # "already linked to hosting site"). Linking is optional for hosting and sign-in, so only the admin site carries it.

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_site" "admin" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.admin_site_id
  app_id   = google_firebase_web_app.web.app_id

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

output "control_site_id" {
  value = google_firebase_hosting_site.control.site_id
}

output "admin_site_id" {
  value = google_firebase_hosting_site.admin.site_id
}

output "control_domain" {
  description = "Default hostname of the control site (<site>.web.app)."
  value       = "${google_firebase_hosting_site.control.site_id}.web.app"
}

output "admin_domain" {
  value = "${google_firebase_hosting_site.admin.site_id}.web.app"
}

output "control_auth_domain" {
  description = "Auth handler domain for the control site (same origin as the app avoids third-party storage problems)."
  value       = "${google_firebase_hosting_site.control.site_id}.firebaseapp.com"
}

output "admin_auth_domain" {
  value = "${google_firebase_hosting_site.admin.site_id}.firebaseapp.com"
}

output "web_app_id" {
  value = google_firebase_web_app.web.app_id
}

output "firebase_config" {
  description = "Public Firebase web config. Not secret; restrict the API key by HTTP referrer in the console."
  value = {
    apiKey            = data.google_firebase_web_app_config.web.api_key
    projectId         = var.project_id
    appId             = google_firebase_web_app.web.app_id
    messagingSenderId = data.google_firebase_web_app_config.web.messaging_sender_id
  }
}
