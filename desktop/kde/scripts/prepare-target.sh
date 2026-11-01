#!/usr/bin/env bash
# Prepares a disposable container as a packaging target.
#
#   prepare-target.sh --format deb|rpm [--build-deps] [--refresh | --upgrade]
#
# deb: a debian:trixie (Debian 13) system needs no extra repositories, only
#      its package lists.
# rpm: a fedora:44 system needs no extra repositories.
# --build-deps also installs the build dependencies from debian/control or
# packaging/rpm/tokkl-kde.spec. Without it the system stays clean apart from
# the package lists, ready for scripts/check-package.sh. --refresh fetches
# the package lists or repository metadata again, for a target container
# made from an image built on an earlier day. --upgrade fetches them again and
# upgrades every installed package to the archive's current version, so a
# build environment made on an earlier day builds against the libraries a
# clean target installs.
#
# Run as root. It changes the system's packages, so only use it in a container.

set -euo pipefail

usage() {
    echo "usage: $0 --format deb|rpm [--build-deps] [--refresh | --upgrade]" >&2
    exit 2
}

format=""
build_deps=false
refresh=false
upgrade=false
while [ $# -gt 0 ]; do
    case "$1" in
        --format) format="${2-}"; shift 2 || usage ;;
        --build-deps) build_deps=true; shift ;;
        --refresh) refresh=true; shift ;;
        --upgrade) upgrade=true; shift ;;
        *) usage ;;
    esac
done

if $refresh && $upgrade; then
    usage
fi

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

prepare_deb() {
    export DEBIAN_FRONTEND=noninteractive
    # A second run, for example to add the build dependencies to a prepared
    # image, keeps the package lists it finds unless --refresh asks for new
    # ones.
    if $refresh || $upgrade || ! compgen -G "/var/lib/apt/lists/*_Packages*" > /dev/null; then
        apt-get update -q
    fi
    if $upgrade; then
        # full-upgrade, as a library whose soname changed comes in a package
        # with a new name, which plain upgrade holds back.
        apt-get full-upgrade -y -q --no-install-recommends
    fi

    if $build_deps; then
        apt-get install -y -q --no-install-recommends build-essential dpkg-dev
        apt-get build-dep -y -q "$source_dir"
    fi
}

prepare_rpm() {
    if $refresh; then
        dnf makecache -q --refresh
    fi
    if $upgrade; then
        dnf upgrade -y -q --refresh
    fi
    if $build_deps; then
        dnf install -y -q rpm-build
        # Any version will do: builddep only reads the BuildRequires.
        dnf builddep -y -q -D "tokkl_version 0.0.0" \
            -D "tokkl_native_version 0.0.0" "$source_dir/packaging/rpm/tokkl-kde.spec"
    fi
}

case "$format" in
    deb) prepare_deb ;;
    rpm) prepare_rpm ;;
    *) usage ;;
esac
