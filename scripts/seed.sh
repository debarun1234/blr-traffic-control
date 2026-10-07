#!/usr/bin/env bash
# Seed Firestore with the first admin, default settings and crash statistics, using Application Default Credentials.
# Create-only by default (never overwrites existing docs); --force overwrites.
# Usage: scripts/seed.sh --env dev|prod --admin-email you@example.com [--admin-name "Your Name"] [--ai-enabled] [--force] [--dry-run]
# Needs: gcloud auth application-default login (as a user with roles/datastore.user or better), node 22.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ADMIN_EMAIL=""
EXTRA=()
parse_common "$@"
set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-email) ADMIN_EMAIL="${2:?}"; shift 2 ;;
    --admin-name|--database) EXTRA+=("$1" "${2:?}"); shift 2 ;;
    --ai-enabled|--force) EXTRA+=("$1"); shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "${ADMIN_EMAIL}" ]] || die "--admin-email is required"
need node gcloud
resolve_env "${ENV_NAME}"
[[ "${DRY_RUN}" == "1" ]] && EXTRA+=(--dry-run)
exec node "${REPO_ROOT}/scripts/seed.mjs" --project "${PROJECT_ID}" --admin-email "${ADMIN_EMAIL}" "${EXTRA[@]+"${EXTRA[@]}"}"
