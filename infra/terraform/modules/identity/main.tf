# Identity Platform with the Google provider only. No email/password, phone or anonymous sign-in, no blocking functions.
# Authorisation is an allowlist enforced by the API (users/{email}); this module only authenticates.
#
# MANUAL STEP (cannot be automated): create the OAuth consent screen and a "Web application" OAuth client, then pass
# its id/secret as oauth_client_id / oauth_client_secret. See docs/runbook.md "First-time setup".

variable "project_id" {
  type = string
}

variable "authorized_domains" {
  type        = list(string)
  description = "Domains allowed to start sign-in (Hosting default domains, custom domains, localhost for dev)."
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

locals {
  configure_google = var.oauth_client_id != "" && nonsensitive(var.oauth_client_secret != "")
}

resource "google_identity_platform_config" "this" {
  project = var.project_id

  autodelete_anonymous_users = true
  authorized_domains         = var.authorized_domains

  sign_in {
    allow_duplicate_emails = false

    anonymous {
      enabled = false
    }
    email {
      enabled           = false
      password_required = true
    }
    phone_number {
      enabled = false
    }
  }
}

resource "google_identity_platform_default_supported_idp_config" "google" {
  count = local.configure_google ? 1 : 0

  project       = var.project_id
  enabled       = true
  idp_id        = "google.com"
  client_id     = var.oauth_client_id
  client_secret = var.oauth_client_secret

  depends_on = [google_identity_platform_config.this]
}

output "google_provider_configured" {
  value = local.configure_google
}
