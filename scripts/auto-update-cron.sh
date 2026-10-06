#!/usr/bin/env bash
# Host cron helper: update only when origin/main moved. Example crontab:
#   0 4 * * * BLANK_CLOUD_INSTALL_DIR=$HOME/blank-cloud $HOME/blank-cloud/scripts/auto-update-cron.sh >>$HOME/blank-cloud/data/auto-update.log 2>&1
set -euo pipefail

INSTALL_DIR="${BLANK_CLOUD_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
REF="${BLANK_CLOUD_REF:-main}"

cd "$INSTALL_DIR"
[[ -d .git ]] || exit 0

git fetch origin "$REF" --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/${REF}" 2>/dev/null || git ls-remote origin "$REF" | cut -f1)"

if [[ -z "$REMOTE" || "$LOCAL" == "$REMOTE" ]]; then
  echo "$(date -Is) up to date (${LOCAL:0:7})"
  exit 0
fi

echo "$(date -Is) update ${LOCAL:0:7} -> ${REMOTE:0:7}"
exec bash "$(dirname "$0")/update.sh"
