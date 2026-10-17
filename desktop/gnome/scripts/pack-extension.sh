#!/usr/bin/env bash
# Packs the GNOME Shell extension for one shared Tokkl version and checks the
# zip.
#
#   pack-extension.sh --version <version> --output <dir>
#
# Run it where gnome-extensions (GNOME Shell), jq and unzip are installed;
# scripts/container-check.sh shows how. The version goes into metadata.json
# as version-name, which GNOME Shell and extensions.gnome.org show. Their
# rule allows 1 to 16 letters, digits, dots and spaces, so 1.2.0 can be
# packed and 1.2.0-rc.1 cannot (status 2). extensions.gnome.org sets the
# integer version itself on upload.
#
# The extension is copied to a temporary directory, so the checkout is only
# read. The zip is written to the output directory as
# tokkl-gnome-extension-<version>.zip, and its path is printed on the last
# line. It is then installed into a throwaway home to see that GNOME Shell's
# own installer takes it and compiles its settings schema.

set -euo pipefail

usage() {
    echo "usage: $0 --version <version> --output <dir>" >&2
    exit 2
}

version=""
output=""
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$output" ] || usage

if ! [[ "$version" =~ ^[A-Za-z0-9.\ ]{1,16}$ ]] || [[ "$version" =~ ^[.\ ]+$ ]]; then
    echo "error: \"$version\" is not a valid version-name for extensions.gnome.org:" \
        "use 1 to 16 letters, digits, dots and spaces, for example 1.2.0." >&2
    exit 2
fi

extension_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../extension" && pwd)"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

uuid="$(jq -r .uuid "$extension_dir/metadata.json")"
# The files the extension runs from; tests/ and ci/ stay behind.
mkdir -p "$work/source"
cp -a "$extension_dir"/*.js "$extension_dir/stylesheet.css" "$extension_dir/schemas" "$work/source/"
jq --arg version "$version" '. + {"version-name": $version}' "$extension_dir/metadata.json" \
    > "$work/source/metadata.json"

extra=()
for file in "$work/source"/*.js; do
    case "$(basename "$file")" in
        extension.js|prefs.js) ;;
        *) extra+=("--extra-source=$(basename "$file")") ;;
    esac
done
gnome-extensions pack "$work/source" --force --out-dir="$work" "${extra[@]}"
zip="$output/tokkl-gnome-extension-$version.zip"
mv "$work/$uuid.shell-extension.zip" "$zip"

# The zip holds the extension's files and nothing else.
expected="$(cd "$work/source" && find . -type f | sed 's|^\./||' | sort)"
contents="$(unzip -Z1 "$zip" | grep -v '/$' | sort)"
if [ "$contents" != "$expected" ]; then
    echo "error: the zip holds [${contents//$'\n'/ }] instead of [${expected//$'\n'/ }]" >&2
    exit 1
fi
packed="$(unzip -p "$zip" metadata.json)"
[ "$(jq -r '."version-name"' <<<"$packed")" = "$version" ] \
    || { echo "error: metadata.json in the zip does not have version-name $version" >&2; exit 1; }
jq -e --slurpfile source "$extension_dir/metadata.json" \
    'del(."version-name") == $source[0]' <<<"$packed" > /dev/null \
    || { echo "error: metadata.json in the zip differs from the source beyond version-name" >&2; exit 1; }

# GNOME Shell's installer accepts it and compiles the settings schema.
home="$work/home"
mkdir -p "$home"
HOME="$home" XDG_DATA_HOME="$home/.local/share" gnome-extensions install --force "$zip"
installed="$home/.local/share/gnome-shell/extensions/$uuid"
[ -f "$installed/metadata.json" ] || { echo "error: gnome-extensions install did not install $uuid" >&2; exit 1; }
[ -f "$installed/schemas/gschemas.compiled" ] \
    || { echo "error: the install did not compile the settings schema" >&2; exit 1; }

echo "$zip"
