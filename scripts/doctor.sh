#!/usr/bin/env bash
# Read-only health check of an environment: auth, project, billing, APIs, state, services, scheduler, budget, admins.
# Usage: scripts/doctor.sh --env dev|prod [--project ID] [--region R] [--url https://control-site]
# Exit code 1 if any FAIL. WARN means "look at this", not "broken".
set -uo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

URL=""
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

NPASS=0; NWARN=0; NFAIL=0
pass() { NPASS=$((NPASS + 1)); printf '  %sPASS%s %s\n' "${C_GRN}" "${C_OFF}" "$*"; }
wrn()  { NWARN=$((NWARN + 1)); printf '  %sWARN%s %s\n' "${C_YEL}" "${C_OFF}" "$*"; }
bad()  { NFAIL=$((NFAIL + 1)); printf '  %sFAIL%s %s\n' "${C_RED}" "${C_OFF}" "$*"; }
section() { printf '\n%s\n' "$*"; }

command -v gcloud >/dev/null 2>&1 || die "gcloud not installed"
resolve_env "${ENV_NAME}"

section "Tools"
for t in gcloud node npm docker curl; do
  if command -v "${t}" >/dev/null 2>&1; then pass "${t}"; else wrn "${t} not found"; fi
done
if command -v terraform >/dev/null 2>&1 || command -v tofu >/dev/null 2>&1; then pass "terraform/tofu"; else wrn "terraform/tofu not found"; fi

section "Auth"
ACCT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)"
if [[ -n "${ACCT}" ]]; then pass "gcloud account ${ACCT}"; else bad "no active gcloud account (gcloud auth login)"; fi
if gcloud auth application-default print-access-token >/dev/null 2>&1; then pass "Application Default Credentials present"; else wrn "no ADC (needed for seed/admin listing): gcloud auth application-default login"; fi

section "Project ${PROJECT_ID} (${ENV_NAME}, ${REGION})"
if gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then pass "project reachable"; else bad "project not found or no access"; fi
BILLING_ACCT="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingAccountName)' 2>/dev/null | sed 's#billingAccounts/##')"
if [[ -n "${BILLING_ACCT}" ]]; then pass "billing enabled (account ${BILLING_ACCT})"; else bad "billing not enabled / not visible"; fi

section "APIs"
ENABLED="$(gcloud services list --enabled --project "${PROJECT_ID}" --format='value(config.name)' 2>/dev/null)"
for api in run firestore artifactregistry secretmanager cloudscheduler pubsub identitytoolkit firebasehosting monitoring logging aiplatform; do
  if grep -qx "${api}.googleapis.com" <<<"${ENABLED}"; then pass "${api}"; else bad "${api}.googleapis.com not enabled (terraform apply enables it)"; fi
done

section "Terraform state"
PREFIX="$(sed -n -E 's/^[[:space:]]*prefix[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "${BACKEND_CFG}" 2>/dev/null | head -n1)"
BUCKET="$(sed -n -E 's/^[[:space:]]*bucket[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "${BACKEND_CFG}" 2>/dev/null | head -n1)"
if [[ -z "${BUCKET}" ]]; then wrn "no ${BACKEND_CFG} (run scripts/bootstrap.sh)"
elif gcloud storage ls "gs://${BUCKET}/${PREFIX}/default.tfstate" >/dev/null 2>&1; then pass "state object gs://${BUCKET}/${PREFIX}/default.tfstate"
else wrn "state bucket/object not found at gs://${BUCKET}/${PREFIX} (not applied yet?)"; fi

section "Firestore"
if gcloud firestore databases describe --database='(default)' --project "${PROJECT_ID}" >/dev/null 2>&1; then pass "(default) database exists"; else bad "Firestore database missing"; fi

