#!/usr/bin/env bash
# Local full deploy: terraform apply -> docker build/push -> Cloud Run revisions -> config.js -> Firebase Hosting -> smoke.
# Usage: scripts/deploy.sh --env dev|prod [--project ID] [--region R] [--tag TAG]
#                          [--skip-terraform] [--skip-build] [--skip-hosting] [--dry-run] [--yes]
# Prereqs: gcloud (logged in), docker, node 22, terraform or tofu, and scripts/bootstrap.sh already run.
# The first run deploys placeholder images via Terraform, then replaces them with yours.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TAG=""
SKIP_TF=0
SKIP_BUILD=0
SKIP_HOSTING=0
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --skip-terraform) SKIP_TF=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-hosting) SKIP_HOSTING=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

need gcloud node npm
[[ "${SKIP_BUILD}" == "1" ]] || need docker
resolve_env "${ENV_NAME}"
TF="$(tf_bin)"
[[ -f "${TFVARS}" ]] || die "missing ${TFVARS} (copy envs/${ENV_NAME}.tfvars.example)"
[[ -f "${BACKEND_CFG}" ]] || die "missing ${BACKEND_CFG} (run scripts/bootstrap.sh --env ${ENV_NAME})"
require_gcloud_auth >/dev/null
cd "${REPO_ROOT}"

if [[ -z "${TAG}" ]]; then
  if git rev-parse --short=12 HEAD >/dev/null 2>&1; then
    TAG="$(git rev-parse --short=12 HEAD)"
    [[ -z "$(git status --porcelain 2>/dev/null)" ]] || TAG="${TAG}-dirty-$(date +%s)"
  else
    TAG="local-$(date +%Y%m%d%H%M%S)"
  fi
fi
info "env=${ENV_NAME} project=${PROJECT_ID} region=${REGION} tag=${TAG} dry-run=${DRY_RUN}"

if [[ "${ENV_NAME}" == "prod" && "${DRY_RUN}" != "1" ]]; then
  confirm "Deploy to PRODUCTION (${PROJECT_ID})?" || die "aborted"
fi

# 0. Repo hygiene gates.
info "Lint + tests"
run node scripts/lint.mjs
if [[ "${DRY_RUN}" != "1" ]]; then npm test --silent; else log "[dry-run] npm test"; fi

# 1. Terraform.
OUT_JSON="$(mktemp)"
trap 'rm -f "${OUT_JSON}" "${REPO_ROOT}/firebase.deploy.json"' EXIT
if [[ "${SKIP_TF}" == "0" ]]; then
  info "Terraform apply"
  run "${TF}" -chdir="${TF_DIR}" init -input=false -backend-config="${BACKEND_CFG}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    run "${TF}" -chdir="${TF_DIR}" plan -input=false -var-file="${TFVARS}"
  else
    APPLY_FLAGS=(-input=false "-var-file=${TFVARS}")
    [[ "${ASSUME_YES}" == "1" ]] && APPLY_FLAGS+=(-auto-approve)
    "${TF}" -chdir="${TF_DIR}" apply "${APPLY_FLAGS[@]}"
  fi
fi
if [[ "${DRY_RUN}" == "1" ]]; then
  info "[dry-run] stopping before build/push/deploy (nothing below this point changes anything)"
  run docker build -f apps/api/Dockerfile -t "<registry>/api:${TAG}" .
  run docker build -f apps/worker/Dockerfile -t "<registry>/worker:${TAG}" .
  run gcloud run services update blr-api --image "<registry>/api:${TAG}"
  run gcloud run services update blr-worker --image "<registry>/worker:${TAG}"
  run node scripts/render-deploy-config.mjs --outputs "<terraform output -json>"
  run npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION}" deploy --only hosting:control,hosting:admin,firestore:rules,firestore:indexes
  run scripts/smoke.sh "<control url>"
  exit 0
fi
"${TF}" -chdir="${TF_DIR}" output -json > "${OUT_JSON}"
tfo() { node "${REPO_ROOT}/scripts/tf-output.mjs" "${OUT_JSON}" "v=$1" | cut -d= -f2-; }
REPO="$(tfo artifact_repository)"; API_SVC="$(tfo api_service)"; WORKER_SVC="$(tfo worker_service)"
CONTROL_URL="$(tfo control_url)"; ADMIN_URL="$(tfo admin_url)"
[[ -n "${REPO}" && -n "${API_SVC}" && -n "${WORKER_SVC}" ]] || die "terraform outputs incomplete; run without --skip-terraform"

# 2. Build + push images (repo root is the Docker context for both).
if [[ "${SKIP_BUILD}" == "0" ]]; then
  for app in api worker; do
    [[ -f "apps/${app}/Dockerfile" ]] || die "apps/${app}/Dockerfile not found"
  done
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null
  for app in api worker; do
    info "Build + push ${app}"
    docker build -f "apps/${app}/Dockerfile" -t "${REPO}/${app}:${TAG}" .
    docker push "${REPO}/${app}:${TAG}"
  done
fi

# 3. Cloud Run revisions. Remember the previous revision so a failed smoke test can roll back.
PREV_API="$(gcloud run services describe "${API_SVC}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.traffic[0].revisionName)' 2>/dev/null || true)"
PREV_WORKER="$(gcloud run services describe "${WORKER_SVC}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.traffic[0].revisionName)' 2>/dev/null || true)"
rollback() {
  warn "Smoke test failed: rolling back"
  [[ -z "${PREV_API}" ]] || gcloud run services update-traffic "${API_SVC}" --project "${PROJECT_ID}" --region "${REGION}" --to-revisions "${PREV_API}=100" || true
  [[ -z "${PREV_WORKER}" ]] || gcloud run services update-traffic "${WORKER_SVC}" --project "${PROJECT_ID}" --region "${REGION}" --to-revisions "${PREV_WORKER}=100" || true
}
if [[ "${SKIP_BUILD}" == "0" ]]; then
  info "Deploy Cloud Run revisions"
  gcloud run services update "${WORKER_SVC}" --project "${PROJECT_ID}" --region "${REGION}" --image "${REPO}/worker:${TAG}" --update-labels "commit-sha=${TAG//[^a-z0-9-]/-}" --quiet
  gcloud run services update "${API_SVC}" --project "${PROJECT_ID}" --region "${REGION}" --image "${REPO}/api:${TAG}" --update-labels "commit-sha=${TAG//[^a-z0-9-]/-}" --quiet
fi

# 4. Static sites.
if [[ "${SKIP_HOSTING}" == "0" ]]; then
  info "Build web + render config"
  npm run build:web --silent
  node scripts/render-deploy-config.mjs --outputs "${OUT_JSON}"
  node scripts/lint.mjs --dist
  info "Firebase deploy (hosting + firestore rules/indexes)"
  npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION}" deploy --project "${PROJECT_ID}" --config firebase.deploy.json \
    --only hosting:control,hosting:admin,firestore:rules,firestore:indexes --non-interactive
fi

# 5. Smoke test; roll back Cloud Run on failure.
if ! "${REPO_ROOT}/scripts/smoke.sh" "${CONTROL_URL}" "${ADMIN_URL}"; then
  rollback
  die "deploy failed smoke test and was rolled back (static sites are not rolled back; redeploy the previous tag)"
fi
info "Done. control=${CONTROL_URL} admin=${ADMIN_URL}"
log "Next (first deploy only): scripts/seed.sh --env ${ENV_NAME} --admin-email you@example.com"
