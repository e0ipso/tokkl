#!/usr/bin/env bash
# Inspects a tokkl-kde DEB or RPM, then installs, upgrades and removes it.
#
#   check-package.sh --version <version> --package <file> [--previous <file>]
#                    [--load-test <dir>]
#
# Run it as root on a disposable target system (a container) that has the
# distribution's repositories, so the package manager can install the runtime
# dependencies: Debian 13 or Ubuntu 26.04 for its .deb, Fedora 44 for a .rpm. It changes
# the system's packages, so never run it on a real desktop.
#
# Steps:
#   1. Inspect the file: name, native version, architecture, the MIT license
#      and its text, the widget and backend paths, the declared library and
#      QML dependencies, no files outside /usr and no maintainer scripts.
#   2. Clean install: the widget metadata carries the Tokkl version, the
#      backend's libraries resolve and the package manager's verify is clean.
#      With --load-test, the installed widget and backend then load through
#      libplasma under Xvfb and a DBus session: <dir> holds the smokeload
#      binary built for this target and packages.txt, the packages it needs
#      (its libraries, Xvfb and DBus), which are installed first.
#   3. Remove: no widget or backend files are left. The removal keeps the
#      dependencies the install brought in, so dependency autoremove is not
#      checked.
#   4. With --previous (an older tokkl-kde, a build of this source or a
#      published release): before anything is installed, check that it is a
#      tokkl-kde package for this architecture and, for an RPM, this
#      distribution release, with a version older than <file>'s. After the
#      first removal install it, upgrade to <file>,
#      check that only the new package's files are present, load it again
#      with --load-test, then remove it (purge on Debian).
# A fixture home with Plasma applet settings and a KDE Wallet file is created
# first and must be byte-for-byte unchanged after every removal.

set -euo pipefail

usage() {
    echo "usage: $0 --version <version> --package <file> [--previous <file>] [--load-test <dir>]" >&2
    exit 2
}

version=""
package=""
previous=""
load_test=""
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version="${2-}"; shift 2 || usage ;;
        --package) package="${2-}"; shift 2 || usage ;;
        --previous) previous="${2-}"; shift 2 || usage ;;
        --load-test) load_test="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
[ -n "$version" ] && [ -n "$package" ] || usage

native_version="$("$(dirname "${BASH_SOURCE[0]}")/native-version.sh" "$version")" || exit 2

package="$(realpath "$package")"
[ -z "$previous" ] || previous="$(realpath "$previous")"
[ -z "$load_test" ] || load_test="$(realpath "$load_test")"

plasmoid_id="com.github.e0ipso.tokkl"
widget_dir="/usr/share/plasma/plasmoids/$plasmoid_id"
# The widget picker's icon in every hicolor size the package installs; the
# 96px one is a copy of the panel logo in the widget.
icon_dir=/usr/share/icons
icon_sizes="32 48 64 96 128 256"
icon_file() { echo "$icon_dir/hicolor/${1}x${1}/apps/$plasmoid_id.png"; }
icon_files="$(for size in $icon_sizes; do icon_file "$size"; done)"

case "$package" in
    *.deb)
        format=deb
        backend_dir="/usr/lib/x86_64-linux-gnu/qt6/qml/com/github/e0ipso/tokkl/backend"
        expected_arch=amd64
        license_file=/usr/share/doc/tokkl-kde/copyright
        # dpkg-shlibdeps adds the libraries; debian/control adds the QML modules.
        # libqt6multimedia6 plays the Pomodoro alarm and carries its media
        # plugin and PulseAudio output.
        expected_deps="hicolor-icon-theme libkf6wallet6 libqt6core6t64 libqt6multimedia6 libqt6network6 libqt6qml6
            plasma-desktoptheme qml6-module-org-kde-kcmutils qml6-module-org-kde-kirigami
            qml6-module-qtqml qml6-module-qtquick qml6-module-qtquick-controls
            qml6-module-qtquick-layouts qml6-module-qtquick-templates"
        case "$package" in
            *-ubuntu26.04.deb) expected_deps="$expected_deps libplasma7" ;;
            *) expected_deps="$expected_deps libplasma6" ;;
        esac
        ;;
    *.rpm)
        format=rpm
        backend_dir="/usr/lib64/qt6/qml/com/github/e0ipso/tokkl/backend"
        expected_arch=x86_64
        license_file=/usr/share/licenses/tokkl-kde/LICENSE
        # rpm finds the libraries; the spec adds the QML modules, floors and
        # the Qt Multimedia package that holds the alarm's media plugins.
        expected_deps="hicolor-icon-theme libKF6Wallet.so.6()(64bit) libQt6Core.so.6()(64bit)
            libQt6Multimedia.so.6()(64bit) qt6-qtmultimedia(x86-64)
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

