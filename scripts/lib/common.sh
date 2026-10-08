#!/usr/bin/env bash
# Shared helpers for scripts/*.sh. Source it; do not execute it.
# shellcheck shell=bash disable=SC2034

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"
DEFAULT_REGION="asia-south1"
# Pinned CLI used by deploy scripts and CI. Bump deliberately.
FIREBASE_TOOLS_VERSION="${FIREBASE_TOOLS_VERSION:-15.32.1}"

DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES="${ASSUME_YES:-0}"

if [[ -t 2 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_DIM=""; C_OFF=""
fi

log()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "${C_GRN}" "${C_OFF}" "$*" >&2; }
warn() { printf '%sWARN%s %s\n' "${C_YEL}" "${C_OFF}" "$*" >&2; }
die()  { printf '%sERROR%s %s\n' "${C_RED}" "${C_OFF}" "$*" >&2; exit 1; }

# run CMD...: execute, or only print when DRY_RUN=1.
# retry N SECONDS cmd...: IAM changes are eventually consistent (a just-created service account may not be visible yet).
retry() {
  local n="$1" d="$2" i; shift 2
  [[ "${DRY_RUN:-0}" == "1" ]] && { run "$@"; return 0; }
  for ((i = 1; i <= n; i++)); do
    "$@" && return 0
    [[ "${i}" -lt "${n}" ]] && { warn "attempt ${i}/${n} failed; retrying in ${d}s (IAM propagation)"; sleep "${d}"; }
  done
  return 1
}

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '%s[dry-run]%s %s\n' "${C_DIM}" "${C_OFF}" "$*" >&2
    return 0
  fi
  "$@"
}

need() {
  local missing=0 c
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      warn "missing required tool: ${c}"
      missing=1
    fi
  done
  [[ "${missing}" == "0" ]] || die "install the missing tool(s) and retry"
}

confirm() {
  # confirm "question"  -> returns 0 on yes. --yes / ASSUME_YES=1 auto-confirms (never used by teardown).
  [[ "${ASSUME_YES}" == "1" ]] && return 0
  local ans
  read -r -p "$1 [y/N] " ans || return 1
  [[ "${ans}" == "y" || "${ans}" == "Y" ]]
}

# tf_bin: terraform if present, else OpenTofu.
tf_bin() {
  if [[ -n "${TF_BIN:-}" ]]; then printf '%s' "${TF_BIN}"; return; fi
  if command -v terraform >/dev/null 2>&1; then printf 'terraform'; return; fi
  if command -v tofu >/dev/null 2>&1; then printf 'tofu'; return; fi
  die "neither terraform nor tofu found on PATH"
}

# tfvar_get FILE KEY -> value of a simple `key = "value"` line, or empty.
tfvar_get() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]*)\".*/\1/p" "${file}" | head -n1
}

# resolve_env ENV: sets TFVARS, BACKEND_CFG, PROJECT_ID (if empty), REGION (if empty).
resolve_env() {
  local env="$1"
  [[ "${env}" == "dev" || "${env}" == "prod" ]] || die "--env must be dev or prod (got '${env}')"
  TFVARS="${TF_DIR}/envs/${env}.tfvars"
  BACKEND_CFG="${TF_DIR}/envs/${env}.backend.hcl"
  if [[ -z "${PROJECT_ID:-}" ]]; then PROJECT_ID="$(tfvar_get "${TFVARS}" project_id)"; fi
  if [[ -z "${REGION:-}" ]]; then REGION="$(tfvar_get "${TFVARS}" region)"; fi
  REGION="${REGION:-${DEFAULT_REGION}}"
  [[ -n "${PROJECT_ID:-}" ]] || die "project id unknown: pass --project or create ${TFVARS} (copy envs/${env}.tfvars.example)"
}

# Print the active gcloud account, or die.
require_gcloud_auth() {
  local acct
  acct="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)"
  [[ -n "${acct}" ]] || die "no active gcloud account: run 'gcloud auth login' (and 'gcloud auth application-default login' for seed/doctor)"
  printf '%s' "${acct}"
}

# Parse the flags shared by all scripts out of an array; leaves the rest in REST_ARGS.
# Usage: parse_common "$@"
ENV_NAME="${ENV_NAME:-dev}"
REST_ARGS=()
parse_common() {
  REST_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env) ENV_NAME="${2:?--env needs a value}"; shift 2 ;;
      --project) PROJECT_ID="${2:?--project needs a value}"; shift 2 ;;
      --region) REGION="${2:?--region needs a value}"; shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      *) REST_ARGS+=("$1"); shift ;;
    esac
  done
}
