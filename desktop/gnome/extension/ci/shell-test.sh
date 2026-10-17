#!/usr/bin/env bash
# Packs and installs the extension, then runs it in a headless GNOME Shell
# against mock-timer.js: shell-check.js drives the panel button and
# prefs-check.js the preferences. check.sh runs this in a container, as an
# unprivileged user inside dbus-run-session, with the repository at REPO.
#
#   shell-test.sh REPO

set -euo pipefail

[ $# -eq 1 ] || { echo "usage: $0 REPO" >&2; exit 2; }
repo="$1"
source_dir="$repo/desktop/gnome/extension"
ci="$source_dir/ci"
uuid="$(sed -n 's/^ *"uuid": *"\([^"]*\)".*/\1/p' "$source_dir/metadata.json")"
probe="probe@tokkl.test"
work="$(mktemp -d)"
extensions="$HOME/.local/share/gnome-shell/extensions"

[ -n "${XDG_RUNTIME_DIR:-}" ] || { echo "error: XDG_RUNTIME_DIR is not set" >&2; exit 2; }

shell_version="$(gnome-shell --version | grep -o '[0-9][0-9]*' | head -1)"
echo "== GNOME Shell $(gnome-shell --version | sed 's/GNOME Shell //'), GJS $(gjs --version | sed 's/gjs //')"

pids=()
# shellcheck disable=SC2329  # run by the EXIT trap
cleanup() {
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT

echo "== pack"
gnome-extensions pack "$source_dir" --force --out-dir="$work" \
    --extra-source=indicator.js --extra-source=timer1.js
zip="$work/$uuid.shell-extension.zip"
contents="$(unzip -Z1 "$zip" | sort)"
echo "$contents"
for file in metadata.json extension.js indicator.js timer1.js prefs.js stylesheet.css \
            schemas/org.gnome.shell.extensions.tokkl.gschema.xml; do
    grep -qx "$file" <<<"$contents" || { echo "error: the package lacks $file" >&2; exit 1; }
done
if grep -q '^tests/\|^ci/' <<<"$contents"; then
    echo "error: the package contains tests or CI files" >&2
    exit 1
fi
gnome-extensions install --force "$zip"
# The install compiles the settings schema.
[ -f "$extensions/$uuid/schemas/gschemas.compiled" ] \
    || { echo "error: the install did not compile the settings schema" >&2; exit 1; }

# A second extension, for this check only, that turns on unsafe mode so
# shell-check.js may use org.gnome.Shell.Eval.
install -d "$extensions/$probe"
printf '{"uuid": "%s", "name": "Eval probe", "description": "Test only", "shell-version": ["%s"]}\n' \
    "$probe" "$shell_version" > "$extensions/$probe/metadata.json"
cat > "$extensions/$probe/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class Probe extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
EOF

gsettings set org.gnome.shell enabled-extensions "['$uuid', '$probe']"
gsettings set org.gnome.shell disable-extension-version-validation false

start_mock() {
    echo "== mock org.tokkl.Timer1"
    gjs -m "$ci/mock-timer.js" "$repo/desktop/gnome/dbus/org.tokkl.Timer1.xml" &
    pids+=($!)
    gdbus wait --session --timeout 30 org.tokkl.Timer1
}
echo "== headless GNOME Shell"
gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 > "$work/shell.log" 2>&1 &
pids+=($!)
gdbus wait --session --timeout 60 org.gnome.Shell

status=0
# shell-check.js starts the mock itself, after it has checked the button
# without one, and stops it last.
gjs -m "$ci/shell-check.js" "$uuid" "$ci/mock-timer.js" "$repo/desktop/gnome/dbus/org.tokkl.Timer1.xml" \
    || status=1

start_mock
echo "== preferences"
WAYLAND_DISPLAY=wayland-0 gjs -m "$ci/prefs-check.js" "$uuid" || status=1

if grep -E 'JS ERROR|JS WARNING' "$work/shell.log" || grep -i "$uuid\|tokkl" "$work/shell.log"; then
    echo "error: GNOME Shell logged the messages above" >&2
    status=1
fi
if [ "$status" -ne 0 ]; then
    echo "== GNOME Shell log"
    cat "$work/shell.log"
fi
exit "$status"
