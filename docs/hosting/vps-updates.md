# Update a native VPS installation

[Documentation](../README.md) · [Hosting](README.md) · [Install Tokkl on a VPS](native-vps.md)

## Requirements

`scripts/update-vps.sh` updates the systemd installation at `/opt/tokkl` described
in the [native deployment guide](native-vps.md). It expects
the `tokkl.service` unit, the `tokkl` service account, Node 24 or newer, npm, curl,
tar and util-linux. The service must use `/opt/tokkl/current` as its working
directory and listen on `127.0.0.1:8080`. Keep only application release directories
directly under `/opt/tokkl/releases`: the updater prunes that directory after a
successful update. Data and configuration belong outside it.

## Install the updater

Install the script from a trusted checkout of this repository. Inspect the script
before installing it, since activation runs with root privileges:

```bash
sudo install -m 755 scripts/update-vps.sh /usr/local/sbin/tokkl-update
```

## Choose a version and update

Run it through sudo from a regular user account. Supply a version with or without
the `v` prefix, or omit it to select GitHub's latest published stable release:

```bash
sudo tokkl-update 2.4.0
sudo tokkl-update v2.4.0
sudo tokkl-update
```

An invalid or unavailable explicit version fails; it does not silently install a
different release. `latest` is also accepted explicitly.

## What happens during an update

The script downloads source and builds the web app as the invoking user, with a
384 MiB Node heap limit. The current service keeps running during the build. It
assembles API production dependencies with workspace symlinks preserved, applies
compatible `body-parser` and `qs` dependency updates, and refuses activation when
the production audit reports a high or critical vulnerability. The installed
`package-lock.json` records the resolved dependencies.

Activation stops only Tokkl, switches the current symlink, starts the selected
release and checks its storage health endpoint. Builds that fail before activation
leave the current release selected. Failures after activation return a nonzero exit
status and leave the selected release in place for inspection. The updater does
not perform rollback or database compatibility checks.

The updater leaves `/etc/tokkl/tokkl.env` and `/var/lib/tokkl` in place. It creates no
database backups. Temporary source and build directories are removed on exit. Once
health checks pass, only the current and immediately previous application release
directories are retained. npm's download cache remains available for later builds.

## When an update fails

Use the [native installation diagnostics](operations.md#troubleshooting-a-native-installation)
to inspect the selected release, service log and local health endpoint.

If a download, build or production audit fails, resolve the reported error and
rerun the updater. After an activation failure, inspect the journal and the
selected release before restarting or installing another version. A successful
health check confirms storage connectivity; also check browser login, a timer
and a CSV report after updating.

## Update the updater itself

The installed updater is a separate copy. To upgrade it, update your repository
checkout and repeat the `sudo install` command above. Application updates leave
nginx, certificates, systemd configuration and the system-wide Node installation
in place.

Maintainer test instructions are in the [development guide](../development.md#vps-updater-tests).
