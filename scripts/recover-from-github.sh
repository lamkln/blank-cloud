#!/usr/bin/env bash
# Reset blank-cloud install to latest GitHub main without relying on origin/main ref.
# Usage: bash scripts/recover-from-github.sh [install-dir]
set -euo pipefail

INSTALL_DIR="${1:-${BLANK_CLOUD_INSTALL_DIR:-$HOME/blank-cloud}}"
REF="${BLANK_CLOUD_REF:-main}"
REPO="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "error: ${INSTALL_DIR} does not exist" >&2
  exit 1
fi

cd "${INSTALL_DIR}"
git config --global --add safe.directory "$(pwd)" 2>/dev/null || true

SHA="$(git ls-remote "${REPO}" "refs/heads/${REF}" | awk '{print $1}')"
if [[ -z "${SHA}" ]]; then
  echo "error: could not resolve ${REF} on ${REPO} (network/DNS?)" >&2
  exit 1
fi

echo "Resolved ${REF} → ${SHA:0:12}"

if [[ ! -d .git ]]; then
  echo "error: ${INSTALL_DIR} is not a git repo — clone fresh:" >&2
  echo "  git clone --depth 1 --branch ${REF} ${REPO} ${INSTALL_DIR}" >&2
  exit 1
fi

git fetch "${REPO}" "${SHA}"
git checkout -B "${REF}" "${SHA}"
echo "Checkout OK. Run: docker compose up -d --build"
