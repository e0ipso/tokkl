#!/usr/bin/env bash
# Checks a DMG from package-dmg.sh the way a user gets it: mounts it read-only
# and checks that it holds Tokkl.app and a link to /Applications, that the
# bundle's version is <version> and its Info.plist keeps it out of the Dock,
# and that its signature verifies. Then it starts the app from the DMG with
# no Qt paths in the environment, so it loads only what the bundle holds,
# and fails unless the app is still running after ten seconds. With no
# settings the app opens its settings window and touches no keychain item.
#
#   check-dmg.sh <dmg> <version>

set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <dmg> <version>" >&2; exit 2; }
dmg="$1"
version="$2"

die() {
    echo "check-dmg.sh: $*" >&2
    exit 1
}

[ "$(uname -s)" = Darwin ] || die "needs macOS"
[ -f "$dmg" ] || die "$dmg not found"

mountpoint="$(mktemp -d "${TMPDIR:-/tmp}/tokkl-dmg-check.XXXXXX")"
pid=""
cleanup() {
    if [ -n "$pid" ]; then
        kill "$pid" 2> /dev/null || true
        wait "$pid" 2> /dev/null || true
    fi
    hdiutil detach "$mountpoint" -quiet 2> /dev/null || hdiutil detach "$mountpoint" -force -quiet 2> /dev/null || true
    rmdir "$mountpoint" 2> /dev/null || true
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mountpoint" "$dmg" > /dev/null

app="$mountpoint/Tokkl.app"
plist="$app/Contents/Info.plist"
[ -d "$app" ] || die "the DMG has no Tokkl.app"
[ "$(readlink "$mountpoint/Applications")" = /Applications ] || die "the DMG has no link to /Applications"
plutil -lint "$plist" > /dev/null
[ "$(plutil -extract CFBundleVersion raw -o - "$plist")" = "$version" ] || die "CFBundleVersion is not $version"
[ "$(plutil -extract LSUIElement raw -o - "$plist")" = true ] || die "LSUIElement is not true"
codesign --verify --deep --strict --verbose=2 "$app"

executable="$app/Contents/MacOS/$(plutil -extract CFBundleExecutable raw -o - "$plist")"
env -u QT_PLUGIN_PATH -u QT_QPA_PLATFORM_PLUGIN_PATH -u QML2_IMPORT_PATH -u QML_IMPORT_PATH \
    -u DYLD_LIBRARY_PATH -u DYLD_FRAMEWORK_PATH "$executable" &
pid=$!
sleep 10
kill -0 "$pid" 2> /dev/null || die "Tokkl.app exited within ten seconds"
echo "check-dmg.sh: $dmg holds Tokkl $version, signed, and it stays up" >&2
