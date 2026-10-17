#!/usr/bin/env bash
# Packages a built Tokkl.app as a DMG that runs on a Mac without Qt or
# QtKeychain installed. CI runs it on every build and the release runs it on
# the bundle built for the release version.
#
#   package-dmg.sh --app <Tokkl.app> --version <version> --output <dir>
#                  [--libpath <dir>]... [--identity <identity>]
#
# It copies the bundle, copies Qt and QtKeychain into it with macdeployqt and
# signs every binary in it with the identity, "-" (ad hoc) by default. It
# then checks the copy: the bundle version is <version>, every library a
# binary loads is in the bundle or the system, the Cocoa platform plugin is
# there, and the signature verifies. The DMG holds Tokkl.app and a link to
# /Applications, and is named Tokkl-<version>-<arch>.dmg after the
# executable's architectures (arm64, x86_64 or universal). The script prints
# its path; everything else goes to stderr.
#
# --libpath adds a directory where macdeployqt looks for libraries, such as
# QtKeychain's lib directory. MACDEPLOYQT names macdeployqt (default: the one
# on PATH).

set -euo pipefail

usage() {
    echo "usage: $0 --app <Tokkl.app> --version <version> --output <dir> [--libpath <dir>]... [--identity <identity>]" >&2
    exit 2
}

die() {
    echo "package-dmg.sh: $*" >&2
    exit 1
}

app=""
version=""
output=""
identity="-"
libpaths=()
while [ $# -gt 0 ]; do
    case "$1" in
        --app) app="${2-}"; shift 2 || usage ;;
        --version) version="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        --libpath) libpaths+=("-libpath=${2-}"); shift 2 || usage ;;
        --identity) identity="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$app" ] && [ -n "$version" ] && [ -n "$output" ] && [ -n "$identity" ] || usage
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$ ]] || die "'$version' is not a release version"
[ "$(uname -s)" = Darwin ] || die "needs macOS"
[ -f "$app/Contents/Info.plist" ] || die "$app is not an app bundle"
macdeployqt="${MACDEPLOYQT:-macdeployqt}"
command -v "$macdeployqt" > /dev/null || die "$macdeployqt not found; set MACDEPLOYQT"

plist_value() {
    plutil -extract "$2" raw -o - "$1/Contents/Info.plist"
}

# The version the bundle was built with, before anything is copied.
[ "$(plist_value "$app" CFBundleVersion)" = "$version" ] \
    || die "$app has CFBundleVersion $(plist_value "$app" CFBundleVersion), not $version"
[ "$(plist_value "$app" CFBundleShortVersionString)" = "${version%%[-+]*}" ] \
    || die "$app has CFBundleShortVersionString $(plist_value "$app" CFBundleShortVersionString), not ${version%%[-+]*}"

executable="$(plist_value "$app" CFBundleExecutable)"
archs="$(lipo -archs "$app/Contents/MacOS/$executable")"
case "$archs" in
    arm64) arch=arm64 ;;
    x86_64) arch=x86_64 ;;
    "x86_64 arm64" | "arm64 x86_64") arch=universal ;;
    *) die "unexpected architectures '$archs'" ;;
esac

stage="$(mktemp -d "${TMPDIR:-/tmp}/tokkl-dmg.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
root="$stage/root"
bundle="$root/Tokkl.app"
mkdir -p "$root"
ditto "$app" "$bundle"

# macdeployqt reports some failures only as "ERROR:" lines, so the checks
# below decide whether the bundle is complete.
"$macdeployqt" "$bundle" -always-overwrite -codesign="$identity" ${libpaths[@]+"${libpaths[@]}"} >&2

contents="$bundle/Contents"
failed=0
while IFS= read -r -d '' file; do
    file -b "$file" | grep -q '^Mach-O' || continue
    # A library lists its own install name among its dependencies.
    ids="$(otool -D "$file" | sed 1d)"
    # Dependencies are the indented lines, "<path> (compatibility version ...)".
    while IFS= read -r dep; do
        if printf '%s\n' "$ids" | grep -Fxq -- "$dep"; then
            continue
        fi
        case "$dep" in
            /System/Library/* | /usr/lib/*) continue ;;
            @rpath/*) target="$contents/Frameworks/${dep#@rpath/}" ;;
            @executable_path/*) target="$contents/MacOS/${dep#@executable_path/}" ;;
            @loader_path/*) target="$(dirname "$file")/${dep#@loader_path/}" ;;
            *) target="" ;;
        esac
        if [ -z "$target" ] || [ ! -e "$target" ]; then
            echo "package-dmg.sh: ${file#"$root"/} loads $dep, which is not in the bundle" >&2
            failed=1
        fi
    done < <(otool -L "$file" | sed -n 's/^[[:space:]]\{1,\}\(.*\) (compatibility version.*/\1/p' | sort -u)
    # The checks above resolve @rpath inside the bundle. An rpath left over
    # from the build machine is harmless where it does not exist, but there
    # it can load a library from outside the bundle, so it is reported.
    while IFS= read -r rpath; do
        case "$rpath" in
            /*) echo "package-dmg.sh: warning: ${file#"$root"/} has the rpath $rpath outside the bundle" >&2 ;;
        esac
    done < <(otool -l "$file" | awk '$1 == "cmd" && $2 == "LC_RPATH" { want = 1; next } want && $1 == "path" { print $2; want = 0 }' | sort -u)
done < <(find "$contents" -type f -print0)
[ "$failed" = 0 ] || die "the bundle is incomplete"
[ -e "$contents/PlugIns/platforms/libqcocoa.dylib" ] || die "the bundle has no Cocoa platform plugin"
[ "$(plist_value "$bundle" CFBundleVersion)" = "$version" ] || die "macdeployqt changed CFBundleVersion"
codesign --verify --deep --strict --verbose=2 "$bundle" >&2

ln -s /Applications "$root/Applications"
mkdir -p "$output"
dmg="$(cd "$output" && pwd)/Tokkl-$version-$arch.dmg"
# Hosted macOS runners sometimes fail hdiutil create with "Resource busy"
# right after heavy file writes; flushing them first and trying again a few
# times gets past it.
sync
attempt=1
until hdiutil create -volname "Tokkl $version" -srcfolder "$root" -format UDZO -ov "$dmg" >&2; do
    [ "$attempt" -lt 3 ] || die "hdiutil create failed $attempt times"
    attempt=$((attempt + 1))
    sleep 5
done
hdiutil verify "$dmg" >&2
echo "$dmg"
