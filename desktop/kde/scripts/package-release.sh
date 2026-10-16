#!/usr/bin/env bash
# Builds the tokkl-kde DEB or RPM for one shared Tokkl version.
#
#   package-release.sh --version <semver> --format deb|rpm --output <dir>
#
# Run it on the target system (TUXEDO OS 24.04 for deb, Fedora 44 for rpm)
# with the build dependencies installed; scripts/container-check.sh shows how.
# The version is the Tokkl release version, for example 1.2.0 or 1.2.0-rc.1.
# It goes into the widget metadata unchanged and into the package version with
# "~" in place of the pre-release dash, so 1.2.0~rc.1 sorts before 1.2.0.
#
# The source tree is copied to a temporary directory, so the checkout is only
# read. Only the binary package is written to the output directory, and its
# path is printed on the last line.

set -euo pipefail

usage() {
    echo "usage: $0 --version <semver> --format deb|rpm --output <dir>" >&2
    exit 2
}

version=""
format=""
output=""
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --format) format="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$format" ] && [ -n "$output" ] || usage

# Same pattern as TOKKL_SEMVER_REGEX in cmake/TokklVersion.cmake.
semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
if ! [[ "$version" =~ $semver ]]; then
    echo "error: \"$version\" is not a semantic version (MAJOR.MINOR.PATCH)" >&2
    exit 2
fi
# Only the first dash starts the pre-release; later ones stay.
native_version="${version/-/\~}"

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The files the build needs. The tests and any build directory stay behind.
copy_source() {
    mkdir -p "$1"
    cp -a "$source_dir/CMakeLists.txt" "$source_dir/README.md" \
        "$source_dir/cmake" "$source_dir/package" "$source_dir/src" "$1/"
}

build_deb() {
    local tree="$work/tokkl-kde-$native_version"
    copy_source "$tree"
    cp -a "$source_dir/debian" "$tree/"
    cat > "$tree/debian/changelog" <<EOF
tokkl-kde ($native_version) noble; urgency=medium

  * Tokkl $version.

 -- Tokkl contributors <contributors@example.invalid>  $(date -R ${SOURCE_DATE_EPOCH:+-d "@$SOURCE_DATE_EPOCH"})
EOF
    (cd "$tree" && TOKKL_VERSION="$version" dpkg-buildpackage -b --no-sign)
    local deb="tokkl-kde_${native_version}_amd64.deb"
    cp "$work/$deb" "$output/"
    echo "$output/$deb"
}

build_rpm() {
    local name="tokkl-kde-$native_version"
    copy_source "$work/$name"
    mkdir -p "$work/rpmbuild/SOURCES"
    tar -C "$work" -czf "$work/rpmbuild/SOURCES/$name.tar.gz" "$name"
    rpmbuild -bb \
        --define "_topdir $work/rpmbuild" \
        --define "tokkl_version $version" \
        "$source_dir/packaging/rpm/tokkl-kde.spec"
    local rpm
    rpm="$(find "$work/rpmbuild/RPMS/x86_64" -name "$name-*.x86_64.rpm" \
        ! -name '*-debuginfo-*' ! -name '*-debugsource-*')"
    if [ "$(printf '%s\n' "$rpm" | grep -c .)" != 1 ]; then
        echo "error: expected one $name RPM, found: $rpm" >&2
        exit 1
    fi
    cp "$rpm" "$output/"
    echo "$output/$(basename "$rpm")"
}

case "$format" in
    deb) build_deb ;;
    rpm) build_rpm ;;
    *) usage ;;
esac
