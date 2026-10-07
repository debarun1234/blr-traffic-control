#!/usr/bin/env bash
# Post-deploy smoke test. Hits /readyz and /healthz through the public URL(s) and checks key response headers.
# Usage: scripts/smoke.sh URL [URL...] [--retries 8] [--delay 5]
# Exit 0 = healthy. /readyz must return {"ok":true}. /healthz failing is a warning only: Google's front end has been
# seen to intercept that exact path on some Cloud Run setups; /readyz is the authoritative check.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

RETRIES=8
DELAY=5
URLS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --retries) RETRIES="${2:?}"; shift 2 ;;
    --delay) DELAY="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    http*) URLS+=("${1%/}"); shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ ${#URLS[@]} -gt 0 ]] || die "give at least one base URL"
need curl

fail=0
for base in "${URLS[@]}"; do
  info "smoke ${base}"
  ok=0
  for ((i = 1; i <= RETRIES; i++)); do
    body="$(curl -fsS --max-time 15 "${base}/readyz" 2>/dev/null || true)"
    if [[ "${body}" == *'"ok":true'* || "${body}" == *'"ok": true'* ]]; then ok=1; break; fi
    log "  readyz attempt ${i}/${RETRIES} not ready${body:+: ${body:0:120}}"
    sleep "${DELAY}"
  done
  if [[ "${ok}" == "1" ]]; then log "  PASS /readyz"; else log "  FAIL /readyz"; fail=1; fi

  if curl -fsS --max-time 15 "${base}/healthz" 2>/dev/null | grep -q '"ok"'; then
    log "  PASS /healthz"
  else
    warn "  /healthz did not return {ok:true} (non-fatal; see runbook 'healthz is intercepted')"
  fi

  # Static-site headers only exist on Hosting URLs; skip when the URL is a run.app address.
  if [[ "${base}" != *.run.app ]]; then
    hdrs="$(curl -fsSI --max-time 15 "${base}/" 2>/dev/null | tr -d '\r' | tr '[:upper:]' '[:lower:]' || true)"
    for h in content-security-policy strict-transport-security x-content-type-options; do
      if grep -q "^${h}:" <<<"${hdrs}"; then
        log "  PASS header ${h}"
      elif [[ "${base}" == https://* ]]; then
        log "  FAIL missing header ${h} on ${base}/ (firebase.json headers not deployed?)"; fail=1
      else
        warn "  missing header ${h} on ${base}/ (expected only on Hosting URLs)"
      fi
    done
  fi
done
[[ "${fail}" == "0" ]] || die "smoke test failed"
info "smoke test passed"
