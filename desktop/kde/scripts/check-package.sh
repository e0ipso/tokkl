#!/usr/bin/env bash
# Inspects a tokkl-kde DEB or RPM, then installs, upgrades and removes it.
#
#   check-package.sh --version <semver> --package <file> [--previous <file>]
#
# Run it as root on a disposable target system (a container) that has the
# distribution's repositories, so the package manager can install the runtime
# dependencies: TUXEDO OS 24.04 for a .deb, Fedora 44 for a .rpm. It changes
# the system's packages, so never run it on a real desktop.
#
# Steps:
#   1. Inspect the file: name, native version, architecture, the widget and
#      backend paths, the declared library and QML dependencies, no files
#      outside /usr and no maintainer scripts.
#   2. Clean install: the widget metadata carries the Tokkl version, the
#      backend's libraries resolve and the package manager's verify is clean.
#   3. Remove: no widget or backend files are left.
#   4. With --previous (an older tokkl-kde): install it, upgrade to <file>,
#      check that only the new package's files are present, then remove it
#      (purge on Debian).
# A fixture home with Plasma applet settings and a KDE Wallet file is created
# first and must be byte-for-byte unchanged after every removal.

set -euo pipefail

usage() {
    echo "usage: $0 --version <semver> --package <file> [--previous <file>]" >&2
    exit 2
}

version=""
package=""
previous=""
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --package) package="${2-}"; shift 2 || usage ;;
        --previous) previous="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$package" ] || usage

semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
[[ "$version" =~ $semver ]] || { echo "error: \"$version\" is not a semantic version" >&2; exit 2; }
native_version="${version/-/\~}"

package="$(realpath "$package")"
[ -z "$previous" ] || previous="$(realpath "$previous")"

plasmoid_id="com.github.e0ipso.tokkl"
widget_dir="/usr/share/plasma/plasmoids/$plasmoid_id"

case "$package" in
    *.deb)
        format=deb
        backend_dir="/usr/lib/x86_64-linux-gnu/qt6/qml/com/github/e0ipso/tokkl/backend"
        expected_arch=amd64
        # dpkg-shlibdeps adds the libraries; debian/control adds the QML modules.
        expected_deps="libkf6wallet6 libqt6core6t64 libqt6network6 libqt6qml6
            plasma-desktoptheme qml6-module-org-kde-kcmutils qml6-module-org-kde-kirigami
            qml6-module-qtqml qml6-module-qtquick qml6-module-qtquick-controls
            qml6-module-qtquick-layouts qml6-module-qtquick-templates"
        ;;
    *.rpm)
        format=rpm
        backend_dir="/usr/lib64/qt6/qml/com/github/e0ipso/tokkl/backend"
        expected_arch=x86_64
        # rpm finds the libraries; the spec adds the QML modules and floors.
        expected_deps="libKF6Wallet.so.6()(64bit) libQt6Core.so.6()(64bit)
            libQt6Network.so.6()(64bit) libQt6Qml.so.6()(64bit) libplasma(x86-64)
            kf6-kirigami(x86-64) kf6-kcmutils(x86-64)
            qt6qml(org.kde.plasma.plasmoid) qt6qml(org.kde.plasma.core)
            qt6qml(org.kde.plasma.components) qt6qml(org.kde.plasma.configuration)
            qt6qml(org.kde.kirigami) qt6qml(org.kde.kcmutils) qt6qml(QtQml)
            qt6qml(QtQuick) qt6qml(QtQuick.Controls) qt6qml(QtQuick.Layouts)
            qt6qml(QtQuick.Templates)"
        ;;
    *) echo "error: $package is neither a .deb nor a .rpm" >&2; exit 2 ;;
esac

expected_files="$widget_dir/metadata.json
$widget_dir/contents/ui/main.qml
$widget_dir/contents/config/main.xml
$backend_dir/qmldir
$backend_dir/libtokklbackend.so
$backend_dir/tokklbackend.qmltypes"

failures=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
expect() { # <ok message> <failure message> <command...>
    local ok="$1" bad="$2"
    shift 2
    if "$@"; then pass "$ok"; else fail "$bad"; fi
}
step() { echo; echo "== $*"; }

