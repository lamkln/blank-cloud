#!/usr/bin/env bash
# Pull latest blank-cloud and rebuild the Docker stack (run on the host install directory).
set -euo pipefail

INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
REF="${BLANK_CLOUD_REF:-main}"
REPO_URL="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"

cd "$INSTALL_DIR"
RESOLVED_INSTALL="$(pwd)"

if [[ ! -f docker-compose.yml ]]; then
  echo "error: docker-compose.yml not found in ${INSTALL_DIR}" >&2
  exit 1
fi

# Container one-click updates mount the host clone at /install (often owned by a non-root UID).
git_install() {
  git -c safe.directory="${RESOLVED_INSTALL}" "$@"
}

trust_install_for_git() {
  git config --global --add safe.directory "${RESOLVED_INSTALL}" 2>/dev/null || true
}

sync_git_ref() {
  trust_install_for_git

  if ! git_install remote get-url origin &>/dev/null; then
    echo "Adding git remote origin …"
    git_install remote add origin "${REPO_URL}"
  fi

  echo "Fetching ${REF} …"
  if ! git_install fetch --prune origin "refs/heads/${REF}:refs/remotes/origin/${REF}"; then
    echo "error: git fetch failed for origin/${REF}" >&2
    git_install remote -v >&2 || true
    exit 1
  fi

  if ! git_install rev-parse --verify "refs/remotes/origin/${REF}" &>/dev/null; then
    echo "error: origin/${REF} not found after fetch" >&2
    exit 1
  fi

  if git_install show-ref --verify --quiet "refs/heads/${REF}"; then
    git_install checkout "${REF}"
    git_install reset --hard "refs/remotes/origin/${REF}"
  else
    git_install checkout -B "${REF}" "refs/remotes/origin/${REF}"
  fi
}

if [[ -d .git ]]; then
  sync_git_ref
else
  echo "warning: ${INSTALL_DIR} is not a git checkout — skipping git pull" >&2
fi

echo "Building and restarting containers …"
docker compose build
docker compose up -d

echo "blank-cloud updated ($(git_install rev-parse --short HEAD 2>/dev/null || echo unknown))"
