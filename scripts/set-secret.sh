#!/usr/bin/env bash
# Store a connector credential in Secret Manager as blr-connector-<id>. The value never touches the API or the repo.
# Usage:
#   scripts/set-secret.sh --env dev --id tomtom                 # prompts silently for the value
#   printf '%s' "$KEY" | scripts/set-secret.sh --env dev --id tomtom --stdin
#   scripts/set-secret.sh --env dev --id tomtom --from-file key.txt
# Add --rotate to disable all older versions after adding the new one. Then set the connector's secretRef to
# "blr-connector-<id>" in the admin site. Runtime service accounts can read only secrets with this prefix.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ID=""
MODE="prompt"
FILE=""
ROTATE=0
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID="${2:?}"; shift 2 ;;
    --stdin) MODE="stdin"; shift ;;
    --from-file) MODE="file"; FILE="${2:?}"; shift 2 ;;
    --rotate) ROTATE=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "${ID}" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || die "--id must be lowercase letters, digits and dashes (max 41 chars)"
need gcloud
resolve_env "${ENV_NAME}"
require_gcloud_auth >/dev/null
NAME="blr-connector-${ID}"

TMP="$(mktemp)"
chmod 600 "${TMP}"
trap 'rm -f "${TMP}"' EXIT
case "${MODE}" in
  prompt)
    [[ -t 0 ]] || die "no terminal: use --stdin or --from-file"
    read -r -s -p "Value for ${NAME} (input hidden): " VALUE; echo >&2
    printf '%s' "${VALUE}" > "${TMP}"; unset VALUE ;;
  stdin) cat > "${TMP}" ;;
  file) [[ -r "${FILE}" ]] || die "cannot read ${FILE}"; cat "${FILE}" > "${TMP}" ;;
esac
[[ -s "${TMP}" ]] || die "empty value, nothing stored"

if gcloud secrets describe "${NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  info "Secret ${NAME} exists: adding a new version"
else
  info "Creating secret ${NAME}"
  run gcloud secrets create "${NAME}" --project "${PROJECT_ID}" --replication-policy automatic \
    --labels "app=blr-traffic-control,kind=connector"
fi
if [[ "${DRY_RUN}" == "1" ]]; then
  log "[dry-run] gcloud secrets versions add ${NAME} --data-file=<value>"
  exit 0
fi
NEW="$(gcloud secrets versions add "${NAME}" --project "${PROJECT_ID}" --data-file="${TMP}" --format='value(name)')"
NEW_NUM="${NEW##*/}"
info "Stored version ${NEW_NUM}"

if [[ "${ROTATE}" == "1" ]]; then
  for v in $(gcloud secrets versions list "${NAME}" --project "${PROJECT_ID}" --filter='state=ENABLED' --format='value(name)'); do
    [[ "${v##*/}" == "${NEW_NUM}" ]] && continue
    gcloud secrets versions disable "${v##*/}" --secret "${NAME}" --project "${PROJECT_ID}" --quiet
    log "  disabled version ${v##*/}"
  done
fi
log "Done. In the admin site set the connector secretRef to: ${NAME}"
