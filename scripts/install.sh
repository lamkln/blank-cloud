#!/usr/bin/env bash
# blank-cloud installer — run via:
#   curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/scripts/install.sh | bash
set -euo pipefail

REPO_URL="${BLANK_CLOUD_REPO:-https://github.com/lamkln/blank-cloud.git}"
REF="${BLANK_CLOUD_REF:-main}"
INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-${HOME}/blank-cloud}"
PROJECT_DIR="${BLANK_CLOUD_PROJECT:-${INSTALL_DIR}/project}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is required but not found in PATH" >&2
    exit 1
  fi
}

require_cmd git
require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' (Compose v2 plugin) is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  echo "Updating ${INSTALL_DIR} ..."
  git -C "$INSTALL_DIR" fetch origin "$REF"
  git -C "$INSTALL_DIR" checkout "$REF" 2>/dev/null || git -C "$INSTALL_DIR" checkout "origin/${REF}"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REF" 2>/dev/null || true
else
  echo "Cloning blank-cloud into ${INSTALL_DIR} ..."
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    git clone "$REPO_URL" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" checkout "$REF"
  }
fi

mkdir -p "$PROJECT_DIR"

ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
# blank-cloud — edit and add your API key
BLANK_CLOUD_PROJECT=${PROJECT_DIR}
LLM_PROVIDER=openai
OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
# GOOGLE_GENERATIVE_AI_API_KEY=
# GROQ_API_KEY=
# OPENROUTER_API_KEY=
# CUSTOM_OPENAI_BASE_URL=
# CUSTOM_OPENAI_API_KEY=
EOF
  echo "Created ${ENV_FILE} — set OPENAI_API_KEY (or another provider) before starting."
else
  echo "Using existing ${ENV_FILE}"
fi

echo "Building image blank-cloud ..."
(cd "$INSTALL_DIR" && docker compose build)

cat <<EOF

blank-cloud installed at: ${INSTALL_DIR}

Start (foreground):
  cd ${INSTALL_DIR} && docker compose up

Start (background):
  cd ${INSTALL_DIR} && docker compose up -d

API: http://localhost:8787/health

EOF

if [[ "${BLANK_CLOUD_START:-}" == "1" ]]; then
  cd "$INSTALL_DIR" && docker compose up -d
  echo "Started in background (docker compose up -d)."
fi
