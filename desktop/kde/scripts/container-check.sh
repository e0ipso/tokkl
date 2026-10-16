#!/usr/bin/env bash
# Builds and checks the tokkl-kde packages in throwaway containers, so the
# host's packages are never touched.
#
#   container-check.sh --version <semver> --output <dir>
#                      [--format deb|rpm|all] [--previous-version <semver>]
#
# For each format it runs two containers, both removed afterwards:
#   1. build: scripts/prepare-target.sh --build-deps, then
#      scripts/package-release.sh for --previous-version (into
#      <dir>/previous/) and for --version (into <dir>).
#   2. check: a fresh container with only the repositories, running
#      scripts/check-package.sh on the new package, with the previous one for
#      the upgrade.
# The previous version defaults to 0.0.0: a build of this same source, which
# tests the upgrade itself, not changes between real releases. To check an
# upgrade from a published release, run check-package.sh with that package.
#
# Images: TOKKL_DEB_IMAGE (default ubuntu:24.04) and TOKKL_RPM_IMAGE (default
# fedora:44); set them to digests to pin. CONTAINER_ENGINE defaults to docker.

set -euo pipefail

usage() {
    echo "usage: $0 --version <semver> --output <dir> [--format deb|rpm|all] [--previous-version <semver>]" >&2
    exit 2
}

version=""
output=""
formats="deb rpm"
previous_version="0.0.0"
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        --format)
            case "${2-}" in
                deb|rpm) formats="$2" ;;
                all) formats="deb rpm" ;;
                *) usage ;;
            esac
            shift 2 ;;
        --previous-version) previous_version="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$output" ] || usage

semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
for v in "$version" "$previous_version"; do
    [[ "$v" =~ $semver ]] || { echo "error: \"$v\" is not a semantic version" >&2; exit 2; }
done
if [ "$previous_version" = "$version" ]; then
    echo "error: --previous-version must be older than --version" >&2
    exit 2
fi
native_version="${version/-/\~}"
native_previous="${previous_version/-/\~}"

engine="${CONTAINER_ENGINE:-docker}"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$output/previous"
output="$(cd "$output" && pwd)"
build_env=()
[ -z "${SOURCE_DATE_EPOCH:-}" ] || build_env=(-e "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH")

for format in $formats; do
    if [ "$format" = deb ]; then
        image="${TOKKL_DEB_IMAGE:-ubuntu:24.04}"
        new="/out/tokkl-kde_${native_version}_amd64.deb"
        old="/out/previous/tokkl-kde_${native_previous}_amd64.deb"
    else
        image="${TOKKL_RPM_IMAGE:-fedora:44}"
        new="/out/tokkl-kde-${native_version}-1.*.x86_64.rpm"
        old="/out/previous/tokkl-kde-${native_previous}-1.*.x86_64.rpm"
    fi

    echo "== $format: build $previous_version and $version in $image"
    # The inner script is single-quoted on purpose: the container's bash
    # expands its positional arguments.
    # shellcheck disable=SC2016
    "$engine" run --rm \
        -v "$source_dir:/src:ro" -v "$output:/out" \
        "${build_env[@]}" \
        "$image" bash -euc '
            /src/scripts/prepare-target.sh --format "$1" --build-deps
            /src/scripts/package-release.sh --version "$2" --format "$1" --output /out/previous
            /src/scripts/package-release.sh --version "$3" --format "$1" --output /out
        ' bash "$format" "$previous_version" "$version"

    echo "== $format: install, upgrade and remove in a clean $image"
    # The globs only match the release suffix of the RPM file name.
    # shellcheck disable=SC2016
    "$engine" run --rm \
        -v "$source_dir:/src:ro" -v "$output:/out:ro" \
        "$image" bash -euc '
            /src/scripts/prepare-target.sh --format "$1"
            /src/scripts/check-package.sh --version "$2" --package '"$new"' --previous '"$old"'
        ' bash "$format" "$version"
done
