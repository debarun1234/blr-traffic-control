#!/usr/bin/env bash
# Destroy an environment's Terraform-managed resources. Destructive and irreversible for Firestore data.
# Usage: scripts/teardown.sh --env dev|prod [--project ID] [--region R] [--purge-bootstrap] [--dry-run]
#   --purge-bootstrap  also delete the state bucket, deployer SA and WIF pool (do this last, only for throwaway projects)
# You must type the project id to proceed (and, for prod, the word DELETE-PROD). --yes does NOT skip these prompts.
# Not removed: the GCP project itself, Firebase Hosting site ids (reserved ~30 days), Identity Platform config.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

PURGE=0
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-bootstrap) PURGE=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
need gcloud
resolve_env "${ENV_NAME}"
TF="$(tf_bin)"
[[ -f "${TFVARS}" ]] || die "missing ${TFVARS}"
require_gcloud_auth >/dev/null

warn "This will DESTROY ${ENV_NAME} (${PROJECT_ID}): Cloud Run, Firestore data, secrets, bucket contents, scheduler, monitoring."
read -r -p "Type the project id (${PROJECT_ID}) to continue: " A1
[[ "${A1}" == "${PROJECT_ID}" ]] || die "confirmation did not match; nothing done"
if [[ "${ENV_NAME}" == "prod" ]]; then
  read -r -p "This is PRODUCTION. Type DELETE-PROD to continue: " A2
  [[ "${A2}" == "DELETE-PROD" ]] || die "confirmation did not match; nothing done"
fi
info "Export first? Firestore: gcloud firestore export gs://${PROJECT_ID}-blr-data/final-export-\$(date +%Y%m%d) --project ${PROJECT_ID}"
if [[ "${DRY_RUN}" != "1" ]]; then read -r -p "Press Enter once you have exported anything you need (Ctrl-C to abort)... " _; fi

# Deletion protection and non-empty buckets block destroy; relax them in state first.
RELAX=(-var-file="${TFVARS}" -var delete_protection=false -var bucket_force_destroy=true -input=false)
run "${TF}" -chdir="${TF_DIR}" init -input=false -backend-config="${BACKEND_CFG}"
run "${TF}" -chdir="${TF_DIR}" apply -auto-approve "${RELAX[@]}"
run "${TF}" -chdir="${TF_DIR}" destroy -auto-approve "${RELAX[@]}"

if [[ "${PURGE}" == "1" ]]; then
  info "Purging bootstrap resources"
  run gcloud iam workload-identity-pools delete github --location global --project "${PROJECT_ID}" --quiet || true
  run gcloud iam service-accounts delete "blr-deployer@${PROJECT_ID}.iam.gserviceaccount.com" --project "${PROJECT_ID}" --quiet || true
  run gcloud storage rm -r "gs://${PROJECT_ID}-tfstate" --project "${PROJECT_ID}" || true
fi
info "Teardown finished${DRY_RUN:+ (dry-run: nothing was changed)}."
