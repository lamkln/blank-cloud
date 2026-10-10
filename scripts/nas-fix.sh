#!/usr/bin/env bash
# One-shot NAS repair: checkout fixed blank-cloud sources and rebuild the container.
# Usage: curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/scripts/nas-fix.sh | bash
set -euo pipefail

INSTALL_DIR="${1:-${BLANK_CLOUD_INSTALL_DIR:-$HOME/blank-cloud}}"
REF="${BLANK_CLOUD_REF:-main}"
REPO="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"

echo "blank-cloud NAS fix → ${INSTALL_DIR} @ ${REF}"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "error: ${INSTALL_DIR} missing — clone first:" >&2
  echo "  git clone --depth 1 --branch ${REF} ${REPO} ${INSTALL_DIR}" >&2
  exit 1
fi

export BLANK_CLOUD_INSTALL_DIR="${INSTALL_DIR}"
export BLANK_CLOUD_REF="${REF}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/recover-from-github.sh" ]]; then
  bash "${SCRIPT_DIR}/recover-from-github.sh" "${INSTALL_DIR}"
else
  SHA="$(git ls-remote "${REPO}" "refs/heads/${REF}" | awk '{print $1}')"
  [[ -n "${SHA}" ]] || { echo "error: could not resolve ${REF}" >&2; exit 1; }
  cd "${INSTALL_DIR}"
  git config --global --add safe.directory "$(pwd)" 2>/dev/null || true
  git fetch "${REPO}" "${SHA}"
  git checkout -B "${REF}" "${SHA}"
fi

cd "${INSTALL_DIR}"
echo "Rebuilding image (required — repo sync fix lives in the container) …"
docker compose build --no-cache
docker compose up -d

echo "Waiting for health …"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:8787/health" >/tmp/blank-health.json 2>/dev/null; then
    echo "Health: $(cat /tmp/blank-health.json)"
    if grep -q '"ui":"0.3.' /tmp/blank-health.json 2>/dev/null; then
      echo "Done. Hard-refresh the browser, then pick your GitHub repo again."
      exit 0
    fi
  fi
  sleep 2
done

echo "warning: container up but /health not ready — check: docker compose logs -f" >&2
