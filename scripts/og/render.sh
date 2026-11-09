#!/usr/bin/env bash
# Renders scripts/og/og.html to docs/og.png (1200x630) with headless Chrome.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --screenshot="$here/../../docs/og.png" "file://$here/og.html"
