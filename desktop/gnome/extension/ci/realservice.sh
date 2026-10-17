#!/usr/bin/env bash
# Checks the GNOME Shell extension end to end: a real tokkl-timerd, built
# from desktop/gnome, connected to a real Tokkl server. realservice.test.ts
# serves the server on 127.0.0.1 with the API's test fixtures and checks its
# data afterwards; in between, a throwaway Fedora 44 container (GNOME Shell
# 50, the image of desktop/gnome/ci/check.sh) on the host's network builds
# the service, then shell-test.sh --service installs the extension and runs
# realservice-check.js in a headless GNOME Shell.
#
#   realservice.sh
#
# It needs Node.js 24 and the repository's npm dependencies (npm ci) on the
# host. The repository is mounted read-only, and the build and checks run as
# an unprivileged user, because GNOME Keyring refuses to run as root.
# TOKKL_GNOME_TEST_PORT sets the server's port (default: any free port).
# CONTAINER_ENGINE defaults to docker.

set -euo pipefail

[ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"
image="fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80"

# shellcheck disable=SC2016
container='
    dnf install -y -q --setopt=install_weak_deps=False gnome-shell gjs dbus-daemon dbus-tools \
        dconf glib2 unzip google-noto-sans-fonts python3-dbusmock \
        cmake gcc-c++ make qt6-qtbase-devel qtkeychain-qt6-devel libsecret gnome-keyring \
        > /tmp/install.log 2>&1 || { cat /tmp/install.log; exit 1; }
    echo "== $(gnome-shell --version), Qt $(rpm -q --qf "%{VERSION}" qt6-qtbase), QtKeychain $(rpm -q --qf "%{VERSION}" qtkeychain-qt6)"
    useradd --create-home tester
    install -d -o tester /tmp/build
    runuser -u tester -- cmake -S /repo/desktop/gnome -B /tmp/build -DBUILD_TESTING=OFF > /tmp/build.log 2>&1 \
        && runuser -u tester -- cmake --build /tmp/build -j"$(nproc)" --target tokkl-timerd >> /tmp/build.log 2>&1 \
        || { cat /tmp/build.log; exit 1; }
    # GNOME Shell needs a system bus with logind on it; python-dbusmock
    # stands in for logind, as in check.sh.
    install -d /run/dbus
    dbus-daemon --system --fork
    python3 -m dbusmock --system --template logind > /tmp/logind.log 2>&1 &
    gdbus wait --system --timeout 30 org.freedesktop.login1
    runtime="/run/user/$(id -u tester)"
    install -d -m 700 -o tester "$runtime"
    runuser -u tester -- env XDG_RUNTIME_DIR="$runtime" TOKKL_GNOME_FIXTURE="$TOKKL_GNOME_FIXTURE" \
        dbus-run-session -- /repo/desktop/gnome/extension/ci/shell-test.sh /repo --service /tmp/build/src/tokkl-timerd
'

TOKKL_GNOME_REALSERVICE_COMMAND="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' \
    "$engine" run --rm --network host -e LANG=C.UTF-8 -e TOKKL_GNOME_FIXTURE \
    -v "$repo:/repo:ro" "$image" bash -euc "$container")"
export TOKKL_GNOME_REALSERVICE_COMMAND
cd "$repo"
exec node --test desktop/gnome/extension/ci/realservice.test.ts
