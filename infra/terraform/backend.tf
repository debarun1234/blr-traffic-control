# Remote state in GCS. The bucket is created by scripts/bootstrap.sh; pass it at init time:
#   terraform init -backend-config=envs/dev.backend.hcl
# (bucket + prefix live in the backend config file, not here, so one root serves many environments.)
terraform {
  backend "gcs" {}
}
