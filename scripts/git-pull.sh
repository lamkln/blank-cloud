#!/usr/bin/env bash
# Sync install directory to origin/<REF>. Safe on host or in container (/install mount).
set -euo pipefail

INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
REF="${BLANK_CLOUD_REF:-main}"
REPO_URL="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"
TARGET_COMMIT="${BLANK_CLOUD_TARGET_COMMIT:-}"

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

resolve_sha_from_remote() {
  local sha=""
  sha="$(git ls-remote "${REPO_URL}" "refs/heads/${REF}" 2>/dev/null | awk '{print $1}')"
  if [[ -z "${sha}" ]]; then
    echo "error: could not resolve ${REF} via git ls-remote (${REPO_URL})" >&2
    return 1
  fi
  echo "${sha}"
}

fetch_origin_ref() {
  echo "Fetching origin/${REF} …"
  export GIT_TERMINAL_PROMPT=0
  if git_install fetch --prune origin "refs/heads/${REF}:refs/remotes/origin/${REF}" 2>&1; then
    return 0
  fi
  echo "Fetch with refspec failed — retrying plain fetch …" >&2
  git_install fetch --prune origin "${REF}" 2>&1
}

fetch_commit_object() {
  local sha="$1"
  echo "Fetching commit ${sha:0:12} …"
  export GIT_TERMINAL_PROMPT=0
  if git_install fetch --prune origin "${sha}" 2>&1; then
    return 0
  fi
  echo "origin fetch failed — fetching from ${REPO_URL} …" >&2
  git_install fetch --prune "${REPO_URL}" "${sha}" 2>&1
}

COMMIT="${TARGET_COMMIT}"
if [[ -z "${COMMIT}" ]]; then
  if fetch_origin_ref; then
    REMOTE_REF="refs/remotes/origin/${REF}"
    if git_install rev-parse --verify "${REMOTE_REF}" &>/dev/null; then
      COMMIT="$(git_install rev-parse "${REMOTE_REF}")"
    fi
  else
    echo "warning: git fetch origin failed — using git ls-remote fallback" >&2
  fi
fi

if [[ -z "${COMMIT}" ]]; then
  COMMIT="$(resolve_sha_from_remote)" || {
    echo "" >&2
    echo "error: could not sync ${REF} (network, GitHub, or HTTP 400 from git)." >&2
    echo "On the NAS host (SSH), run:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/scripts/recover-from-github.sh | bash -s ${RESOLVED}" >&2
    echo "  docker compose -f ${RESOLVED}/docker-compose.yml up -d --build" >&2
    exit 1
  }
  fetch_commit_object "${COMMIT}" || {
    echo "error: could not download commit ${COMMIT:0:12}" >&2
    exit 1
  }
elif ! git_install cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
  fetch_commit_object "${COMMIT}" || {
    echo "error: could not download target commit ${COMMIT:0:12}" >&2
    exit 1
  }
fi

git_install checkout -B "${REF}" "${COMMIT}"
git_install reset --hard "${COMMIT}"

echo "Git at $(git_install rev-parse --short HEAD) (${REF})"
