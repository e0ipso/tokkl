---
type: map
title: 'KDE CI job and release: kde matrix, real-server test, semantic-release plugin'
description: >-
  The kde CI job builds, tests and checks the DEB and RPM in pinned containers;
  the release builds them again and attaches both to the v<version> release.
tags:
  - tooling
  - kde
  - ci
  - release
kk_schema_version: 3
kk_id: map-kde-ci-and-release-pipeline
kk_derived_from: []
kk_relates_to:
  - map-kde-native-packaging
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`.github/workflows/ci.yml` has a `kde` job with a matrix of two targets, TUXEDO OS 24.04 (`deb`, `desktop/kde/ci/Dockerfile`) and Fedora KDE 44 (`rpm`, `desktop/kde/ci/fedora.Dockerfile`). Each target runs `desktop/kde/scripts/container-check.sh --format` (CTest under Xvfb and DBus, packaging, then version, dependency, clean-install, installed widget and backend load, upgrade from 0.0.0 and removal checks) and then `desktop/kde/ci/realserver.sh`. The `release` job `needs: [test, kde, core, gnome, gnome-extension, macos]`; the GNOME and macOS jobs and the macOS DMG upload are in [map-gnome-shell-extension-for-tokkl-timerd](../map-gnome-shell-extension-for-tokkl-timerd.md) and [map-macos-menu-bar-app](../map-macos-menu-bar-app.md).

The `core` job runs `desktop/core/ci/check.sh` in the digest-pinned `fedora:44` image with only cmake, gcc-c++, make and qt6-qtbase-devel, after `rpm -e --nodeps qt6-qtbase-gui`. It configures and builds `desktop/core`, runs CTest, and fails if any test binary loads a Qt library other than Core, Network or Test (checked with `ldd`). A Qt Gui or KDE dependency added to the core breaks this job, not the `kde` job. Fedora updates have no snapshots, so the Qt version is whatever the archive holds that day.

- Base images are pinned by digest, but the TUXEDO OS, Ubuntu and Fedora updates archives have no snapshots, so Qt, KDE Frameworks and Plasma are whatever the archive holds on the build day. `desktop/kde/ci/baseline.sh` prints the versions and fails the build below the floor (Qt 6.10.2, Frameworks 6.24.0, Plasma 6.6.6 for deb and 6.6.0 for rpm). A red `kde` job with no code change can be an archive moving, not a regression.
- `TOKKL_KDE_CI_IMAGE` names the images for both `container-check.sh` and `realserver.sh`. It replaced `TOKKL_DEB_IMAGE` and `TOKKL_RPM_IMAGE`.
- The real-server test is `desktop/kde/tests/realservertest.cpp` (QtTest, built by the CMake `tests` directory but not a CTest test) driven by `desktop/kde/tests/realserver.test.ts`. The script starts Tokkl servers with the API's test fixtures (`packages/api/test/helpers.ts`) behind proxies that can hold replies back, runs the binary in the `<image>:<format>-test` container, then checks that the server data changed only where the companion may change it, including that the stopped entry sits on the instance's 5-minute time resolution grid (`assertSnapped`). It needs Node.js 24 and `npm ci` on the host.
- No API removes a workspace member, so the membership-loss scenario has the script delete the `workspace_users` row directly (`/remove-membership` in `realserver.test.ts`).
- GNOME files follow the macOS pattern. `gnome-release` (read-only token) checks out `v<version>`, runs the same "Check the version" step as `macos-release`, builds with `desktop/gnome/scripts/container-check.sh` and uploads the `gnome-release` artifact: `tokkl-timerd_*_amd64.deb` (Ubuntu 26.04), `tokkl-timerd-*.x86_64.rpm` (Fedora 44) and `tokkl-gnome-extension-<version>.zip`. `gnome-publish` (`contents: write`) fails unless the artifact holds exactly one DEB, one RPM and the zip, then runs `gh release upload --clobber`, so a re-run replaces the assets. The `gnome` job builds and checks the same packages for `package.json`'s version on every run, and `release` waits for it. The zip's `version-name` is the release version; `pack-extension.sh` refuses a pre-release version because extensions.gnome.org takes only 1 to 16 letters, digits, dots and spaces. Uploading the zip to extensions.gnome.org is manual and documented in `desktop/gnome/README.md`.
- `scripts/release-publish.test.ts` (run by `npm test`) pulls the `gnome-publish` and `macos-publish` upload steps and the `gnome-release` and `macos-release` "Check the version" steps out of `ci.yml`, runs them with bash and a stub `gh`, and checks the exact upload arguments, a missing or duplicate asset, a version mismatch and a failed upload. These steps run only after a real release, so nothing else exercises them. The step is found by job and step name, so renaming either breaks the test on purpose. actionlint lints `run:` blocks with shellcheck but does not read composite actions.
- `desktop/kde/ci/semantic-release.js` is a plugin listed in `.releaserc.json` before `@semantic-release/git`. Its `prepare` step builds and checks both packages for `nextRelease.version` into `dist/kde`, so a package failure stops the release before anything is pushed. `@semantic-release/github` then attaches `dist/kde/tokkl-kde_*_amd64.deb` and `dist/kde/tokkl-kde-*.x86_64.rpm` to the same release. The Docker publish step is unchanged. The release runner needs a working container engine (`CONTAINER_ENGINE`, default docker).
- Not covered by CI, so check by hand on both targets before a release that changes the widget, packaging or wallet code: a real Plasma Wayland session (panel placement, focus, popups, scaling) and KWallet. The list is in `desktop/kde/README.md` under "What CI does not cover".
- The packages declare `License: MIT`. `check-package.sh` fails a package with another declared license or a missing license file, and `container-check.sh` fails when `desktop/kde/LICENSE` differs from the root `LICENSE`; see [map-kde-native-packaging](map-kde-native-packaging.md).

<!-- kk:related:start -->
# Related

- Related: [map-kde-native-packaging](map-kde-native-packaging.md)
- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