# Package file helpers, per format.
pkg_field() { # <file> <Package|Version|Architecture>
    if [ "$format" = deb ]; then
        dpkg-deb -f "$1" "$2"
    else
        case "$2" in
            Package) rpm -qp --qf '%{NAME}' "$1" ;;
            Version) rpm -qp --qf '%{VERSION}' "$1" ;;
            Architecture) rpm -qp --qf '%{ARCH}' "$1" ;;
        esac
    fi
}
pkg_files() { # <file>: regular files and symlinks, one absolute path a line
    if [ "$format" = deb ]; then
        dpkg-deb --fsys-tarfile "$1" | tar -t | sed -n 's|^\./|/|p' | grep -v '/$' | sort
    else
        rpm -qp --qf '[%{FILENAMES} %{FILEMODES:perms}\n]' "$1" \
            | awk '$2 !~ /^d/ {print $1}' | sort
    fi
}
pkg_deps() { # <file>: dependency names, one a line
    if [ "$format" = deb ]; then
        dpkg-deb -f "$1" Depends | tr ',' '\n' | sed 's/^ *//; s/ .*//'
    else
        rpm -qpR "$1" | sed 's/ .*//'
    fi
}
pkg_has_scripts() {
    if [ "$format" = deb ]; then
        dpkg-deb --ctrl-tarfile "$1" | tar -t \
            | grep -qE '(^|/)(preinst|postinst|prerm|postrm|config|triggers)$'
    else
        [ -n "$(rpm -qp --scripts --triggers "$1")" ]
    fi
}
installed_version() {
    if [ "$format" = deb ]; then
        dpkg-query -W -f '${Status} ${Version}\n' tokkl-kde 2>/dev/null \
            | awk '$3 == "installed" {print $4}'
    else
        rpm -q --qf '%{VERSION}\n' tokkl-kde 2>/dev/null | grep -v 'not installed' || true
    fi
}
install_file() {
    if [ "$format" = deb ]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$1"
    else
        dnf install -y -q "$1"
    fi
}
upgrade_file() {
    if [ "$format" = deb ]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$1"
    else
        dnf upgrade -y -q "$1"
    fi
}
remove_package() { # [purge]: Debian only, also drops the package's configuration
    if [ "$format" = deb ]; then
        DEBIAN_FRONTEND=noninteractive apt-get "${1:-remove}" -y -q tokkl-kde
    else
        dnf remove -y -q tokkl-kde
    fi
}
target_versions() { # the Qt, KDE Frameworks and Plasma packages installed
    if [ "$format" = deb ]; then
        dpkg-query -W libqt6core6t64 libkf6wallet6 plasma-desktoptheme
    else
        rpm -q qt6-qtbase kf6-kwallet-libs libplasma
    fi | sed 's/^/target: /'
}
verify_installed() {
    if [ "$format" = deb ]; then
        dpkg --verify tokkl-kde
    else
        rpm -V tokkl-kde
    fi
}

inspect() { # <file> <native version>
    local file="$1" want="$2" got dep
    step "inspect $(basename "$file")"
    got="$(pkg_field "$file" Package)"
    expect "name tokkl-kde" "name is $got" [ "$got" = tokkl-kde ]
    got="$(pkg_field "$file" Version)"
    expect "version $want" "version is $got, expected $want" [ "$got" = "$want" ]
    got="$(pkg_field "$file" Architecture)"
    expect "architecture $expected_arch" "architecture is $got" [ "$got" = "$expected_arch" ]

    local files deps
    files="$(pkg_files "$file")"
    while IFS= read -r path; do
        expect "contains $path" "missing $path" grep -qxF "$path" <<<"$files"
    done <<<"$expected_files"
    if grep -v '^/usr/' <<<"$files" | grep -q .; then
        fail "files outside /usr: $(grep -v '^/usr/' <<<"$files" | tr '\n' ' ')"
    else
        pass "every file is under /usr"
    fi

    deps="$(pkg_deps "$file")"
    for dep in $expected_deps; do
        expect "depends on $dep" "does not depend on $dep" grep -qxF "$dep" <<<"$deps"
    done

    # Without maintainer scripts, installing and removing cannot touch home
    # directories or the wallet.
    if pkg_has_scripts "$file"; then
        fail "has maintainer scripts; check what they do to user data"
    else
        pass "no maintainer scripts"
    fi
}

