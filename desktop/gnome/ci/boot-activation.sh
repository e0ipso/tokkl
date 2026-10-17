#!/usr/bin/env bash
# Boots systemd in a privileged throwaway container, as its process 1, and
# has it run activation.sh systemd once the user manager of builder is up.
# activation.sh then ends the container with its result. ci/check.sh calls
# it after installing desktop/gnome, and scripts/container-check.sh after
# installing a package. The user builder must exist.
#
#   exec boot-activation.sh
#
# builder lingers, so its user manager and session bus start at boot. In
# these containers the user manager gets no XDG_RUNTIME_DIR from PAM and
# refuses to start, so a drop-in sets it.

set -euo pipefail

[ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

ci_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
init=/usr/sbin/init
[ -x "$init" ] || init=/sbin/init

echo "== booting systemd"
uid="$(id -u builder)"
# The check prints to ACTIVATION_LOG when the caller sets it to a file on a
# mount it reads after the container exits. Otherwise it prints to the
# terminal init inherits. A privileged container on a rootful engine may not
# show either terminal path in the job log, so callers should set the file.
if [ -n "${ACTIVATION_LOG:-}" ]; then
    output="append:$ACTIVATION_LOG"
    : > "$ACTIVATION_LOG"
else
    console="$(readlink -f "/proc/$$/fd/1")"
    case "$console" in
        /dev/pts/*|/dev/tty*) ;;
        *) console=/dev/console ;;
    esac
    output="tty"
fi
install -d /var/lib/systemd/linger /etc/systemd/system/user@.service.d
touch /var/lib/systemd/linger/builder
printf "%s\n" "[Service]" "Environment=XDG_RUNTIME_DIR=/run/user/%i" \
    > /etc/systemd/system/user@.service.d/runtime-dir.conf
printf "%s\n" "[Unit]" "Description=tokkl-timerd activation check" \
    "Wants=user@$uid.service" "After=user@$uid.service" \
    "[Service]" "Type=oneshot" "TimeoutStartSec=300" \
    "ExecStart=$ci_dir/activation.sh systemd" \
    "StandardOutput=$output" "StandardError=$output" "TTYPath=${console:-/dev/console}" \
    "[Install]" "WantedBy=multi-user.target" \
    > /etc/systemd/system/tokkl-activation-check.service
systemctl enable --quiet tokkl-activation-check.service
exec "$init" --show-status=no