# The four Pomodoro alarm sounds the widget bundles, which the alarm player
# resolves inside the installed widget.
sound_files="$(for sound in work-to-short-rest short-rest-to-work work-to-long-rest long-rest-to-work; do
    echo "$widget_dir/contents/sounds/pomodoro-$sound.wav"
done)"

expected_files="$widget_dir/metadata.json
$widget_dir/contents/ui/main.qml
$widget_dir/contents/config/main.xml
$sound_files
$icon_files
$backend_dir/qmldir
$backend_dir/libtokklbackend.so
$backend_dir/tokklbackend.qmltypes
$license_file"

failures=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
expect() { # <ok message> <failure message> <command...>
    local ok="$1" bad="$2"
    shift 2
    if "$@"; then pass "$ok"; else fail "$bad"; fi
}
same_contents() {
    [ -f "$1" ] && [ -f "$2" ] && [ "$(sha256sum < "$1")" = "$(sha256sum < "$2")" ]
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
pkg_license() { # <file>: the declared license
    if [ "$format" = deb ]; then
        dpkg-deb --fsys-tarfile "$1" | tar -xO ".$license_file" \
            | sed -n 's/^License: *//p' | sort -u
    else
        rpm -qp --qf '%{LICENSE}' "$1"
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
# Removes tokkl-kde only. apt-get never removes the dependencies with it; dnf
# does by default, so --no-autoremove keeps them for the next install in this
# disposable system. Removing dependencies nothing else needs is the package
# manager's job, so these checks leave it out.
remove_package() { # [purge]: Debian only, also drops the package's configuration
    if [ "$format" = deb ]; then
        DEBIAN_FRONTEND=noninteractive apt-get "${1:-remove}" -y -q tokkl-kde
    else
        dnf remove -y -q --no-autoremove tokkl-kde
    fi
}
target_versions() { # the Qt, KDE Frameworks and Plasma packages installed
    if [ "$format" = deb ]; then
        dpkg-query -W libqt6core6t64 libkf6wallet6 plasma-desktoptheme
    else
        rpm -q qt6-qtbase kf6-kwallet-libs libplasma
    fi | sed 's/^/target: /'
}
install_names() { # package names from the repositories
    if [ "$format" = deb ]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$@"
    else
        dnf install -y -q "$@"
    fi
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
    got="$(pkg_license "$file")"
    expect "license MIT" "license is '$got'" [ "$got" = MIT ]

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
    expect "widget picker icon matches the bundled logo" \
        "widget picker icon is missing or differs from the bundled logo" \
        same_contents "$(icon_file 96)" "$widget_dir/contents/images/tokkl.png"
    expect "backend qmldir names com.github.e0ipso.tokkl.backend" \
        "backend qmldir does not name com.github.e0ipso.tokkl.backend" \
        grep -qx "module com.github.e0ipso.tokkl.backend" "$backend_dir/qmldir"

    # ldd fails on a file that is not a dynamic ELF object; a missing library
    # shows as "not found" with a zero exit status.
    local ldd_out ldd_status=0
    ldd_out="$(ldd "$backend_dir/libtokklbackend.so" 2>&1)" || ldd_status=$?
    if [ "$ldd_status" -ne 0 ]; then
        fail "ldd failed on the backend (exit $ldd_status): $(tr '\n' ' ' <<<"$ldd_out")"
    elif grep -q 'not found' <<<"$ldd_out"; then
        fail "backend libraries missing: $(grep 'not found' <<<"$ldd_out" | tr '\n' ' ')"
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

# Loads the installed widget and backend the way Plasma does, with the
# smokeload test from the build: the package from the data dirs, the backend
# from Qt's QML directory, the applet in a containment, its configuration
# and Configure page. A real X server (Xvfb) and a private DBus session
# stand in for the desktop session; the home directory is a throwaway one.
loaded_once=false
check_loads() {
    [ -n "$load_test" ] || return 0
    if ! $loaded_once; then
        local packages
        mapfile -t packages < "$load_test/packages.txt"
        install_names "${packages[@]}" > /dev/null
        loaded_once=true
    fi
    local home session_config status=0
    home="$(mktemp -d)"
    session_config="$(realpath "$(dirname "${BASH_SOURCE[0]}")/smoke-session.conf")"
    (cd "$home" && env HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" \
        XDG_CACHE_HOME="$home/cache" XDG_STATE_HOME="$home/state" \
        QT_QPA_PLATFORM=xcb QT_QUICK_BACKEND=software \
        TOKKL_SMOKE_PLASMOID_DIR="$widget_dir" TOKKL_SMOKE_BACKEND_DIR="$backend_dir" \
        TOKKL_SMOKE_ICON_DIR="$icon_dir" \
        dbus-run-session --config-file "$session_config" \
            -- xvfb-run -a "$load_test/smokeload") || status=$?
    rm -rf "$home"
    if [ "$status" -eq 0 ]; then
        pass "widget and backend load from the installed package under Xvfb and DBus"
    else
        fail "widget or backend failed to load from the installed package (exit $status)"
    fi
}

check_removed() {
    expect "tokkl-kde is not installed" "tokkl-kde is still installed" [ -z "$(installed_version)" ]
    while IFS= read -r path; do
        expect "$path is gone" "$path is left behind" [ ! -e "$path" ]
    done <<<"$icon_files"
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

# The previous package may come from a download, so it has to be the same
# package for the same target, and older, before it is installed.
check_previous() {
    local field got
    step "check the previous package $(basename "$previous")"
    case "$previous" in
        *."$format") ;;
        *) echo "error: the previous package $previous is not a .$format" >&2; exit 1 ;;
    esac
    for field in Package Architecture Version; do
        got="$(pkg_field "$previous" "$field" 2>&1)" && [ -n "$got" ] \
            || { echo "error: cannot read the $field of $previous: $got" >&2; exit 1; }
        case "$field" in
            Package) [ "$got" = tokkl-kde ] \
                || { echo "error: $previous is the package $got, not tokkl-kde" >&2; exit 1; } ;;
            Architecture) [ "$got" = "$expected_arch" ] \
                || { echo "error: $previous is for $got, not $expected_arch" >&2; exit 1; } ;;
            Version) previous_version="$got" ;;
        esac
    done
    if [ "$format" = deb ]; then
        dpkg --compare-versions "$previous_version" lt "$native_version"
    else
        local release dist
        release="$(rpm -qp --qf '%{RELEASE}' "$previous")"
        dist="$(rpm --eval '%{?dist}')"
        [ -n "$dist" ] && [ "${release%"$dist"}" != "$release" ] \
            || { echo "error: $previous has release $release, not one for this system's $dist" >&2; exit 1; }
        [ "$(OLD="$previous_version" NEW="$native_version" \
            rpm --eval '%{lua: print(rpm.vercmp(os.getenv("OLD"), os.getenv("NEW")))}')" = -1 ]
    fi || { echo "error: previous version $previous_version is not older than $native_version" >&2; exit 1; }
    pass "previous package is tokkl-kde $previous_version for $expected_arch, older than $native_version"
}
previous_version=""
[ -z "$previous" ] || check_previous

step "clean install of $native_version"
install_file "$package"
target_versions
check_installed "$native_version" "$version" "$package"
check_loads

step "remove $native_version"
remove_package
check_removed

if [ -n "$previous" ]; then
    step "install $previous_version, then upgrade to $native_version"
    install_file "$previous"
    got="$(installed_version)"
    expect "installed version $previous_version" \
        "installed version is '$got', expected $previous_version" \
        [ "$got" = "$previous_version" ]
    upgrade_file "$package"
    check_installed "$native_version" "$version" "$package"
    check_loads

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
