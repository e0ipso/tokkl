---
type: map
title: KDE and core CI jobs
description: >-
  The kde job builds, tests and checks the DEB and RPM in pinned containers;
  core checks Qt Core-only links; baseline floors; manual checks.
tags:
  - tooling
  - kde
  - ci
  - packaging
kk_schema_version: 3
kk_id: map-kde-and-core-ci-jobs
kk_derived_from: []
kk_relates_to:
  - map-kde-ci-dependency-image-cache
  - map-kde-native-packaging
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
  - map-tokkl-kde-live-widgets-reload-with-plasmashell
  - map-kde-real-server-test
  - map-release-stages-kde-semantic-release-plugin-and-gnome-assets
kk_depends_on: []
kk_confidence: high
---
`.github/workflows/ci.yml` has a `kde` job with a matrix of two targets, Debian 13 (`deb`, `desktop/kde/ci/Dockerfile`) and Fedora KDE 44 (`rpm`, `desktop/kde/ci/fedora.Dockerfile`). Each target runs `desktop/kde/scripts/container-check.sh --format` (CTest under Xvfb and DBus, packaging, then version, dependency, clean-install, installed widget and backend load, upgrade from 0.0.0 and removal checks) and then `desktop/kde/ci/realserver.sh`. The dependency images come from a cache keyed on their inputs: see [map-kde-ci-dependency-image-cache](../map-kde-ci-dependency-image-cache.md).

The `core` job runs `desktop/core/ci/check.sh` in the digest-pinned `fedora:44` image with only cmake, gcc-c++, make and qt6-qtbase-devel, after `rpm -e --nodeps qt6-qtbase-gui`. It configures and builds `desktop/core`, runs CTest, and fails if any test binary loads a Qt library other than Core, Network or Test (checked with `ldd`). A Qt Gui or KDE dependency added to the core breaks this job, not the `kde` job. Fedora updates have no snapshots, so the Qt version is whatever the archive holds that day.

- Base images are pinned by digest, but the Debian and Fedora updates archives have no snapshots, so Qt, KDE Frameworks and Plasma are whatever the archive holds on the build day. `desktop/kde/ci/baseline.sh` prints the versions and fails the build below the floor (deb: Qt 6.8.2, Frameworks 6.13.0, Plasma 6.3.5; rpm: Qt 6.10.2, Frameworks 6.24.0, Plasma 6.6.0). A red `kde` job with no code change can be an archive moving, not a regression.
- `TOKKL_KDE_CI_IMAGE` names the images for both `container-check.sh` and `realserver.sh`. It replaced `TOKKL_DEB_IMAGE` and `TOKKL_RPM_IMAGE`.
- Not covered by CI, so check by hand on both targets before a release that changes the widget, packaging or wallet code: a real Plasma Wayland session (panel placement, focus, popups, scaling) and KWallet. The list is in `desktop/kde/README.md` under "What CI does not cover". No check starts `plasmashell`, so the upgrade checks cannot show a running shell keeping the old widget QML; see [map-tokkl-kde-live-widgets-reload-with-plasmashell](../plasma-companion/map-tokkl-kde-live-widgets-reload-with-plasmashell.md).
- The packages declare `License: MIT`. `check-package.sh` fails a package with another declared license or a missing license file, and `container-check.sh` fails when `desktop/kde/LICENSE` differs from the root `LICENSE`; see [map-kde-native-packaging](../map-kde-native-packaging.md).

<!-- kk:related:start -->
# Related

- Related: [map-kde-ci-dependency-image-cache](../map-kde-ci-dependency-image-cache.md)
- Related: [map-kde-native-packaging](../map-kde-native-packaging.md)
- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
- Related: [map-tokkl-kde-live-widgets-reload-with-plasmashell](../plasma-companion/map-tokkl-kde-live-widgets-reload-with-plasmashell.md)
- Related: [map-kde-real-server-test](map-kde-real-server-test.md)
- Related: [map-release-stages-kde-semantic-release-plugin-and-gnome-assets](map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md)
<!-- kk:related:end -->
