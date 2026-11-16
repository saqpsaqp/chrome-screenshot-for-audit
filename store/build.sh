#!/usr/bin/env bash
# Renders Chrome Web Store assets from store/src/*.html with headless Chrome.
set -euo pipefail
cd "$(dirname "$0")"
render() { # <src> <out> <width> <height>
  google-chrome --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$3,$4" --screenshot="$PWD/$2" "file://$PWD/src/$1" 2>/dev/null
  echo "Rendered $2 ($3x$4)"
}
render screenshot-1.html screenshot-1.png 1280 800
render screenshot-2.html screenshot-2.png 1280 800
render promo-small.html  promo-small-440x280.png 440 280
