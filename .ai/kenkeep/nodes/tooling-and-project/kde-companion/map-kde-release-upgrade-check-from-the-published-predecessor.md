---
type: map
title: 'KDE release upgrade check: previous-package.sh and --previous-package'
description: >-
  Release legs upgrade from the newest older published tokkl-kde asset, checked
  by size and SHA-256, or from a 0.0.0 build when none is usable.
tags:
  - tooling
  - kde
  - release
  - packaging
kk_schema_version: 3
kk_id: map-kde-release-upgrade-check-from-the-published-predecessor
kk_derived_from: []
kk_relates_to:
  - map-kde-ci-and-release-pipeline
  - map-kde-native-packaging
kk_depends_on: []
kk_confidence: high
---
`desktop/kde/scripts/container-check.sh` takes either `--previous-version <version>` (a build of this source, default 0.0.0) or `--previous-package <file>` (an older tokkl-kde DEB or RPM), not both, and `--previous-package` only with `--format deb` or `--format rpm`. The file is copied to `<dir>/previous/`. `check-package.sh` refuses it before installing anything unless it is `tokkl-kde` for the target's architecture, carries this system's `%{dist}` in its release for an RPM, and is strictly older than the package under test. The `kde` job never passes `--previous-package`, so pull requests and main upgrade from 0.0.0.

Each `kde-release` leg runs `desktop/kde/ci/previous-package.sh --format deb|rpm --version <version> --output <dir>`. It picks the newest published release (no drafts or pre-releases) older than `<version>` by package version order (`scripts/native-version.sh`, compared with dpkg) that has exactly one uploaded asset for the format, with a SHA-256 digest and the label `.releaserc.json` gives that format today. Releases without such an asset, such as ones built for another target, are passed over, so changing an asset label in `.releaserc.json` hides every older release until one carries the new label.

The download goes to a scratch directory under `<dir>` that is always removed, and the file is moved into place only when its size and digest match. When nothing is usable (gh, jq or dpkg missing, the release list or a release's assets unreadable, no older release with a matching asset, a failed or partial download) the script prints the reason on stderr, prints no path and exits 0, and the leg upgrades from a 0.0.0 build of this source instead. A size or digest mismatch exits 1 and fails the leg, as does a package `check-package.sh` refuses.

<!-- kk:related:start -->
# Related

- Related: [map-kde-ci-and-release-pipeline](map-kde-ci-and-release-pipeline.md)
- Related: [map-kde-native-packaging](map-kde-native-packaging.md)
<!-- kk:related:end -->
