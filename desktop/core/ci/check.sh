#!/usr/bin/env bash
# Builds and tests desktop/core on its own in a throwaway Fedora 44
# container that has the Qt base development packages, CMake and a compiler,
# and nothing from KDE. The Qt Gui runtime is removed before configuring, and
# the test binaries may load no Qt library other than Core, Network and Test,
# so a Gui or KDE dependency in the core fails the check. CI runs it.
#
#   check.sh
#
# The repository is mounted read-only, so the version comes from the root
# package.json and the build stays in the container. CONTAINER_ENGINE
# defaults to docker. The image is pinned by digest, as in the KDE CI images;
# Fedora's updates repository has no snapshots, so the Qt version is whatever
# it holds on the day of the run.

set -euo pipefail

[ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"
image="fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80"

# shellcheck disable=SC2016
"$engine" run --rm -e LANG=C.UTF-8 -v "$repo:/repo:ro" "$image" bash -euc '
    dnf install -y -q --setopt=install_weak_deps=False cmake gcc-c++ make qt6-qtbase-devel \
        > /tmp/dnf.log 2>&1 || { cat /tmp/dnf.log; exit 1; }
    # The development package pulls in the Gui runtime. Remove it, so the
    # core can neither link nor load Qt Gui.
    rpm -e --nodeps qt6-qtbase-gui
    echo "== Qt $(rpm -q --qf "%{VERSION}" qt6-qtbase), without qt6-qtbase-gui"

    cmake -S /repo/desktop/core -B /tmp/build
    cmake --build /tmp/build -j"$(nproc)"
    ctest --test-dir /tmp/build --output-on-failure

    echo "== Qt libraries the test binaries load"
    status=0
    tests="$(find /tmp/build/autotests -maxdepth 1 -type f -executable -name "*test")"
    [ -n "$tests" ] || { echo "error: no test binaries in /tmp/build/autotests" >&2; exit 1; }
    for test in $tests; do
        libs="$(ldd "$test" | grep -o "libQt6[A-Za-z]*" | sort -u | tr "\n" " ")"
        echo "$(basename "$test"): $libs"
        for lib in $libs; do
            case "$lib" in
                libQt6Core|libQt6Network|libQt6Test) ;;
                *) echo "error: $(basename "$test") loads $lib; the core may use only Qt Core, Network and Test" >&2
                   status=1 ;;
            esac
        done
    done
    exit "$status"
'
