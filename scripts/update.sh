#!/usr/bin/env bash
# Pull latest blank-cloud and rebuild the Docker stack (run on the host install directory).
set -euo pipefail

INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
REF="${BLANK_CLOUD_REF:-main}"
REPO_URL="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"

cd "$INSTALL_DIR"

if [[ ! -f docker-compose.yml ]]; then
  echo "error: docker-compose.yml not found in ${INSTALL_DIR}" >&2
  exit 1
fi

if [[ -d .git ]]; then
  echo "Fetching ${REF} …"
  git fetch origin "$REF"
  git checkout "$REF" 2>/dev/null || git checkout "origin/${REF}"
  git pull --ff-only origin "$REF" || {
    echo "error: git pull failed (local changes or diverged history)" >&2
    exit 1
  }
else
  echo "warning: ${INSTALL_DIR} is not a git checkout — skipping git pull" >&2
fi

echo "Building and restarting containers …"
docker compose build
docker compose up -d

echo "blank-cloud updated ($(git rev-parse --short HEAD 2>/dev/null || echo unknown))"
