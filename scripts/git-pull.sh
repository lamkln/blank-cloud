#!/usr/bin/env bash
# Sync install directory to origin/<REF>. Safe on host or in container (/install mount).
set -euo pipefail

INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
REF="${BLANK_CLOUD_REF:-main}"
REPO_URL="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"

cd "$INSTALL_DIR"
RESOLVED="$(pwd)"

if [[ ! -d .git ]]; then
  echo "warning: ${RESOLVED} is not a git checkout — skipping git pull" >&2
  exit 0
fi

git_install() {
  git -c safe.directory="${RESOLVED}" -c protocol.version=2 "$@"
}

git_install config --global --add safe.directory "${RESOLVED}" 2>/dev/null || true

if ! git_install remote get-url origin &>/dev/null; then
  echo "Adding git remote origin …"
  git_install remote add origin "${REPO_URL}"
fi

echo "Fetching origin/${REF} …"
export GIT_TERMINAL_PROMPT=0
if ! git_install fetch --prune origin "refs/heads/${REF}:refs/remotes/origin/${REF}" 2>&1; then
  echo "Fetch with refspec failed — retrying plain fetch …" >&2
  if ! git_install fetch --prune origin "${REF}" 2>&1; then
    echo "" >&2
    echo "error: git fetch failed (network, GitHub, or HTTP 400)." >&2
    echo "Run on the NAS host (not only inside the container):" >&2
    echo "  cd ${RESOLVED}" >&2
    echo "  git fetch origin ${REF}" >&2
    echo "  git checkout -B ${REF} origin/${REF}" >&2
    echo "  bash scripts/update.sh" >&2
    exit 1
  fi
fi

REMOTE_REF="refs/remotes/origin/${REF}"
if ! git_install rev-parse --verify "${REMOTE_REF}" &>/dev/null; then
  echo "error: ${REMOTE_REF} missing after fetch — check remote and branch name (${REF})." >&2
  git_install branch -a >&2 || true
  exit 1
fi

COMMIT="$(git_install rev-parse "${REMOTE_REF}")"
git_install checkout -B "${REF}" "${COMMIT}"
git_install reset --hard "${COMMIT}"

echo "Git at $(git_install rev-parse --short HEAD) (${REF})"
