#!/usr/bin/env bash
# Checks that the first call to org.tokkl.Timer1 starts the installed
# tokkl-timerd through D-Bus activation. check.sh runs it in its throwaway
# container after installing desktop/gnome to /usr, in two ways:
#
#   activation.sh bus      As the unprivileged user inside dbus-run-session:
#                          a dbus-daemon without systemd runs Exec= of the
#                          installed activation file.
#   activation.sh systemd  As root, from a system service once systemd has
#                          booted the container. The user's session bus
#                          (dbus-broker, which can only activate through
#                          systemd) starts the installed tokkl-timerd.service
#                          that SystemdService= names, then the script ends
#                          the container with its exit status.
#
# Either way the name has no owner before the call, the call returns the
# Status of a service with no settings ("unconfigured"), and the owner runs
# /usr/bin/tokkl-timerd and stops on SIGTERM. Through systemd the owner is
# also the main process of the unit, which was inactive before the call.

set -uo pipefail

service=org.tokkl.Timer1
program=/usr/bin/tokkl-timerd
unit=tokkl-timerd.service
mode="${1:-}"
status=0

fail() {
    echo "error: $*" >&2
    status=1
}

case "$mode" in
    bus)
        run() { "$@"; }
        ;;
    systemd)
        # Whatever happens, end the container with the result.
        trap 'systemctl exit "$status"' EXIT
        trap 'status=1; exit' TERM
        uid="$(id -u builder)"
        run() { runuser -u builder -- env XDG_RUNTIME_DIR="/run/user/$uid" "$@"; }
        # builder lingers, so its user manager starts at boot.
        for _ in $(seq 60); do
            [ -S "/run/user/$uid/bus" ] && break
            sleep 1
        done
        echo "user manager: $(run systemctl --user is-system-running --wait)"
        echo "session bus: $(run systemctl --user show --property=Id --value dbus.service)"
        ;;
    *)
        echo "usage: $0 bus|systemd" >&2
        exit 2
        ;;
esac

driver() {
    run busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus "$@"
}

owner_pid() {
    driver GetConnectionUnixProcessID s "$service" | awk '{print $2}'
}

unit_property() {
    run systemctl --user show --property="$1" --value "$unit"
}

echo "== D-Bus activation through $mode"
driver ListActivatableNames | grep -q "\"$service\"" || fail "$service is not activatable"
[ "$(driver NameHasOwner s "$service")" = "b false" ] || fail "$service has an owner before the first call"
if [ "$mode" = systemd ]; then
    [ "$(unit_property ActiveState)" = inactive ] || fail "$unit runs before the first call"
fi

reply="$(run busctl --user --timeout=30 get-property "$service" /org/tokkl/Timer1 "$service" Status)" \
    || fail "the first call to $service failed"
echo "Status: $reply"
[ "$reply" = 's "unconfigured"' ] || fail "Status is $reply, expected \"unconfigured\""

pid="$(owner_pid)"
[ -n "$pid" ] || { fail "$service has no owner after the call"; exit "$status"; }
exe="$(readlink "/proc/$pid/exe")"
echo "owner: pid $pid, $exe"
[ "$exe" = "$program" ] || fail "$service is owned by $exe, not $program"

if [ "$mode" = systemd ]; then
    echo "$unit: $(unit_property ActiveState), main pid $(unit_property MainPID)"
    [ "$(unit_property ActiveState)" = active ] || fail "$unit is not active"
    [ "$(unit_property MainPID)" = "$pid" ] || fail "the owner of $service is not the main process of $unit"
    run systemctl --user stop "$unit" || fail "$unit did not stop"
else
    kill -TERM "$pid"
    for _ in $(seq 20); do
        [ -d "/proc/$pid" ] || break
        sleep 0.5
    done
    [ -d "/proc/$pid" ] && fail "tokkl-timerd did not stop on SIGTERM"
fi
[ "$(driver NameHasOwner s "$service")" = "b false" ] || fail "$service still has an owner after the service stopped"

[ "$status" -eq 0 ] && echo "activation through $mode: ok"
exit "$status"