check_installed() { # <native version> <semver> <file>
    local want="$1" semver_want="$2" file="$3" got metadata on_disk
    got="$(installed_version)"
    expect "installed version $want" "installed version is '$got', expected $want" \
        [ "$got" = "$want" ]

    metadata="$(sed -n 's/.*"Version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$widget_dir/metadata.json")"
    expect "widget metadata version $semver_want" \
        "widget metadata version is '$metadata', expected $semver_want" \
        [ "$metadata" = "$semver_want" ]
    expect "backend qmldir names com.github.e0ipso.tokkl.backend" \
        "backend qmldir does not name com.github.e0ipso.tokkl.backend" \
        grep -qx "module com.github.e0ipso.tokkl.backend" "$backend_dir/qmldir"

    if ldd "$backend_dir/libtokklbackend.so" | grep -q 'not found'; then
        fail "backend libraries missing: $(ldd "$backend_dir/libtokklbackend.so" | grep 'not found' | tr '\n' ' ')"
    else
        pass "backend libraries resolve"
    fi
    if out="$(verify_installed 2>&1)" && [ -z "$out" ]; then
        pass "package verify is clean"
    else
        fail "package verify: $out"
    fi

    # Only the installed package's files, nothing left from an older one.
    on_disk="$( { find "$widget_dir" "$(dirname "$backend_dir")" ! -type d; } | sort)"
    if [ "$on_disk" = "$(pkg_files "$file" | grep -E "^($widget_dir|$(dirname "$backend_dir"))/")" ]; then
        pass "installed files match the package"
    else
        fail "installed files differ from the package: $(diff <(echo "$on_disk") <(pkg_files "$file") | tr '\n' ' ')"
    fi
}

check_removed() {
    expect "tokkl-kde is not installed" "tokkl-kde is still installed" [ -z "$(installed_version)" ]
    for dir in "$widget_dir" "$(dirname "$(dirname "$backend_dir")")"; do
        expect "$dir is gone" "$dir is left behind" [ ! -e "$dir" ]
    done
    if (cd "$fixture_home" && sha256sum --quiet -c "$fixture_sums"); then
        pass "user settings and wallet files are unchanged"
    else
        fail "user settings or wallet files changed"
    fi
}

# A user's state: applet settings in the Plasma config and a wallet file.
# Neither belongs to the package, so removing it must leave both alone.
fixture_home="$(mktemp -d /home/tokkl-check.XXXXXX)"
fixture_sums="$(mktemp)"
trap 'rm -rf "$fixture_home" "$fixture_sums"' EXIT
mkdir -p "$fixture_home/.config" "$fixture_home/.local/share/kwalletd"
cat > "$fixture_home/.config/plasma-org.kde.plasma.desktop-appletsrc" <<'EOF'
[Containments][2][Applets][42]
immutability=1
plugin=com.github.e0ipso.tokkl

[Containments][2][Applets][42][Configuration][General]
authMode=token
instanceUrl=https://tokkl.example.test
EOF
head -c 4096 /dev/urandom > "$fixture_home/.local/share/kwalletd/kdewallet.kwl"
head -c 56 /dev/urandom > "$fixture_home/.local/share/kwalletd/kdewallet.salt"
(cd "$fixture_home" && find . -type f -exec sha256sum {} +) > "$fixture_sums"

[ -z "$(installed_version)" ] || { echo "error: tokkl-kde is already installed; use a clean system" >&2; exit 1; }

inspect "$package" "$native_version"

step "clean install of $native_version"
install_file "$package"
target_versions
check_installed "$native_version" "$version" "$package"

step "remove $native_version"
remove_package
check_removed

if [ -n "$previous" ]; then
    previous_version="$(pkg_field "$previous" Version)"
    if [ "$format" = deb ]; then
        dpkg --compare-versions "$previous_version" lt "$native_version"
    else
        [ "$(OLD="$previous_version" NEW="$native_version" \
            rpm --eval '%{lua: print(rpm.vercmp(os.getenv("OLD"), os.getenv("NEW")))}')" = -1 ]
    fi || { fail "previous version $previous_version is not older than $native_version"; exit 1; }

    step "install $previous_version, then upgrade to $native_version"
    install_file "$previous"
    got="$(installed_version)"
    expect "installed version $previous_version" \
        "installed version is '$got', expected $previous_version" \
        [ "$got" = "$previous_version" ]
    upgrade_file "$package"
    check_installed "$native_version" "$version" "$package"

    step "remove $native_version after the upgrade (purge on Debian)"
    remove_package purge
    check_removed
fi

echo
if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed for $(basename "$package")" >&2
    exit 1
fi
echo "all checks passed for $(basename "$package")"
