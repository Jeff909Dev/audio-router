#!/bin/bash
# Checks the packaged app before anyone downloads it: signed ad-hoc as the
# right bundle ID, every slice present, and the microphone prompt text set.
#
#   scripts/verify-dist.sh [path/to/Audio Router.app]
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
app=${1:-$root/app/release/mac-universal/Audio Router.app}
res=$app/Contents/Resources
plist=$app/Contents/Info.plist
bundle_id=$(sed -n 's/^appId: *//p' "$root/app/electron-builder.yml")
failed=0

# check <description> <command...>: prints ok or FAIL with the command's output.
check() {
  local desc=$1 out line
  shift
  if out=$("$@" 2>&1); then
    echo "ok    $desc"
  else
    echo "FAIL  $desc"
    [ -n "$out" ] && while IFS= read -r line; do echo "      $line"; done <<<"$out"
    failed=1
  fi
}

adhoc_as() {
  local info
  info=$(codesign -dv "$1" 2>&1)
  if grep -qx 'Signature=adhoc' <<<"$info" && grep -qxF "Identifier=$2" <<<"$info"; then return 0; fi
  echo "$info"
  return 1
}

universal() {
  local archs
  archs=$(lipo -archs "$1") || return 1
  [ "$(tr ' ' '\n' <<<"$archs" | sort | xargs)" = "arm64 x86_64" ] || { echo "slices: $archs"; return 1; }
}

mic_text() {
  local text
  text=$(/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$plist") && [ -n "$text" ]
}

[ -d "$app" ] || { echo "verify-dist: no app at $app (run make dist)"; exit 1; }
exe=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")

check "app is signed ad-hoc as $bundle_id" adhoc_as "$app" "$bundle_id"
check "app signature verifies (--deep --strict)" codesign --verify --deep --strict "$app"
# --deep does not look inside bundles under Resources, so check each one.
for code in arctl AudioRouter2ch.driver AudioRouter16ch.driver; do
  check "$code signature verifies (--strict)" codesign --verify --strict "$res/$code"
done
check "$exe is universal" universal "$app/Contents/MacOS/$exe"
check "arctl is universal" universal "$res/arctl"
for v in 2ch 16ch; do
  check "AudioRouter$v driver is universal" universal "$res/AudioRouter$v.driver/Contents/MacOS/AudioRouter$v"
done
check "Info.plist has NSMicrophoneUsageDescription" mic_text

if [ "$failed" = 0 ]; then
  echo "verify-dist: all checks passed"
else
  echo "verify-dist: FAILED"
  exit 1
fi
