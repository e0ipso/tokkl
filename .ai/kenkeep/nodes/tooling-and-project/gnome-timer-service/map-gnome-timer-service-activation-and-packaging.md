---
type: map
title: GNOME timer service activation and packaging
description: >-
  Headless Qt dependency checks, D-Bus/systemd activation and Debian/Fedora
  packaging run in pinned containers.
tags:
  - desktop
  - gnome
  - ci
  - packaging
kk_schema_version: 3
kk_id: map-gnome-timer-service-activation-and-packaging
kk_derived_from: []
kk_relates_to:
  - map-kde-ci-and-release-pipeline
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
kk_depends_on: []
kk_confidence: high
---
The service may load only Qt Core, Network and DBus. `desktop/gnome/ci/check.sh` removes `qt6-qtbase-gui` from the container and fails the build if `ldd` shows another Qt library. The install ships the program, the D-Bus activation file `org.tokkl.Timer1.service` and the systemd user unit `tokkl-timerd.service`; the activation file names both `Exec=` and `SystemdService=`.

`check.sh` runs in a digest-pinned Fedora 44 container as an unprivileged user, because GNOME Keyring refuses to run as root. It builds, runs CTest (the core's tests plus `timerservice`, `keychainstore` and `activation`) and checks the installed files. Then `desktop/gnome/ci/activation.sh` proves that the first call to the bus name starts the installed service, in two modes. `bus` uses a plain `dbus-daemon`, which runs `Exec=`. `systemd` runs in a privileged container that boots systemd, because dbus-broker can only activate through `SystemdService=`. The `gnome` CI job runs `check.sh`, and the `release` job lists it in `needs`. The panel extension that drives the service is in [map-gnome-shell-extension-for-tokkl-timerd](map-gnome-shell-extension-for-tokkl-timerd.md).

`tokkl-timerd` ships as a DEB for Debian 13 and an RPM for Fedora 44, both with no maintainer scripts and both activating on the session bus with and without systemd. `desktop/gnome/scripts/package-release.sh` builds them from `debian/` and `packaging/rpm`; `check-package.sh` fails a package that has maintainer scripts. `desktop/gnome/scripts/container-check.sh --version <v> --output <dir>` packages and checks both plus the extension zip, and installs each package into a container that `ci/boot-activation.sh` boots with systemd as process 1 for the activation check. Versions go through `desktop/kde/scripts/native-version.sh` (`1.2.0-rc.1` becomes `1.2.0~rc1`). The RPM depends on the Qt it was built with, so it needs an updated Fedora 44 (Qt 6.11), not the release media. The release steps are in [map-kde-ci-and-release-pipeline](kde-companion/map-kde-ci-and-release-pipeline.md).

<!-- kk:related:start -->
# Related

- Related: [map-kde-ci-and-release-pipeline → map-kde-and-core-ci-jobs](../kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-real-server-test](../kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md)
- Related: [map-kde-ci-and-release-pipeline → map-release-stages-kde-semantic-release-plugin-and-gnome-assets](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md)
- Related: [map-kde-ci-and-release-pipeline → map-tests-for-release-only-ci-steps](../kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
<!-- kk:related:end -->
