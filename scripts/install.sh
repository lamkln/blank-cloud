#!/usr/bin/env bash
# Same as ../install.sh — kept for older README links to scripts/install.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/.."
if [[ -f "$ROOT/install.sh" ]]; then
  exec bash "$ROOT/install.sh"
fi
set -euo pipefail
echo "error: run from a git clone, or use:" >&2
echo "  git clone --depth 1 https://github.com/lamkln/blank-cloud.git ~/blank-cloud && bash ~/blank-cloud/install.sh" >&2
exit 1
