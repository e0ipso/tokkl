#!/usr/bin/env bash
# Prepares a disposable container as a packaging target.
#
#   prepare-target.sh --format deb|rpm [--build-deps]
#
# deb: an ubuntu:24.04 system gets the TUXEDO OS 24.04 repositories, whose
#      Qt, KDE Frameworks and Plasma replace Ubuntu's, so it matches TUXEDO OS.
# rpm: a fedora:44 system needs no extra repositories.
# --build-deps also installs the build dependencies from debian/control or
# packaging/rpm/tokkl-kde.spec. Without it the system stays clean apart from
# the repository setup, ready for scripts/check-package.sh.
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

# TUXEDO Computers GmbH archive key, published at
# https://deb.tuxedocomputers.com/0x54840598.pub.asc
tuxedo_key_url="https://deb.tuxedocomputers.com/0x54840598.pub.asc"
tuxedo_fingerprint="E5D0C320BBCE8D21CDF60DD5120ED28D54840598"

prepare_deb() {
    export DEBIAN_FRONTEND=noninteractive
    # A second run, for example to add the build dependencies to a prepared
    # image, keeps the repositories and package lists it finds.
    if [ ! -e /etc/apt/sources.list.d/tuxedo-os.sources ]; then
        add_tuxedo_repositories
    fi

    if $build_deps; then
        apt-get install -y -q --no-install-recommends build-essential dpkg-dev
        apt-get build-dep -y -q "$source_dir"
    fi
}

add_tuxedo_repositories() {
    apt-get update -q
    apt-get install -y -q --no-install-recommends ca-certificates curl gpg

    local key
    key="$(mktemp)"
    curl -fsSL "$tuxedo_key_url" -o "$key"
    if ! gpg --show-keys --with-colons "$key" | grep -qx "fpr:::::::::$tuxedo_fingerprint:"; then
        echo "error: $tuxedo_key_url is not the key $tuxedo_fingerprint" >&2
        exit 1
    fi
    gpg --dearmor < "$key" > /usr/share/keyrings/tuxedo-archive-keyring.gpg
    rm -f "$key"

    cat > /etc/apt/sources.list.d/tuxedo-os.sources <<'EOF'
Types: deb
URIs: https://txos.tuxedocomputers.com/ubuntu
Suites: noble
Components: main
Signed-By: /usr/share/keyrings/tuxedo-archive-keyring.gpg

Types: deb
URIs: https://txos.tuxedocomputers.com/ubuntu-plasma
Suites: noble noble-updates
Components: main
Signed-By: /usr/share/keyrings/tuxedo-archive-keyring.gpg
EOF
    apt-get update -q
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
