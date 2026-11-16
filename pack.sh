#!/usr/bin/env bash
# Builds the Chrome Web Store upload zip from manifest.json version.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
OUT="evidence-capture-v${VERSION}.zip"

rm -f "$OUT"
zip -qr "$OUT" \
  manifest.json \
  background.js \
  popup.html popup.js \
  options.html options.js \
  styles.css \
  lib \
  $( [ -d icons ] && echo icons )

echo "Created: $OUT"
