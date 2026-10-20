#!/usr/bin/env bash
# Prints the distribution, Qt, KDE Frameworks and Plasma versions of a build
# environment and fails when they are older than the supported baseline.
#
#   baseline.sh --format deb|ubuntu-deb|rpm
#
# deb: Debian 13 with at least Qt 6.8.2, KDE Frameworks 6.13.0 and Plasma
#      6.3.5, the versions it was released with.
# ubuntu-deb: Ubuntu 26.04 with at least Qt 6.10.2, KDE Frameworks 6.24.0
#             and Plasma 6.6.4.
# rpm: Fedora 44 with at least Qt 6.10.2, KDE Frameworks 6.24.0 and Plasma
#      6.6.0; its updates are newer.
#
# Prints the distribution and one "<part> <package> <version>" line per
# library on stdout, and failures on stderr.

set -euo pipefail

usage() {
    echo "usage: $0 --format deb|ubuntu-deb|rpm" >&2
    exit 2
}

format=""
while [ $# -gt 0 ]; do
    case "$1" in
        --format) format="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done

# shellcheck disable=SC1091
. /etc/os-release
failures=0
fail() { echo "error: $*" >&2; failures=$((failures + 1)); }

# Each library is looked up by file name without its SONAME version (libplasma
# 6.6 ships libPlasma.so.7), so the package that ships it is found whatever the
# distribution calls it.
case "$format" in
    deb|ubuntu-deb)
        if [ "$format" = deb ]; then
            [ "$ID" = debian ] && [ "${VERSION_ID-}" = 13 ] || fail "expected Debian 13, found $ID ${VERSION_ID-}"
            libraries="qt:libQt6Core.so:6.8.2 kf:libKF6Wallet.so:6.13.0 plasma:libPlasma.so:6.3.5"
        else
            [ "$ID" = ubuntu ] && [ "${VERSION_ID-}" = 26.04 ] || fail "expected Ubuntu 26.04, found $ID ${VERSION_ID-}"
            libraries="qt:libQt6Core.so:6.10.2 kf:libKF6Wallet.so:6.24.0 plasma:libPlasma.so:6.6.4"
        fi
        owner() { dpkg -S "*/$1.*" 2>/dev/null | head -n 1 | cut -d: -f1; }
        installed() { dpkg-query -W -f '${Version}' "$1"; }
        # True when $1 >= $2 in dpkg order.
        at_least() { dpkg --compare-versions "$1" ge "$2"; }
        ;;
    rpm)
        [ "$ID" = fedora ] && [ "$VERSION_ID" = 44 ] || fail "expected Fedora 44, found $ID $VERSION_ID"
        owner() {
            local file
            file="$(compgen -G "/usr/lib64/$1.*" | head -n 1)" && rpm -qf --qf '%{NAME}\n' "$file"
        }
        installed() { rpm -q --qf '%{VERSION}-%{RELEASE}' "$1"; }
        at_least() {
            [ "$(A="$1" B="$2" rpm --eval '%{lua: print(rpm.vercmp(os.getenv("A"), os.getenv("B")))}')" -ge 0 ]
        }
        libraries="qt:libQt6Core.so:6.10.2 kf:libKF6Wallet.so:6.24.0 plasma:libPlasma.so:6.6.0"
        ;;
    *) usage ;;
esac

echo "os $PRETTY_NAME"
for entry in $libraries; do
    IFS=: read -r label library minimum <<<"$entry"
    package="$(owner "$library")" || package=""
    if [ -z "$package" ] || ! version="$(installed "$package" 2>/dev/null)" || [ -z "$version" ]; then
        fail "no installed package ships $library ($label)"
        continue
    fi
    echo "$label $package $version"
    # The upstream part of the version, before any Debian or Fedora suffix.
    upstream="${version#*:}"
    upstream="${upstream%%[-+~]*}"
    at_least "$upstream" "$minimum" || fail "$package $version is older than $minimum"
done

[ "$failures" -eq 0 ]
