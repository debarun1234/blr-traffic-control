#!/usr/bin/env bash
# One-time (idempotent) bootstrap of a GCP project so Terraform and GitHub Actions can run.
#   - enables the minimum APIs Terraform itself needs
#   - creates the Terraform state bucket (versioned, private)
#   - creates the deployer service account and a Workload Identity Federation pool/provider for GitHub (no JSON keys)
#   - writes infra/terraform/envs/<env>.backend.hcl and prints next steps
#
# Usage: scripts/bootstrap.sh --env dev|prod [--project ID] [--region asia-south1] [--github-repo owner/name] [--dry-run]
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

GITHUB_REPO="${GITHUB_REPO:-}"
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --github-repo) GITHUB_REPO="${2:?--github-repo needs owner/name}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

need gcloud
resolve_env "${ENV_NAME}"
ACCOUNT="$(require_gcloud_auth)"
info "account=${ACCOUNT} project=${PROJECT_ID} region=${REGION} env=${ENV_NAME} dry-run=${DRY_RUN}"

if [[ -z "${GITHUB_REPO}" ]]; then
  warn "no --github-repo given: skipping Workload Identity Federation (CI deploys will not work until you re-run with it)"
fi

gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1 || die "project ${PROJECT_ID} not found or no access"
BILLING="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
[[ "${BILLING}" == "True" ]] || die "billing is not enabled on ${PROJECT_ID}. Link a billing account first: gcloud billing projects link ${PROJECT_ID} --billing-account=XXXXXX-XXXXXX-XXXXXX"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

# 1. Minimum APIs for Terraform + WIF. Terraform enables the rest (modules/apis).
info "Enabling bootstrap APIs"
run gcloud services enable \
  serviceusage.googleapis.com cloudresourcemanager.googleapis.com cloudbilling.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com storage.googleapis.com \
  --project "${PROJECT_ID}"

# 2. State bucket.
STATE_BUCKET="${PROJECT_ID}-tfstate"
if gcloud storage buckets describe "gs://${STATE_BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  info "State bucket gs://${STATE_BUCKET} exists"
else
  info "Creating state bucket gs://${STATE_BUCKET}"
  run gcloud storage buckets create "gs://${STATE_BUCKET}" --project "${PROJECT_ID}" --location "${REGION}" \
    --uniform-bucket-level-access --public-access-prevention
fi
run gcloud storage buckets update "gs://${STATE_BUCKET}" --project "${PROJECT_ID}" --versioning

# 3. Deployer service account (used by GitHub Actions via WIF and, optionally, by humans via impersonation).
DEPLOYER_ID="blr-deployer"
DEPLOYER="${DEPLOYER_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "${DEPLOYER}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  info "Deployer SA ${DEPLOYER} exists"
else
  info "Creating deployer SA ${DEPLOYER}"
  run gcloud iam service-accounts create "${DEPLOYER_ID}" --project "${PROJECT_ID}" --display-name "blr deployer (CI)"
fi

# Broad on purpose: Terraform manages IAM, APIs, Cloud Run, Firebase, Identity Platform, Scheduler, Pub/Sub, secrets.
# projectIamAdmin makes this SA effectively an admin; protect it with the WIF repo condition and GitHub environment
# approvals (see docs/security.md "Deployer identity").
DEPLOYER_ROLES=(
  roles/run.admin
  roles/iam.serviceAccountAdmin
  roles/iam.serviceAccountUser
  roles/resourcemanager.projectIamAdmin
  roles/serviceusage.serviceUsageAdmin
  roles/serviceusage.apiKeysViewer
  roles/firebase.admin
  roles/firebasehosting.admin
  roles/datastore.owner
  roles/secretmanager.admin
  roles/storage.admin
  roles/artifactregistry.admin
  roles/cloudscheduler.admin
  roles/pubsub.admin
  roles/monitoring.admin
  roles/logging.admin
  roles/identityplatform.admin
)
info "Granting deployer roles (idempotent)"
for role in "${DEPLOYER_ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${DEPLOYER}" --role "${role}" --condition=None --quiet >/dev/null
done

# 4. Workload Identity Federation for GitHub Actions.
WIF_PROVIDER=""
if [[ -n "${GITHUB_REPO}" ]]; then
  [[ "${GITHUB_REPO}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "--github-repo must look like owner/name"
  POOL="github"
  PROVIDER="github-oidc"
  if gcloud iam workload-identity-pools describe "${POOL}" --location global --project "${PROJECT_ID}" >/dev/null 2>&1; then
    info "WIF pool ${POOL} exists"
  else
    info "Creating WIF pool ${POOL}"
    run gcloud iam workload-identity-pools create "${POOL}" --location global --project "${PROJECT_ID}" \
      --display-name "GitHub Actions"
  fi
  if gcloud iam workload-identity-pools providers describe "${PROVIDER}" --workload-identity-pool "${POOL}" \
      --location global --project "${PROJECT_ID}" >/dev/null 2>&1; then
    info "WIF provider ${PROVIDER} exists"
    run gcloud iam workload-identity-pools providers update-oidc "${PROVIDER}" --workload-identity-pool "${POOL}" \
      --location global --project "${PROJECT_ID}" \
      --attribute-condition "assertion.repository == '${GITHUB_REPO}'" >/dev/null
  else
    info "Creating WIF provider ${PROVIDER} (only ${GITHUB_REPO} may use it)"
    run gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" --workload-identity-pool "${POOL}" \
      --location global --project "${PROJECT_ID}" \
      --issuer-uri "https://token.actions.githubusercontent.com" \
      --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" \
      --attribute-condition "assertion.repository == '${GITHUB_REPO}'"
  fi
  run gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER}" --project "${PROJECT_ID}" \
    --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null
  WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
fi

# 5. Backend config for Terraform.
if [[ -f "${BACKEND_CFG}" ]]; then
  info "${BACKEND_CFG} exists (left untouched)"
elif [[ "${DRY_RUN}" == "1" ]]; then
  info "[dry-run] would write ${BACKEND_CFG}"
else
  printf 'bucket = "%s"\nprefix = "blr-traffic-control/%s"\n' "${STATE_BUCKET}" "${ENV_NAME}" > "${BACKEND_CFG}"
  info "Wrote ${BACKEND_CFG}"
fi

cat >&2 <<NEXT

Bootstrap complete for ${PROJECT_ID} (${ENV_NAME}).

Next steps
  1. cp infra/terraform/envs/${ENV_NAME}.tfvars.example infra/terraform/envs/${ENV_NAME}.tfvars   # edit project_id, admin email
  2. Create the OAuth consent screen + Web OAuth client (manual, once): docs/runbook.md "First-time setup".
     export TF_VAR_oauth_client_secret='<secret>'   # never commit it
  3. scripts/deploy.sh --env ${ENV_NAME}
  4. scripts/seed.sh --env ${ENV_NAME} --admin-email you@example.com
  5. scripts/doctor.sh --env ${ENV_NAME}

GitHub repository settings (Settings > Secrets and variables > Actions > Variables), for the '${ENV_NAME}' environment:
  GCP_PROJECT_ID          = ${PROJECT_ID}
  GCP_REGION              = ${REGION}
  TF_STATE_BUCKET         = ${STATE_BUCKET}
  WIF_PROVIDER            = ${WIF_PROVIDER:-<re-run with --github-repo owner/name>}
  WIF_SERVICE_ACCOUNT     = ${DEPLOYER}
  (secrets) TF_VAR_OAUTH_CLIENT_SECRET = the OAuth client secret
NEXT
