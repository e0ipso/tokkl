#!/usr/bin/env bash
# Tests, builds and checks the tokkl-kde packages in throwaway containers, so
# the host's packages are never touched. CI and the release run it.
#
#   container-check.sh --version <version> --output <dir>
#                      [--format deb|rpm|all] [--previous-version <version>]
#
# For each format it builds the images of ci/Dockerfile (deb) or
# ci/fedora.Dockerfile (rpm), tagged <image>:<format>-target, -build and
# -test, then runs three containers, all removed afterwards:
#   1. test: configure and build the project, with desktop/core, for the
#      version, run CTest under Xvfb and a DBus session, and copy the smokeload and
#      realservertest binaries to <dir>/tests/<format>/, with the packages
#      the load check needs in packages.txt.
#   2. build: scripts/package-release.sh for --previous-version (into
#      <dir>/previous/) and for --version (into <dir>).
#   3. check: a fresh target container running scripts/check-package.sh on
#      the new package, with the previous one for the upgrade and the
#      smokeload binary for the load check.
# The previous version defaults to 0.0.0: a build of this same source, which
# tests the upgrade itself, not changes between real releases. To check an
# upgrade from a published release, run check-package.sh with that package.
#
# TOKKL_KDE_CI_IMAGE names the images (default tokkl-kde-ci). They stay
# after the run, for ci/realserver.sh; remove them with docker image rm.
# CONTAINER_ENGINE defaults to docker.
#
# The images carry the identity printed by ci/image-id.sh in the label
# org.tokkl.kde-ci.inputs, and images that carry the current identity are
# reused without a build. Set TOKKL_KDE_CI_REFRESH to a new value to rebuild
# them against the distribution archives as they are now. With
# TOKKL_KDE_CI_IMAGE_CACHE set to a directory, images missing from the engine
# are loaded from <dir>/<format>-<identity>.tar when it exists, and images
# built in this run are saved there; CI keeps that file between runners.
# Each target container fetches the package lists again
# (scripts/prepare-target.sh --refresh), as the image may be older.

set -euo pipefail

