#!/usr/bin/env bash
# Route 100% of a Cloud Run service's traffic to a previous revision.
# Usage: scripts/rollback.sh --env dev|prod --service blr-api [--to REVISION] [--project ID] [--region R] [--dry-run]
# Without --to, picks the newest ready revision that is NOT the one currently serving.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SERVICE=""
TO=""
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --service) SERVICE="${2:?}"; shift 2 ;;
    --to) TO="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "${SERVICE}" ]] || die "--service is required (blr-api or blr-worker)"
need gcloud
resolve_env "${ENV_NAME}"

if [[ -z "${TO}" ]]; then
  CURRENT="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
    --format='value(status.traffic[0].revisionName)')"
  TO="$(gcloud run revisions list --service "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
    --format='value(metadata.name)' --sort-by='~metadata.creationTimestamp' --limit 10 \
    | grep -vx "${CURRENT}" | head -n1 || true)"
  [[ -n "${TO}" ]] || die "no previous revision found (current: ${CURRENT})"
  info "current=${CURRENT} -> rolling back to ${TO}"
fi
run gcloud run services update-traffic "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --to-revisions "${TO}=100"
info "${SERVICE} now serves ${TO}. Terraform ignores traffic, so a later apply will not undo this."
