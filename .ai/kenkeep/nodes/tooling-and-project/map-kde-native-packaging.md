---
type: map
title: 'KDE native packaging: DEB, RPM and the version mapping'
description: >-
  tokkl-kde DEB and RPM are built and checked only in containers;
  scripts/native-version.sh is the one version mapping.
tags:
  - tooling
  - kde
  - packaging
  - release
kk_schema_version: 3
kk_id: map-kde-native-packaging
kk_derived_from: []
kk_relates_to:
  - map-kde-plasma-companion-desktop-kde
  - map-kde-ci-and-release-pipeline
kk_depends_on: []
kk_confidence: high
---
`desktop/kde` builds one package named `tokkl-kde` in two formats: a DEB from `debian/` for TUXEDO OS 24.04 (amd64; Qt 6.10.2, KDE Frameworks 6.24.0, Plasma 6.6.6) and an RPM from `packaging/rpm/tokkl-kde.spec` for Fedora 44 with updates (x86_64). The RPM depends on the Qt it was built with, so it needs an updated Fedora 44, not the release media. Neither package has maintainer scripts or files outside `/usr`. Packages declare `License: NOASSERTION` until the project picks a license (TT-0177, not chosen by the owner yet); do not publish the packages outside the GitHub release before that. CI and the release build both packages through these scripts: see [map-kde-ci-and-release-pipeline](map-kde-ci-and-release-pipeline.md).

The scripts in `desktop/kde/scripts/` are `package-release.sh --version V --format deb|rpm --output DIR` (builds from a copy of the tree), `check-package.sh` (inspects, then installs, upgrades and removes a package; changes the system's packages), `prepare-target.sh` (turns a container into a target; adds the TUXEDO OS repositories to `ubuntu:24.04`) and `container-check.sh --version V --output DIR [--format deb|rpm|all] [--previous-version V]` (runs test, build and check in throwaway containers; `CONTAINER_ENGINE` defaults to docker and `TOKKL_KDE_CI_IMAGE` names the images, default `tokkl-kde-ci`). Run builds and install checks through `container-check.sh`, never on the host, because `check-package.sh` and `prepare-target.sh` replace system packages.

`scripts/native-version.sh` is the single mapping from a Tokkl version to a package version, and the other scripts call it. It accepts `MAJOR.MINOR.PATCH`, optionally followed by `-<letters>` or `-<letters>.<n>` (n has no leading zero and is not 0), and prints `~<letters><n>`: `1.2.0-rc.1` becomes `1.2.0~rc1`. The dot is dropped because dpkg sorts `.` after letters and rpm sorts numeric segments after alphabetic ones, which would misorder `rc.1` against `rcx`. Every other form exits 2. `cmake/TokklVersion.cmake` still accepts any SemVer, so a development build can use a version that cannot be packaged. The ctest `native-version` checks the accepted and refused forms and the dpkg order; it skips the rpm order check when `rpm` is not installed.

Runtime dependencies that no tool can see are declared by hand: the `org.kde.plasma.*` QML modules come from `plasma-desktoptheme` on TUXEDO OS and from `libplasma` on Fedora, plus Kirigami, KCMUtils and Qt Quick. The spec lists `cmake(KF6CoreAddons)` itself because Fedora's `kf6-kpackage-devel` does not pull it in. Usage and the target table are in `desktop/kde/README.md`.

<!-- kk:related:start -->
# Related

- Related: [map-kde-plasma-companion-desktop-kde](map-kde-plasma-companion-desktop-kde.md)
- Related: [map-kde-ci-and-release-pipeline](map-kde-ci-and-release-pipeline.md)
<!-- kk:related:end -->
