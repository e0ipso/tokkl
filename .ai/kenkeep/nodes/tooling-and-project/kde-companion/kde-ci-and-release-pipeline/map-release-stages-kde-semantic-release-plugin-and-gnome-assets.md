---
type: map
title: 'Release stages, KDE semantic-release plugin and GNOME assets'
description: >-
  A push to main runs release-version, two kde-release legs, then release; the
  plugin gates on the manifests; GNOME assets upload after.
tags:
  - tooling
  - kde
  - ci
  - release
kk_schema_version: 3
kk_id: map-release-stages-kde-semantic-release-plugin-and-gnome-assets
kk_derived_from: []
kk_relates_to:
  - map-kde-release-upgrade-check-from-the-published-predecessor
  - map-kde-native-packaging
  - map-kde-and-core-ci-jobs
  - map-tests-for-release-only-ci-steps
kk_depends_on: []
kk_confidence: high
---
The release stages start only after `test`, `kde`, `core`, `gnome`, `gnome-extension` and `macos` pass; the GNOME and macOS jobs and the macOS DMG upload are in [map-gnome-shell-extension-for-tokkl-timerd](../../map-gnome-shell-extension-for-tokkl-timerd.md) and [map-macos-menu-bar-app](../../map-macos-menu-bar-app.md).

- A push to main releases in three stages. `release-version` runs `desktop/kde/ci/next-release.js`, a semantic-release dry run that prints the next version, or nothing, and then nothing else runs; it keeps `contents: write` because the dry run checks that semantic-release could push. Two `kde-release` legs check out that commit, fetch the predecessor package ([map-kde-release-upgrade-check-from-the-published-predecessor](../map-kde-release-upgrade-check-from-the-published-predecessor.md)), test, build and check one format each with `container-check.sh`, and upload the package with a manifest `kde-<format>.json` (`format`, `version`, `revision`, `package`, `sha256`) as the artifact `kde-release-<format>`. `release` runs only after both legs pass, downloads both artifacts into `dist/kde` and runs semantic-release with `TOKKL_KDE_RELEASE_VERSION` set to the version the legs built.
- `desktop/kde/ci/semantic-release.js` is a plugin listed in `.releaserc.json` after `@semantic-release/npm` and before `@semantic-release/git`. It builds nothing. `verifyRelease`, which also runs in the dry run, refuses a next version that `scripts/native-version.sh` cannot map and, when `TOKKL_KDE_RELEASE_VERSION` is set, any version other than that one. `prepare` fails unless `dist/kde` holds exactly `tokkl-kde_<native>_amd64.deb`, one `tokkl-kde-<native>-1.*.x86_64.rpm`, `kde-deb.json` and `kde-rpm.json`, each manifest naming its package's SHA-256, that version and `HEAD`. Either failure stops the release before anything is pushed; when another release has moved main on in the meantime, semantic-release releases nothing. `@semantic-release/github` then attaches `dist/kde/tokkl-kde_*_amd64.deb` and `dist/kde/tokkl-kde-*.x86_64.rpm` to the same release.
- GNOME files follow the macOS pattern. `gnome-release` (read-only token) checks out `v<version>`, runs the same "Check the version" step as `macos-release`, builds with `desktop/gnome/scripts/container-check.sh` and uploads the `gnome-release` artifact: `tokkl-timerd_*_amd64.deb` (Debian 13), `tokkl-timerd-*.x86_64.rpm` (Fedora 44) and `tokkl-gnome-extension-<version>.zip`. `gnome-publish` (`contents: write`) fails unless the artifact holds exactly one DEB, one RPM and the zip, then runs `gh release upload --clobber`, so a re-run replaces the assets. The `gnome` job builds and checks the same packages for `package.json`'s version on every run, and `release` waits for it. The zip's `version-name` is the release version; `pack-extension.sh` refuses a pre-release version because extensions.gnome.org takes only 1 to 16 letters, digits, dots and spaces. Uploading the zip to extensions.gnome.org is manual and documented in `desktop/gnome/README.md`.

<!-- kk:related:start -->
# Related

- Related: [map-kde-release-upgrade-check-from-the-published-predecessor](../map-kde-release-upgrade-check-from-the-published-predecessor.md)
- Related: [map-kde-native-packaging](../map-kde-native-packaging.md)
- Related: [map-kde-and-core-ci-jobs](map-kde-and-core-ci-jobs.md)
- Related: [map-tests-for-release-only-ci-steps](map-tests-for-release-only-ci-steps.md)
<!-- kk:related:end -->
