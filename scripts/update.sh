#!/usr/bin/env bash
# Pull latest blank-cloud and rebuild the Docker stack (run on the host install directory).
set -euo pipefail

INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
export BLANK_CLOUD_INSTALL_DIR="${INSTALL_DIR}"
export BLANK_CLOUD_REF="${BLANK_CLOUD_REF:-main}"

cd "$INSTALL_DIR"

if [[ ! -f docker-compose.yml ]]; then
  echo "error: docker-compose.yml not found in ${INSTALL_DIR}" >&2
  exit 1
fi

bash "$(dirname "$0")/git-pull.sh"

echo "Building and restarting containers …"
docker compose build
docker compose up -d

if [[ -d .git ]]; then
  git -c safe.directory="$(pwd)" rev-parse --short HEAD 2>/dev/null | xargs -I{} echo "blank-cloud updated ({})"
else
  echo "blank-cloud updated"
fi
