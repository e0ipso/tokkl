#!/usr/bin/env bash
# Builds and checks the GNOME release files in throwaway containers, so the
# host's packages are never touched. CI and the release run it.
#
#   container-check.sh --version <version> --output <dir> [--format deb|rpm|zip|all]
#
#   deb  tokkl-timerd_<native>_amd64.deb for Ubuntu 26.04 LTS
#   rpm  tokkl-timerd-<native>-1.fc44.x86_64.rpm for Fedora 44
#   zip  tokkl-gnome-extension-<version>.zip, the GNOME Shell extension
#
# <native> is the version desktop/kde/scripts/native-version.sh makes of
# <version>. For deb and rpm, a build container runs scripts/package-release.sh,
# then a fresh privileged container of the same image runs
# scripts/check-package.sh: install with the declared dependencies, version,
# files, and D-Bus activation of the service with and without systemd. For
# zip, a Fedora 44 container with GNOME Shell runs scripts/pack-extension.sh,
# which packs, checks and installs the zip. Every container is removed
# afterwards; the files stay in <dir>.
#
# Images are pinned by digest; their package repositories are not, so Qt and
# GNOME Shell are whatever they hold on the day of the run. The repository is
# mounted read-only. CONTAINER_ENGINE defaults to docker.

set -euo pipefail

usage() {
    echo "usage: $0 --version <version> --output <dir> [--format deb|rpm|zip|all]" >&2
    exit 2
}

version=""
output=""
formats="deb rpm zip"
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        --format)
            case "${2-}" in
                deb|rpm|zip) formats="$2" ;;
                all) formats="deb rpm zip" ;;
                *) usage ;;
            esac
            shift 2 ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$output" ] || usage

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
native_version="$("$repo/desktop/kde/scripts/native-version.sh" "$version")" || exit 2
engine="${CONTAINER_ENGINE:-docker}"
ubuntu="ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7"
fedora="fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
build_env=()
[ -z "${SOURCE_DATE_EPOCH:-}" ] || build_env=(-e "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH")

# Runs a script in a fresh container of an image with the repository at
# /repo (read-only) and the output at /out.
in_container() {
    local image="$1"
    shift
    "$engine" run --rm -e LANG=C.UTF-8 "${build_env[@]}" \
        -v "$repo:/repo:ro" -v "$output:/out" "$image" bash -euc "$@"
}

# Installs and checks a package in a fresh container that boots systemd
# for the last step, as desktop/gnome/ci/check.sh does.
check_package() {
    local image="$1" package="$2"
    "$engine" run --rm -t --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
        -e container=docker -e LANG=C.UTF-8 -v "$repo:/repo:ro" -v "$output:/out:ro" "$image" \
        /repo/desktop/gnome/scripts/check-package.sh --version "$version" --package "/out/$package"
}

for format in $formats; do
    case "$format" in
        deb)
            echo "== deb: build tokkl-timerd $version in ${ubuntu%@*}"
            rm -f "$output/tokkl-timerd_${native_version}_amd64.deb"
            # shellcheck disable=SC2016
            in_container "$ubuntu" '
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y -qq --no-install-recommends build-essential debhelper cmake \
                    qt6-base-dev qtkeychain-qt6-dev > /tmp/install.log 2>&1 || { cat /tmp/install.log; exit 1; }
                echo "Qt $(dpkg-query -W -f "\${Version}" qt6-base-dev)"
                /repo/desktop/gnome/scripts/package-release.sh --version "$1" --format deb --output /out
            ' bash "$version"
            echo "== deb: install and check in a clean ${ubuntu%@*}"
            check_package "$ubuntu" "tokkl-timerd_${native_version}_amd64.deb"
            ;;
        rpm)
            echo "== rpm: build tokkl-timerd $version in ${fedora%@*}"
            rm -f "$output/tokkl-timerd-${native_version}"-1.*.x86_64.rpm
            # shellcheck disable=SC2016
            in_container "$fedora" '
                dnf install -y -q --setopt=install_weak_deps=False rpm-build cmake gcc-c++ make \
                    systemd-rpm-macros qt6-qtbase-devel qtkeychain-qt6-devel > /tmp/install.log 2>&1 \
                    || { cat /tmp/install.log; exit 1; }
                echo "Qt $(rpm -q --qf "%{VERSION}" qt6-qtbase)"
                /repo/desktop/gnome/scripts/package-release.sh --version "$1" --format rpm --output /out
            ' bash "$version"
            rpm="$(cd "$output" && find . -maxdepth 1 -name "tokkl-timerd-${native_version}-1.*.x86_64.rpm" \
                | sed 's|^\./||')"
            [ "$(printf '%s\n' "$rpm" | grep -c .)" = 1 ] \
                || { echo "error: expected one tokkl-timerd RPM in $output, found: $rpm" >&2; exit 1; }
            echo "== rpm: install and check in a clean ${fedora%@*}"
            check_package "$fedora" "$rpm"
            ;;
        zip)
            echo "== zip: pack the extension for $version in ${fedora%@*}"
            rm -f "$output/tokkl-gnome-extension-$version.zip"
            # shellcheck disable=SC2016
            in_container "$fedora" '
                dnf install -y -q --setopt=install_weak_deps=False gnome-shell jq unzip > /tmp/install.log 2>&1 \
                    || { cat /tmp/install.log; exit 1; }
                echo "GNOME Shell $(rpm -q --qf "%{VERSION}" gnome-shell)"
                /repo/desktop/gnome/scripts/pack-extension.sh --version "$1" --output /out
            ' bash "$version"
            ;;
    esac
done
