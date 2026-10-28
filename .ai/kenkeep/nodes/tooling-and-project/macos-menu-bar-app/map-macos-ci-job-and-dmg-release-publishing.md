---
type: map
title: macOS CI job and DMG release publishing
description: >-
  macos CI job (pinned Qt, QtKeychain, CTest, DMG checks) and the
  macos-release/macos-publish jobs that attach the DMG
tags:
  - tooling
  - macos
  - ci
kk_schema_version: 3
kk_id: map-macos-ci-job-and-dmg-release-publishing
kk_derived_from: []
kk_relates_to:
  - map-macos-app-layout-portable-qt-library-and-native-shims
  - map-macos-bundle-icon-and-nsstatusitem-status-image
kk_depends_on: []
kk_confidence: high
---
The `macos` CI job in `.github/workflows/ci.yml` runs on `macos-latest` with Qt 6.11.3 from `jurplel/install-qt-action` (pinned to a commit SHA) and QtKeychain 0.17.0 built from source; the clone is checked against a pinned commit. The build fails if CMake finds a Qt outside `QT_ROOT_DIR`, so a Homebrew Qt on the runner cannot slip in. It builds `Tokkl.app`, runs CTest, checks the bundle's `Info.plist` and starts the app once to see that it stays up. The `release` job lists `macos` in `needs`, so a red `macos` job blocks a release. The job also runs `scripts/package-dmg.sh` and `scripts/check-dmg.sh` on the build, so a broken bundle fails the pull request, not the release. The development hosts do not run macOS, so that job is the only place the `.mm` files are compiled; a red `macos` job is the first sign of an error in them.

The DMG is built and attached after the release exists. `release` exposes `outputs.tag` (empty when semantic-release made no release). `macos-release` runs on `macos-latest` when that tag is set, checks out `v<version>`, fails if `package.json` there does not hold the version, builds through `.github/actions/macos-build` with `-DTOKKL_VERSION`, packages `Tokkl-<version>-arm64.dmg` with `package-dmg.sh` and uploads it as the `macos-dmg` artifact. `macos-publish` runs on ubuntu with `contents: write` and runs `gh release upload --clobber`, so the job that builds third-party code holds no write token and a re-run replaces the asset. `scripts/release-publish.test.ts` runs the `macos-publish` upload step and the "Check the version" step with a stub `gh`. The DMG therefore shows up on the release a few minutes after the release is public. `macdeployqt` signs ad hoc by default (identity `-`), and arm64 binaries do not run unsigned, so keep that signing. There are no Apple secrets; the install docs tell users to run `xattr -cr /Applications/Tokkl.app` to clear quarantine. actionlint does not read composite actions, so a mistake inside `.github/actions/macos-build` shows up only when the job runs.

<!-- kk:related:start -->
# Related

- Related: [map-macos-app-layout-portable-qt-library-and-native-shims](map-macos-app-layout-portable-qt-library-and-native-shims.md)
- Related: [map-macos-bundle-icon-and-nsstatusitem-status-image](map-macos-bundle-icon-and-nsstatusitem-status-image.md)
<!-- kk:related:end -->
