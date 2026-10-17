#!/usr/bin/env bash
# Builds the tokkl-timerd DEB or RPM for one shared Tokkl version.
#
#   package-release.sh --version <version> --format deb|rpm --output <dir>
#
# Run it on the target system (Ubuntu 26.04 for deb, Fedora 44 for rpm) with
# the build dependencies installed; scripts/container-check.sh shows how. The
# version is the Tokkl release version, for example 1.2.0 or 1.2.0-rc.1. The
# program reports it unchanged; desktop/kde/scripts/native-version.sh gives
# the package version (1.2.0~rc1) and lists the forms that can be packaged.
#
# The service, desktop/core and the repository's LICENSE are copied to a
# temporary directory, so the checkout is only read. Only the binary package
# is written to the output directory, and its path is printed on the last
# line.

set -euo pipefail

usage() {
    echo "usage: $0 --version <version> --format deb|rpm --output <dir>" >&2
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

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$source_dir/../.." && pwd)"
core_dir="$repo/desktop/core"
# Refuses, with status 2, versions that dpkg or rpm would order differently.
native_version="$("$repo/desktop/kde/scripts/native-version.sh" "$version")" || exit 2
mkdir -p "$output"
output="$(cd "$output" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The files the build needs, with the desktop core in core/; debian/rules
# and the RPM spec point TOKKL_CORE_DIR at it. The tests stay behind.
copy_source() {
    mkdir -p "$1/core"
    cp -a "$source_dir/CMakeLists.txt" "$source_dir/README.md" "$source_dir/src" "$source_dir/dbus" "$1/"
    cp -a "$repo/LICENSE" "$1/"
    cp -a "$core_dir/CMakeLists.txt" "$core_dir/cmake" "$core_dir/src" "$1/core/"
}

build_deb() {
    local tree="$work/tokkl-timerd-$native_version"
    copy_source "$tree"
    cp -a "$source_dir/debian" "$tree/"
    cat > "$tree/debian/changelog" <<EOF
tokkl-timerd ($native_version) resolute; urgency=medium

  * Tokkl $version.

 -- Tokkl contributors <contributors@example.invalid>  $(TZ=UTC date -R ${SOURCE_DATE_EPOCH:+-d "@$SOURCE_DATE_EPOCH"})
EOF
    (cd "$tree" && TOKKL_VERSION="$version" dpkg-buildpackage -b --no-sign)
    local deb="tokkl-timerd_${native_version}_amd64.deb"
    cp "$work/$deb" "$output/"
    echo "$output/$deb"
}

build_rpm() {
    local name="tokkl-timerd-$native_version"
    copy_source "$work/$name"
    mkdir -p "$work/rpmbuild/SOURCES"
    tar -C "$work" -czf "$work/rpmbuild/SOURCES/$name.tar.gz" "$name"
    rpmbuild -bb \
        --define "_topdir $work/rpmbuild" \
        --define "tokkl_version $version" \
        --define "tokkl_native_version $native_version" \
        "$source_dir/packaging/rpm/tokkl-timerd.spec"
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
