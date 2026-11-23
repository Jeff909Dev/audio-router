#!/bin/sh
# Rebuilds app/build/icon.icns from app/build/icon.svg. macOS only: sips renders the SVG.
set -eu
cd "$(dirname "$0")/../app/build"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/icon.iconset"
sips -s format png icon.svg --out "$tmp/1024.png" >/dev/null
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$tmp/1024.png" --out "$tmp/icon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$tmp/1024.png" --out "$tmp/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$tmp/icon.iconset" -o icon.icns
echo "wrote app/build/icon.icns"
