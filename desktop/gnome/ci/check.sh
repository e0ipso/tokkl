#!/usr/bin/env bash
# Builds, tests and installs desktop/gnome (tokkl-timerd, with desktop/core)
# in a throwaway Fedora 44 container that has the Qt base and QtKeychain
# development packages, GNOME Keyring, dbus-daemon, CMake and a compiler. The
# Qt Gui runtime is removed before configuring, and tokkl-timerd may load no
# Qt library other than Core, Network and DBus, so the service stays headless.
# The install is checked for the program, the D-Bus activation file, the
# systemd user unit (with systemd-analyze verify) and the interface
# description. CI runs it.
#
#   check.sh
#
# GNOME Keyring refuses to run as root, so the build and tests run as an
# unprivileged user. Every test starts its own dbus-daemon; the user's session
# bus and keyring are never reached. The repository is mounted read-only, so
# the version comes from the root package.json and the build stays in the
# container. CONTAINER_ENGINE defaults to docker. The image is pinned by
# digest, as in desktop/core/ci/check.sh; Fedora's updates repository has no
# snapshots, so the Qt version is whatever it holds on the day of the run.

set -euo pipefail

[ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"
image="fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80"

# shellcheck disable=SC2016
"$engine" run --rm -e LANG=C.UTF-8 -v "$repo:/repo:ro" "$image" bash -euc '
    dnf install -y -q --setopt=install_weak_deps=False cmake gcc-c++ make qt6-qtbase-devel \
        qtkeychain-qt6-devel libsecret gnome-keyring dbus-daemon systemd \
        > /tmp/dnf.log 2>&1 || { cat /tmp/dnf.log; exit 1; }
    # The development package pulls in the Gui runtime. Remove it, so the
    # service can neither link nor load Qt Gui.
    rpm -e --nodeps qt6-qtbase-gui
    echo "== Qt $(rpm -q --qf "%{VERSION}" qt6-qtbase), QtKeychain $(rpm -q --qf "%{VERSION}" qtkeychain-qt6), without qt6-qtbase-gui"

    useradd --create-home builder
    install -d -o builder /tmp/build
    runuser -u builder -- cmake -S /repo/desktop/gnome -B /tmp/build -DCMAKE_INSTALL_PREFIX=/usr
    runuser -u builder -- cmake --build /tmp/build -j"$(nproc)"
    runuser -u builder -- ctest --test-dir /tmp/build --output-on-failure

    echo "== Qt libraries tokkl-timerd loads"
    libs="$(ldd /tmp/build/src/tokkl-timerd | grep -o "libQt6[A-Za-z]*" | sort -u | tr "\n" " ")"
    echo "tokkl-timerd: $libs"
    status=0
    for lib in $libs; do
        case "$lib" in
            libQt6Core|libQt6Network|libQt6DBus) ;;
            *) echo "error: tokkl-timerd loads $lib; the service may use only Qt Core, Network and DBus" >&2
               status=1 ;;
        esac
    done

    echo "== install"
    cmake --install /tmp/build > /tmp/install.log
    for file in /usr/bin/tokkl-timerd \
                /usr/share/dbus-1/services/org.tokkl.Timer1.service \
                /usr/lib/systemd/user/tokkl-timerd.service \
                /usr/share/dbus-1/interfaces/org.tokkl.Timer1.xml; do
        if [ -f "$file" ]; then
            echo "installed: $file"
        else
            echo "error: $file is not installed" >&2
            status=1
        fi
    done
    grep -qx "Exec=/usr/bin/tokkl-timerd" /usr/share/dbus-1/services/org.tokkl.Timer1.service \
        || { echo "error: the activation file does not run /usr/bin/tokkl-timerd" >&2; status=1; }
    grep -qx "SystemdService=tokkl-timerd.service" /usr/share/dbus-1/services/org.tokkl.Timer1.service \
        || { echo "error: the activation file does not name the systemd user unit" >&2; status=1; }
    systemd-analyze verify /usr/lib/systemd/user/tokkl-timerd.service || status=1
    exit "$status"
'