usage() {
    echo "usage: $0 --version <version> --output <dir> [--format deb|rpm|all] [--previous-version <version>]" >&2
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

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The containers get desktop/ at /desktop: the companion and the desktop
# core it builds on.
desktop_dir="$(cd "$source_dir/.." && pwd)"
native_version="$("$source_dir/scripts/native-version.sh" "$version")" || exit 2
native_previous="$("$source_dir/scripts/native-version.sh" "$previous_version")" || exit 2
if [ "$previous_version" = "$version" ]; then
    echo "error: --previous-version must be older than --version" >&2
    exit 2
fi
# The containers only see desktop/, so desktop/kde keeps its own copy of the
# repository's LICENSE for the RPM. Refuse a copy that has drifted.
if [ -f "$source_dir/../../LICENSE" ] && ! cmp -s "$source_dir/LICENSE" "$source_dir/../../LICENSE"; then
    echo "error: desktop/kde/LICENSE differs from the repository's LICENSE; copy it again" >&2
    exit 1
fi

engine="${CONTAINER_ENGINE:-docker}"
image="${TOKKL_KDE_CI_IMAGE:-tokkl-kde-ci}"
image_cache="${TOKKL_KDE_CI_IMAGE_CACHE:-}"
inputs_label=org.tokkl.kde-ci.inputs
mkdir -p "$output/previous"
output="$(cd "$output" && pwd)"
build_env=()
[ -z "${SOURCE_DATE_EPOCH:-}" ] || build_env=(-e "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH")

for format in $formats; do
    if [ "$format" = deb ]; then
        dockerfile="$source_dir/ci/Dockerfile"
        new="/out/tokkl-kde_${native_version}_amd64.deb"
        old="/out/previous/tokkl-kde_${native_previous}_amd64.deb"
        # Found by ldd for the loader; these are what it runs under.
        session_packages="dbus-daemon xauth xvfb"
    else
        dockerfile="$source_dir/ci/fedora.Dockerfile"
        new="/out/tokkl-kde-${native_version}-1.*.x86_64.rpm"
        old="/out/previous/tokkl-kde-${native_previous}-1.*.x86_64.rpm"
        session_packages="dbus-daemon xorg-x11-server-Xvfb xorg-x11-xauth"
    fi

    echo "== $format: images from $(basename "$dockerfile")"
    images_started=$SECONDS
    inputs="$("$source_dir/ci/image-id.sh" --format "$format")"
    images_ready() {
        local stage
        for stage in target build test; do
            [ "$("$engine" image inspect --format "{{ index .Config.Labels \"$inputs_label\" }}" \
                "$image:$format-$stage" 2>/dev/null)" = "$inputs" ] || return 1
        done
    }
    archive="${image_cache:+$image_cache/$format-$inputs.tar}"
    if images_ready; then
        echo "image hit: $image:$format-{target,build,test} already have inputs $inputs"
    elif [ -n "$archive" ] && [ -f "$archive" ] && "$engine" load -q -i "$archive" && images_ready; then
        echo "image hit: loaded $image:$format-{target,build,test} for inputs $inputs from $archive"
    else
        echo "image miss: building $image:$format-{target,build,test} for inputs $inputs"
        for stage in target build test; do
            "$engine" build -q -f "$dockerfile" --target "$stage" -t "$image:$format-$stage" \
                --label "$inputs_label=$inputs" \
                --build-arg "TOKKL_KDE_CI_REFRESH=${TOKKL_KDE_CI_REFRESH:-}" "$source_dir"
        done
        if [ -n "$archive" ]; then
            mkdir -p "$image_cache"
            "$engine" save -o "$archive.partial" "$image:$format-target" "$image:$format-build" "$image:$format-test"
            mv "$archive.partial" "$archive"
            echo "saved the images to $archive"
        fi
    fi
    echo "== $format: images ready in $((SECONDS - images_started))s"
    "$engine" run --rm "$image:$format-build" cat /opt/tokkl-kde/baseline.txt

    echo "== $format: build and run CTest for $version"
    rm -rf "$output/tests/$format"
    mkdir -p "$output/tests/$format"
    # shellcheck disable=SC2016
    "$engine" run --rm \
        -v "$desktop_dir:/desktop:ro" -v "$output/tests/$format:/tests" \
        "$image:$format-test" bash -euc '
            cmake -S /desktop/kde -B /tmp/build -DTOKKL_VERSION="$1" -DCMAKE_INSTALL_PREFIX=/usr
            cmake --build /tmp/build -j"$(nproc)"
            dbus-run-session -- xvfb-run -a ctest --test-dir /tmp/build --output-on-failure
            cp /tmp/build/autotests/smokeload /tmp/build/tests/realservertest /tests/
            # The packages that ship the libraries the loader links, plus Xvfb
            # and DBus, for the load check on a clean target.
            for lib in $(ldd /tests/smokeload | awk '"'"'$3 ~ /^\// {print $3}'"'"'); do
                if [ "$2" = deb ]; then
                    dpkg -S "$(realpath "$lib")" 2>/dev/null || dpkg -S "$lib"
                else
                    rpm -qf --qf "%{NAME}\n" "$(realpath "$lib")"
                fi
            done | cut -d: -f1 | sort -u > /tests/packages.txt
            printf "%s\n" $3 >> /tests/packages.txt
        ' bash "$version" "$format" "$session_packages"

    echo "== $format: package $previous_version and $version"
    # shellcheck disable=SC2016
    "$engine" run --rm \
        -v "$desktop_dir:/desktop:ro" -v "$output:/out" \
        "${build_env[@]}" \
        "$image:$format-build" bash -euc '
            /desktop/kde/scripts/package-release.sh --version "$2" --format "$1" --output /out/previous
            /desktop/kde/scripts/package-release.sh --version "$3" --format "$1" --output /out
        ' bash "$format" "$previous_version" "$version"

    echo "== $format: install, load, upgrade and remove in a clean target"
    # The globs only match the release suffix of the RPM file name.
    # shellcheck disable=SC2016
    "$engine" run --rm \
        -v "$desktop_dir:/desktop:ro" -v "$output:/out:ro" \
        "$image:$format-target" bash -euc '
            /desktop/kde/scripts/prepare-target.sh --format "$2" --refresh
            /desktop/kde/scripts/check-package.sh --version "$1" --package '"$new"' --previous '"$old"' \
                --load-test "/out/tests/$2"
        ' bash "$version" "$format"
done
