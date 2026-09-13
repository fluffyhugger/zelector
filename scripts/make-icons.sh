#!/usr/bin/env bash
# Generate every icon size Chrome wants from one source image.
#   ./scripts/make-icons.sh path/to/icon.png
# Source should be square and at least 128x128 (512 is better — sips only downscales well).
set -euo pipefail

SRC="${1:?usage: make-icons.sh <source-image>}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/icons"

case "$SRC" in
  *.svg|*.SVG)
    echo "sips cannot read SVG. Export a PNG at 512x512 first, or use:"
    echo "  qlmanage -t -s 512 -o /tmp \"$SRC\"  # then pass /tmp/<name>.png"
    exit 1
    ;;
esac

mkdir -p "$DIR"
for SIZE in 16 32 48 128; do
  sips -s format png -z "$SIZE" "$SIZE" "$SRC" --out "$DIR/icon$SIZE.png" >/dev/null
  echo "  icons/icon$SIZE.png"
done
echo
echo "Done. Run 'npm run build' (or let the watcher pick it up), then reload the"
echo "extension in chrome://extensions — Chrome caches icons until you do."