section "Cloud Run"
API_URL=""
for svc in blr-api blr-worker; do
  J="$(gcloud run services describe "${svc}" --project "${PROJECT_ID}" --region "${REGION}" --format=json 2>/dev/null || true)"
  if [[ -z "${J}" ]]; then bad "${svc} not found in ${REGION}"; continue; fi
  READY="$(node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const c=(s.status.conditions||[]).find(x=>x.type==="Ready");const a=s.spec.template.metadata.annotations||{};console.log([c&&c.status,s.metadata.annotations["run.googleapis.com/ingress"],a["autoscaling.knative.dev/minScale"]||"0",a["autoscaling.knative.dev/maxScale"]||"-",s.status.url].join(" "))' <<<"${J}")"
  read -r ready ingress minscale maxscale url <<<"${READY}"
  if [[ "${ready}" == "True" ]]; then pass "${svc} Ready (min ${minscale}, max ${maxscale})"; else bad "${svc} not Ready"; fi
  [[ "${svc}" == "blr-api" ]] && API_URL="${url}"
  POL="$(gcloud run services get-iam-policy "${svc}" --project "${PROJECT_ID}" --region "${REGION}" --format=json 2>/dev/null || true)"
  PUBLIC=0; grep -q '"allUsers"' <<<"${POL}" && PUBLIC=1
  if [[ "${svc}" == "blr-worker" ]]; then
    if [[ "${ingress}" == "internal" ]]; then pass "worker ingress internal"; else bad "worker ingress is '${ingress}', expected internal"; fi
    if [[ "${PUBLIC}" == "0" ]]; then pass "worker not publicly invokable"; else bad "worker grants allUsers invoker"; fi
  else
    if [[ "${PUBLIC}" == "1" ]]; then pass "api invokable by Hosting (allUsers; in-app auth)"; else wrn "api is not public: Hosting rewrites will 403"; fi
  fi
done

section "Scheduler"
JOBS="$(gcloud scheduler jobs list --location "${REGION}" --project "${PROJECT_ID}" --format='value(name.basename(),state,schedule)' 2>/dev/null || true)"
if [[ -z "${JOBS}" ]]; then bad "no scheduler jobs"; else
  while read -r name state sched; do
    [[ -n "${name}" ]] || continue
    if [[ "${state}" == "ENABLED" ]]; then pass "${name} ENABLED (${sched})"; else wrn "${name} ${state}"; fi
  done <<<"${JOBS}"
fi

section "Budget kill switch"
if gcloud pubsub topics describe blr-budget --project "${PROJECT_ID}" >/dev/null 2>&1; then pass "topic blr-budget"; else bad "topic blr-budget missing"; fi
if gcloud pubsub subscriptions describe blr-budget-push --project "${PROJECT_ID}" >/dev/null 2>&1; then pass "subscription blr-budget-push"; else bad "subscription blr-budget-push missing"; fi
if [[ -n "${BILLING_ACCT}" ]]; then
  if BUD="$(gcloud billing budgets list --billing-account "${BILLING_ACCT}" --format='value(displayName)' 2>&1)"; then
    if grep -qi "${PROJECT_ID}" <<<"${BUD}"; then pass "budget for ${PROJECT_ID} found"; else wrn "no budget mentioning ${PROJECT_ID}: create one (docs/runbook.md 'Budget')"; fi
  else
    wrn "cannot list budgets (needs billing permission): verify in Console > Billing > Budgets"
  fi
fi

section "Secrets"
NS="$(gcloud secrets list --project "${PROJECT_ID}" --filter='name~blr-connector-' --format='value(name.basename())' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${NS}" -gt 0 ]]; then pass "${NS} connector secret(s)"; else wrn "no blr-connector-* secrets yet (fine for sim-only)"; fi

section "Health"
for u in "${API_URL}" "${URL:-https://${PROJECT_ID:0:21}-control.web.app}"; do
  [[ -n "${u}" ]] || continue
  if curl -fsS --max-time 15 "${u%/}/readyz" 2>/dev/null | grep -q '"ok":true'; then pass "${u}/readyz"; else wrn "${u}/readyz not ok (not deployed yet, or wrong URL: pass --url)"; fi
done
ERRS="$(gcloud logging read 'severity>=ERROR AND resource.type="cloud_run_revision"' --project "${PROJECT_ID}" --freshness 1h --limit 20 --format='value(timestamp)' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${ERRS}" == "0" ]]; then pass "no ERROR logs in the last hour"; else wrn "${ERRS} ERROR log entries in the last hour"; fi

section "Admins"
if command -v node >/dev/null 2>&1; then
  if ADM="$(node "${REPO_ROOT}/scripts/admins.mjs" --project "${PROJECT_ID}" 2>&1)"; then
    if [[ "${ADM}" == "(none)" ]]; then wrn "no admin user docs (BOOTSTRAP_ADMIN_EMAILS still works; run scripts/seed.sh)"; else pass "admins: ${ADM}"; fi
  else wrn "could not list admins: ${ADM}"; fi
fi

printf '\n%d passed, %d warnings, %d failed\n' "${NPASS}" "${NWARN}" "${NFAIL}"
[[ "${NFAIL}" == "0" ]]
