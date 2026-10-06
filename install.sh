#!/usr/bin/env bash
# blank-cloud installer — see README.md for install commands.
# Recommended: git clone --depth 1 https://github.com/lamkln/blank-cloud.git ~/blank-cloud && bash ~/blank-cloud/install.sh
# Curl: curl -fsSL https://github.com/lamkln/blank-cloud/raw/main/install.sh | bash
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

install_or_update_repo() {
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    echo "Updating ${INSTALL_DIR} ..."
    git -C "$INSTALL_DIR" fetch origin "$REF"
    git -C "$INSTALL_DIR" checkout "$REF" 2>/dev/null || git -C "$INSTALL_DIR" checkout "origin/${REF}"
    git -C "$INSTALL_DIR" pull --ff-only origin "$REF" 2>/dev/null || true
    return
  fi

  if [[ -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
    echo "Using existing blank-cloud at ${INSTALL_DIR} (docker-compose.yml found)."
    if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
      echo "  Tip: add git metadata with: git -C \"${INSTALL_DIR}\" init && git remote add origin \"${REPO_URL}\" && git fetch --depth 1 origin \"${REF}\" && git -C \"${INSTALL_DIR}\" checkout -f FETCH_HEAD"
    fi
    return
  fi

  if [[ -d "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    echo "error: ${INSTALL_DIR} already exists and is not empty (and is not a blank-cloud checkout)." >&2
    echo "" >&2
    echo "If this folder IS your install, add the app files then re-run:" >&2
    echo "  cd ${INSTALL_DIR} && git clone --depth 1 --branch ${REF} ${REPO_URL} ." >&2
    echo "" >&2
    echo "Or pick another path:" >&2
    echo "  BLANK_CLOUD_INSTALL_DIR=\${HOME}/blank-cloud-new bash install.sh" >&2
    echo "" >&2
    echo "Or remove the old folder (only if you do not need its contents):" >&2
    echo "  rm -rf ${INSTALL_DIR}" >&2
    exit 1
  fi

  echo "Cloning blank-cloud into ${INSTALL_DIR} ..."
  mkdir -p "$INSTALL_DIR"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" checkout "$REF"
  }
}

install_or_update_repo

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
