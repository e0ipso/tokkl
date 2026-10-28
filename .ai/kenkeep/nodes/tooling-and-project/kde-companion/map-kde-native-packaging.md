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
kk_derived_from:
  - '379941d5-dedc-4c27-8c6e-544c94d411c6:map:1'
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-kde-ci-and-release-pipeline
  - map-kde-release-upgrade-check-from-the-published-predecessor
kk_depends_on: []
kk_confidence: high
---
`desktop/kde` builds one package named `tokkl-kde` in two formats: a DEB from `debian/` for Debian 13 (amd64; Qt 6.8.2, KDE Frameworks 6.13.0, Plasma 6.3.5) and an RPM from `packaging/rpm/tokkl-kde.spec` for Fedora 44 with updates (x86_64). The RPM depends on the Qt it was built with, so it needs an updated Fedora 44, not the release media. Neither package has maintainer scripts or files outside `/usr`. Tokkl is MIT licensed, "Copyright (c) 2026 Tokkl contributors". The root `LICENSE` is the source. `package.json` and the lockfile root say `"license": "MIT"`, the KPlugin metadata has `License` MIT, `debian/copyright` is DEP-5 with the full MIT text, and the RPM spec has `License: MIT` and `%license LICENSE`. `desktop/kde/LICENSE` is a copy of the root file, because the package containers only see `desktop/` (`container-check.sh` mounts it at `/desktop`); `container-check.sh` refuses to run when the copy differs, so copy the root file again after changing it. `check-package.sh` checks the declared license (MIT) and the license file in each built package. The Docker image sets the OCI label `licenses=MIT` and ships the root file as `/app/LICENSE`; `.dockerignore` re-includes `LICENSE` for that. CI and the release build both packages through these scripts: see [map-kde-ci-and-release-pipeline](map-kde-ci-and-release-pipeline.md).

The scripts in `desktop/kde/scripts/` are `package-release.sh --version V --format deb|rpm --output DIR` (builds from a copy of the tree, with `desktop/core` copied to `core/` in it; `debian/rules` and the RPM spec pass `-DTOKKL_CORE_DIR` pointing there, and the copy leaves out the core tests), `check-package.sh` (inspects, then installs, upgrades and removes a package; changes the system's packages; removal takes only `tokkl-kde` away, with `dnf remove --no-autoremove` on Fedora and `apt-get remove` on Debian, so the dependencies stay for the next install and dependency autoremove is deliberately not covered), `prepare-target.sh` (turns a container into a target; on `debian:trixie` it only fetches the package lists, which the image ships empty or as `.lz4`) and `container-check.sh --version V --output DIR [--format deb|rpm|all] [--previous-version V | --previous-package FILE]` (runs test, build and check in throwaway containers; `--previous-package` is in [map-kde-release-upgrade-check-from-the-published-predecessor](map-kde-release-upgrade-check-from-the-published-predecessor.md); `CONTAINER_ENGINE` defaults to docker and `TOKKL_KDE_CI_IMAGE` names the images, default `tokkl-kde-ci`). Run builds and install checks through `container-check.sh`, never on the host, because `check-package.sh` and `prepare-target.sh` replace system packages.

`scripts/native-version.sh` is the single mapping from a Tokkl version to a package version, and the other scripts call it. It accepts `MAJOR.MINOR.PATCH`, optionally followed by `-<letters>` or `-<letters>.<n>` (n has no leading zero and is not 0), and prints `~<letters><n>`: `1.2.0-rc.1` becomes `1.2.0~rc1`. The dot is dropped because dpkg sorts `.` after letters and rpm sorts numeric segments after alphabetic ones, which would misorder `rc.1` against `rcx`. Every other form exits 2. `cmake/TokklVersion.cmake` still accepts any SemVer, so a development build can use a version that cannot be packaged. The ctest `native-version` checks the accepted and refused forms and the dpkg order; it skips the rpm order check when `rpm` is not installed.

Runtime dependencies that no tool can see are declared by hand: the `org.kde.plasma.*` QML modules come from `plasma-desktoptheme` (core, components, extras) and `libplasma` (plasmoid, configuration, registered in C++ on Plasma 6.3) on Debian and from `libplasma` on Fedora, plus Kirigami, KCMUtils and Qt Quick. The spec lists `cmake(KF6CoreAddons)` itself because Fedora's `kf6-kpackage-devel` does not pull it in. The Pomodoro hourglass is an SVG image drawn by Qt's SVG image plugin, which no library scan finds, so the packages name it: `qt6-svg-plugins` on Debian and `qt6-qtsvg` on Fedora. The alarm plays through Qt Multimedia; on Debian `dpkg-shlibdeps` adds `libqt6multimedia6`, which ships the FFmpeg media plugin and the PulseAudio output, and the spec names `qt6-qtmultimedia` so its media plugins stay a declared dependency should Fedora split them. `check-package.sh` fails a package whose declared dependencies leave either out. Usage and the target table are in `desktop/kde/README.md`.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-and-core-ci-jobs](kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-real-server-test](kde-ci-and-release-pipeline/map-kde-real-server-test.md)
- Related: [map-kde-ci-and-release-pipeline → map-release-stages-kde-semantic-release-plugin-and-gnome-assets](kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md)
- Related: [map-kde-ci-and-release-pipeline → map-tests-for-release-only-ci-steps](kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md)
- Related: [map-kde-release-upgrade-check-from-the-published-predecessor](map-kde-release-upgrade-check-from-the-published-predecessor.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 379941d5-dedc-4c27-8c6e-544c94d411c6:map:1
<!-- kk:citations:end -->
