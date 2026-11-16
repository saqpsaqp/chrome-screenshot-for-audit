#!/usr/bin/env bash
# Builds the Chrome Web Store upload zip from manifest.json version.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
OUT="proof-shot-v${VERSION}.zip"

rm -f "$OUT"
zip -qr "$OUT" \
  manifest.json \
  background.js \
  popup.html popup.js \
  options.html options.js \
  styles.css \
  lib \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png

echo "Created: $OUT"
