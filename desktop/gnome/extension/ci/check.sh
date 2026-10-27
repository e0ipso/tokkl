#!/usr/bin/env bash
# Checks the GNOME Shell extension on every Shell version metadata.json
# lists, each in a throwaway container of a distribution that ships it. For
# each one, shell-test.sh packs and installs the extension and runs it in a
# headless GNOME Shell against mock-timer.js, a stand-in for tokkl-timerd.
#
#   check.sh [VERSION...]
#
# With no argument it checks every listed version; a version without an
# image here is an error. The repository is mounted read-only, and the
# checks run as an unprivileged user. CONTAINER_ENGINE defaults to docker.
# Images are pinned by digest; their package repositories are not, so the
# Shell's patch release is whatever they hold on the day of the run.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"

image_for() {
    case "$1" in
        46) echo "ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55" ;;
        47) echo "fedora:41@sha256:f1a3fab47bcb3c3ddf3135d5ee7ba8b7b25f2e809a47440936212a3a50957f3d" ;;
        48) echo "fedora:42@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814" ;;
        49) echo "fedora:43@sha256:a651ddf48ea28a06ed4e1e6519f51c9f47e7a5a138722ade87369b8fbb7e5b42" ;;
        50) echo "fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80" ;;
        51) echo "fedora:45@sha256:aacbc26b38361ba0cb3d10f268da40b61b36aed6ed6fe5831a35871636bedb06" ;;
        *) return 1 ;;
    esac
}

if [ $# -gt 0 ]; then
    versions=("$@")
else
    mapfile -t versions < <(sed -n '/"shell-version"/,/]/p' "$repo/desktop/gnome/extension/metadata.json" \
        | grep -o '"[0-9][0-9]*"' | tr -d '"')
fi

failed=()
for version in "${versions[@]}"; do
    image="$(image_for "$version")" || { echo "error: no image for GNOME Shell $version" >&2; exit 2; }
    echo "==== GNOME Shell $version in ${image%@*}"
    # shellcheck disable=SC2016
    if ! "$engine" run --rm -e LANG=C.UTF-8 -e SHELL_VERSION="$version" -v "$repo:/repo:ro" "$image" bash -euc '
        if command -v dnf > /dev/null; then
            dnf install -y -q --setopt=install_weak_deps=False gnome-shell gjs dbus-daemon dbus-tools \
                dconf glib2 unzip google-noto-sans-fonts python3-dbusmock > /tmp/install.log 2>&1 \
                || { cat /tmp/install.log; exit 1; }
        else
            export DEBIAN_FRONTEND=noninteractive
            # librsvg2-common holds the SVG loader the Shell draws the
            # hourglass with; a desktop install gets it as a recommendation.
            { apt-get update -q && apt-get install -y -q --no-install-recommends gnome-shell \
                gnome-shell-extension-prefs gjs dbus dbus-user-session dconf-service libglib2.0-bin \
                librsvg2-common unzip fonts-dejavu-core python3-dbusmock; } > /tmp/install.log 2>&1 \
                || { cat /tmp/install.log; exit 1; }
        fi
        actual="$(gnome-shell --version | grep -o "[0-9][0-9]*" | head -1)"
        [ "$actual" = "$SHELL_VERSION" ] \
            || { echo "error: the image has GNOME Shell $actual, not $SHELL_VERSION" >&2; exit 1; }
        # GNOME Shell needs a system bus with logind on it. python-dbusmock
        # stands in for logind, as in GNOME Shell'"'"'s own tests.
        install -d /run/dbus
        dbus-daemon --system --fork
        python3 -m dbusmock --system --template logind > /tmp/logind.log 2>&1 &
        gdbus wait --system --timeout 30 org.freedesktop.login1
        useradd --create-home tester
        # The session bus starts dconf and the other services, so it needs
        # the runtime directory as much as GNOME Shell does.
        runtime="/run/user/$(id -u tester)"
        install -d -m 700 -o tester "$runtime"
        runuser -u tester -- env XDG_RUNTIME_DIR="$runtime" \
            dbus-run-session -- /repo/desktop/gnome/extension/ci/shell-test.sh /repo
    '; then
        failed+=("$version")
    fi
done

if [ ${#failed[@]} -gt 0 ]; then
    echo "error: the check failed on GNOME Shell ${failed[*]}" >&2
    exit 1
fi
echo "passed on GNOME Shell ${versions[*]}"
