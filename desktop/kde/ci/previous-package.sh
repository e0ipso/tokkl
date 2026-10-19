#!/usr/bin/env bash
# Downloads the published tokkl-kde package that the release's upgrade check
# starts from, for scripts/container-check.sh --previous-package.
#
#   previous-package.sh --format deb|rpm --version <version> --output <dir>
#
# It picks the newest published GitHub release (no drafts or pre-releases)
# whose version is older than <version> by the package version order
# (scripts/native-version.sh, compared with dpkg) and that has exactly one
# asset for the format: named tokkl-kde_<v>_amd64.deb or
# tokkl-kde-<v>-1.<dist>.x86_64.rpm, with the label .releaserc.json gives
# that format today (which names the target, such as Debian 13) and a
# SHA-256 digest. Releases without such an asset, for example ones built
# for another target, are passed over. The asset is downloaded into a
# scratch directory in <dir>, checked against its size and digest, moved
# into <dir> and its path printed.
#
# When there is nothing to use (gh, jq or dpkg missing, the releases or the
# release's assets cannot be read, no older release has a matching asset, or
# the download fails) it says why on stderr, prints nothing and exits 0: the
# check then builds the synthetic previous package (0.0.0 from this source).
# A downloaded file that does not match its size and digest exits 1. Neither
# leaves a file from the download in <dir>.
#
# gh finds the repository and token as usual (GH_REPO and GH_TOKEN in CI).

set -euo pipefail

usage() {
    echo "usage: $0 --format deb|rpm --version <version> --output <dir>" >&2
    exit 2
}

format=""
version=""
output=""
while [ $# -gt 0 ]; do
    case "$1" in
        --format) format="${2-}"; shift 2 || usage ;;
        --version) version="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
case "$format" in deb|rpm) ;; *) usage ;; esac
[ -n "$version" ] && [ -n "$output" ] || usage

kde_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
native_version() { "$kde_dir/scripts/native-version.sh" "$1"; }
next="$(native_version "$version")" || exit 2

fallback() {
    echo "previous package: $*; the upgrade check uses a build of this source as 0.0.0 instead" >&2
    exit 0
}
for tool in gh jq dpkg sha256sum; do
    command -v "$tool" > /dev/null || fallback "$tool is not installed"
done

label="$(jq -r --arg ext ".$format" '
    .plugins[] | select(type == "array" and .[0] == "@semantic-release/github")
    | .[1].assets[] | select(.path | endswith($ext)) | .label' "$kde_dir/../../.releaserc.json")"
if [ -z "$label" ] || [ "$(wc -l <<<"$label")" != 1 ]; then
    echo "error: .releaserc.json does not give one label for the .$format asset" >&2
    exit 1
fi

if ! tags="$(gh release list --exclude-drafts --exclude-pre-releases --limit 1000 \
    --json tagName --jq '.[].tagName' 2>&1)"; then
    fallback "cannot list the releases ($(head -n 1 <<<"$tags"))"
fi

# "<native version> <tag>" for each release older than the next version.
candidates=()
while read -r tag; do
    [ -n "$tag" ] && [ "${tag#v}" != "$tag" ] || continue
    native="$(native_version "${tag#v}" 2> /dev/null)" || continue
    dpkg --compare-versions "$native" lt "$next" || continue
    candidates+=("$native $tag")
done <<<"$tags"

# The asset of the given release for this format, as JSON, or nothing.
# Fails when the release cannot be read.
asset_of() { # <native version> <tag>
    local assets
    if ! assets="$(gh release view "$2" --json assets 2>&1)"; then
        head -n 1 <<<"$assets" >&2
        return 1
    fi
    jq -c --arg format "$format" --arg native "$1" --arg label "$label" '
        [.assets[]
         | select(.label == $label and .state == "uploaded" and ((.digest // "") | startswith("sha256:")))
         | select(if $format == "deb" then .name == "tokkl-kde_\($native)_amd64.deb"
                  else (.name | startswith("tokkl-kde-\($native)-1.")) and (.name | endswith(".x86_64.rpm"))
                       and (.name | ltrimstr("tokkl-kde-\($native)-1.") | rtrimstr(".x86_64.rpm") | test("^[A-Za-z0-9_]+$"))
                  end)]
        | if length == 1 then .[0] else empty end' <<<"$assets"
}

# Newest first, by the package version order.
chosen=""
while [ "${#candidates[@]}" -gt 0 ]; do
    best=0
    for i in "${!candidates[@]}"; do
        if dpkg --compare-versions "${candidates[$i]%% *}" gt "${candidates[$best]%% *}"; then
            best=$i
        fi
    done
    native="${candidates[$best]%% *}"
    tag="${candidates[$best]#* }"
    unset 'candidates[best]'
    candidates=("${candidates[@]}")
    asset="$(asset_of "$native" "$tag")" || fallback "cannot read the assets of $tag"
    if [ -n "$asset" ]; then
        chosen="$tag"
        break
    fi
    echo "previous package: $tag has no single \"$label\" asset for $native; trying older releases" >&2
done
[ -n "$chosen" ] || fallback "no published release older than $version has a \"$label\" asset"

name="$(jq -r .name <<<"$asset")"
size="$(jq -r .size <<<"$asset")"
digest="$(jq -r '.digest | ltrimstr("sha256:")' <<<"$asset")"
mkdir -p "$output"
file="$output/$name"
rm -f "$file"
# Only a complete, verified file reaches <dir>; whatever happens, the scratch
# directory goes.
download="$(mktemp -d "$output/.download.XXXXXX")"
trap 'rm -rf "$download"' EXIT
if ! gh release download "$chosen" --pattern "$name" --dir "$download" >&2; then
    fallback "downloading $name from $chosen failed"
fi
if [ ! -f "$download/$name" ] || [ "$(stat -c %s "$download/$name")" != "$size" ] \
    || [ "$(sha256sum "$download/$name" | cut -d' ' -f1)" != "$digest" ]; then
    echo "error: $name from $chosen does not match its published size $size and SHA-256 $digest" >&2
    exit 1
fi
mv "$download/$name" "$file"
echo "previous package: $name from $chosen, SHA-256 $digest, for the upgrade to $version" >&2
echo "$file"
