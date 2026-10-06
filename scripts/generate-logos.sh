#!/usr/bin/env bash
# Regenerate PNG logo files from public/*.svg (requires rsvg-convert / librsvg2-bin).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="${ROOT}/public"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "error: rsvg-convert not found. Install librsvg2-bin (Debian/Ubuntu) or librsvg (macOS)." >&2
  exit 1
fi

rsvg-convert -w 512 -h 512 "${PUB}/logo.svg" -o "${PUB}/logo.png"
rsvg-convert -w 512 -h 512 "${PUB}/logo.svg" -o "${PUB}/logo-512.png"
rsvg-convert -w 512 -h 512 "${PUB}/logo-mark.svg" -o "${PUB}/logo-mark-512.png"
rsvg-convert -w 512 -h 512 "${PUB}/logo-mark-light.svg" -o "${PUB}/logo-mark-light-512.png"
rsvg-convert -w 512 -h 512 "${PUB}/logo-mark-dark.svg" -o "${PUB}/logo-mark-dark-512.png"
rsvg-convert -w 560 "${PUB}/logo-wordmark.svg" -o "${PUB}/logo-wordmark.png"
rsvg-convert -w 32 -h 32 "${PUB}/logo.svg" -o "${PUB}/favicon-32.png"
rsvg-convert -w 180 -h 180 "${PUB}/logo.svg" -o "${PUB}/apple-touch-icon.png"

echo "Wrote PNGs in ${PUB}/ (logo.png from logo.svg)"
