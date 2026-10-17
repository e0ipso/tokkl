#!/usr/bin/env bash
# Installs a tokkl-timerd DEB or RPM on a clean target and checks it: the
# package version, the installed files, that the program finds every library
# it links, and that the first call to org.tokkl.Timer1 starts it, on a plain
# dbus-daemon and then through the systemd user unit. It changes the
# system's packages, so scripts/container-check.sh runs it in a privileged
# throwaway container of the target (Debian 13 or Fedora 44) with the
# repository at /repo, as root. The last step boots systemd as process 1;
# the container exits with the result of the activation check.
#
#   check-package.sh --version <version> --package <file>

set -euo pipefail

usage() {
    echo "usage: $0 --version <version> --package <file>" >&2
    exit 2
}

version=""
package=""
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --package) package="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$package" ] && [ -f "$package" ] || usage

gnome_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
native_version="$("$gnome_dir/../kde/scripts/native-version.sh" "$version")" || exit 2
status=0
fail() {
    echo "error: $*" >&2
    status=1
}

echo "== install $(basename "$package")"
case "$package" in
    *.deb)
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq --no-install-recommends "$package" > /tmp/install.log 2>&1 \
            || { cat /tmp/install.log; exit 1; }
        installed="$(dpkg-query -W -f '${Version}' tokkl-timerd)"
        scripts="$(dpkg-query --control-list tokkl-timerd | grep -Ev '^(md5sums|conffiles)$' || true)"
        ;;
    *.rpm)
        dnf install -y -q --setopt=install_weak_deps=False "$package" > /tmp/install.log 2>&1 \
            || { cat /tmp/install.log; exit 1; }
        installed="$(rpm -q --qf '%{VERSION}' tokkl-timerd)"
        scripts="$(rpm -q --scripts tokkl-timerd)"
        ;;
    *) usage ;;
esac

echo "package version: $installed"
[ "$installed" = "$native_version" ] || fail "the package has version $installed, expected $native_version"
[ -z "$scripts" ] || fail "the package has maintainer scripts: $scripts"
for file in /usr/bin/tokkl-timerd \
            /usr/share/dbus-1/services/org.tokkl.Timer1.service \
            /usr/lib/systemd/user/tokkl-timerd.service \
            /usr/share/dbus-1/interfaces/org.tokkl.Timer1.xml; do
    if [ -f "$file" ]; then
        echo "installed: $file"
    else
        fail "$file is not installed"
    fi
done
grep -qx "Exec=/usr/bin/tokkl-timerd" /usr/share/dbus-1/services/org.tokkl.Timer1.service \
    || fail "the activation file does not run /usr/bin/tokkl-timerd"
grep -qx "SystemdService=tokkl-timerd.service" /usr/share/dbus-1/services/org.tokkl.Timer1.service \
    || fail "the activation file does not name the systemd user unit"
# The program reports the release version (QCoreApplication's version).
grep -qaF "$version" /usr/bin/tokkl-timerd || fail "tokkl-timerd does not carry version $version"
# The dependencies the package declares bring every library the program
# links, before anything else is installed.
missing="$(ldd /usr/bin/tokkl-timerd | grep 'not found' || true)"
[ -z "$missing" ] || fail "tokkl-timerd lacks libraries: $missing"
[ "$status" -eq 0 ] || exit "$status"

echo "== tools for the activation check"
case "$package" in
    *.deb)
        apt-get install -y -qq --no-install-recommends dbus-daemon dbus-bin dbus-user-session \
            systemd systemd-sysv > /tmp/tools.log 2>&1 || { cat /tmp/tools.log; exit 1; }
        ;;
    *.rpm)
        dnf install -y -q --setopt=install_weak_deps=False dbus-daemon dbus-tools dbus-broker \
            systemd util-linux > /tmp/tools.log 2>&1 || { cat /tmp/tools.log; exit 1; }
        ;;
esac
useradd --create-home builder
runuser -u builder -- dbus-run-session -- "$gnome_dir/ci/activation.sh" bus
exec "$gnome_dir/ci/boot-activation.sh"
