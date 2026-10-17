---
type: map
title: 'GNOME timer service: tokkl-timerd and org.tokkl.Timer1'
description: >-
  tokkl-timerd is a headless Qt service on the shared core; D-Bus contract
  rules, activation and the check.sh container.
tags:
  - tooling
  - desktop
  - gnome
  - ci
kk_schema_version: 3
kk_id: map-gnome-timerd-d-bus-timer-service
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-kde-ci-and-release-pipeline
  - map-gnome-shell-extension-for-tokkl-timerd
kk_depends_on: []
kk_confidence: high
---
`desktop/gnome/` builds `tokkl-timerd`, a headless Qt service that runs the shared `tokklcore` (`desktop/core`) and adds no timer rule of its own. It owns `org.tokkl.Timer1` at `/org/tokkl/Timer1` on the session bus. A GNOME panel extension or any other client drives it over D-Bus. Requests carry the client name `tokkl-gnome`.

The interface description is `desktop/gnome/dbus/org.tokkl.Timer1.xml`. It lives in `dbus/` because the root `.gitignore` ignores `data/`. Contract rules:

- Properties are `Running`, `StartTime`, `IndicatorState`, `IndicatorColor`, `Projects`, `ChosenProject`, `ChosenProjectName`, `Billable`, `Status` and `ErrorString`. Methods are `Start`, `Stop`, `SetProject`, `SetBillable` and `Configure`.
- `StartTime` is Unix seconds, 0 when stopped; elapsed time is the clock minus it. `ChosenProject` 0 means no project. `ChosenProjectName` is the name of the project the core resolved for the running entry, archived projects included; while stopped it comes from `Projects`. `Projects` alone cannot name an archived running project, so clients read `ChosenProjectName` for the label. It is declared in `dbus/org.tokkl.Timer1.xml`.
- `PropertiesChanged` lists only the properties whose value changed since the last signal, never the whole set.
- `Configure` with an empty secret keeps the secret the credential store holds for that account. A nonempty one is saved first; if the store refuses, the call fails with `org.tokkl.Timer1.Error.CredentialStore` and the settings stay as they were.
- Secrets live in QtKeychain: libsecret (GNOME Keyring) on GNOME, KWallet if the desktop is KDE.

The service may load only Qt Core, Network and DBus. `desktop/gnome/ci/check.sh` removes `qt6-qtbase-gui` from the container and fails the build if `ldd` shows another Qt library. The install ships the program, the D-Bus activation file `org.tokkl.Timer1.service` and the systemd user unit `tokkl-timerd.service`; the activation file names both `Exec=` and `SystemdService=`.

`check.sh` runs in a digest-pinned Fedora 44 container as an unprivileged user, because GNOME Keyring refuses to run as root. It builds, runs CTest (the core's tests plus `timerservice`, `keychainstore` and `activation`) and checks the installed files. Then `desktop/gnome/ci/activation.sh` proves that the first call to the bus name starts the installed service, in two modes. `bus` uses a plain `dbus-daemon`, which runs `Exec=`. `systemd` runs in a privileged container that boots systemd, because dbus-broker can only activate through `SystemdService=`. The `gnome` CI job runs `check.sh`, and the `release` job lists it in `needs`. The panel extension that drives the service is in [map-gnome-shell-extension-for-tokkl-timerd](map-gnome-shell-extension-for-tokkl-timerd.md).

`tokkl-timerd` ships as a DEB for Ubuntu 26.04 and an RPM for Fedora 44, both with no maintainer scripts and both activating on the session bus with and without systemd. `desktop/gnome/scripts/package-release.sh` builds them from `debian/` and `packaging/rpm`; `check-package.sh` fails a package that has maintainer scripts. `desktop/gnome/scripts/container-check.sh --version <v> --output <dir>` packages and checks both plus the extension zip, and installs each package into a container that `ci/boot-activation.sh` boots with systemd as process 1 for the activation check. Versions go through `desktop/kde/scripts/native-version.sh` (`1.2.0-rc.1` becomes `1.2.0~rc1`). The RPM depends on the Qt it was built with, so it needs an updated Fedora 44 (Qt 6.11), not the release media. The release steps are in [map-kde-ci-and-release-pipeline](kde-companion/map-kde-ci-and-release-pipeline.md).

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-kde-ci-and-release-pipeline](kde-companion/map-kde-ci-and-release-pipeline.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd](map-gnome-shell-extension-for-tokkl-timerd.md)
<!-- kk:related:end -->
