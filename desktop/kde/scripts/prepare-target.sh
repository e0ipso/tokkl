#!/usr/bin/env bash
# Prepares a disposable container as a packaging target.
#
#   prepare-target.sh --format deb|rpm [--build-deps]
#
# deb: a debian:trixie (Debian 13) system needs no extra repositories, only
#      its package lists.
# rpm: a fedora:44 system needs no extra repositories.
# --build-deps also installs the build dependencies from debian/control or
# packaging/rpm/tokkl-kde.spec. Without it the system stays clean apart from
# the package lists, ready for scripts/check-package.sh.
#
# Run as root. It changes the system's packages, so only use it in a container.

set -euo pipefail

usage() {
    echo "usage: $0 --format deb|rpm [--build-deps]" >&2
    exit 2
}

format=""
build_deps=false
while [ $# -gt 0 ]; do
    case "$1" in
        --format) format="${2-}"; shift 2 || usage ;;
        --build-deps) build_deps=true; shift ;;
        *) usage ;;
    esac
done

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

prepare_deb() {
    export DEBIAN_FRONTEND=noninteractive
    # A second run, for example to add the build dependencies to a prepared
    # image, keeps the package lists it finds.
    if ! compgen -G "/var/lib/apt/lists/*_Packages*" > /dev/null; then
        apt-get update -q
    fi

    if $build_deps; then
        apt-get install -y -q --no-install-recommends build-essential dpkg-dev
        apt-get build-dep -y -q "$source_dir"
    fi
}

prepare_rpm() {
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
