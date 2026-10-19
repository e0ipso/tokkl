---
type: map
title: 'KDE CI dependency images: image-id.sh identity, Actions cache, weekly refresh'
description: >-
  container-check.sh reuses images labelled with image-id.sh's hash; CI caches
  them per format and rebuilds them weekly or after gh cache delete.
tags:
  - tooling
  - kde
  - ci
  - docker
kk_schema_version: 3
kk_id: map-kde-ci-dependency-image-cache
kk_derived_from: []
kk_relates_to:
  - map-kde-ci-and-release-pipeline
  - map-kde-native-packaging
kk_depends_on: []
kk_confidence: high
---
`desktop/kde/ci/image-id.sh --format deb|rpm` prints the identity of the three dependency images (target, build and test) that `desktop/kde/scripts/container-check.sh` builds for a format: a SHA-256 over the Dockerfile (`ci/Dockerfile` or `ci/fedora.Dockerfile`), every file its `COPY` lines copy, and `TOKKL_KDE_CI_REFRESH`. It reads the `COPY` sources from the Dockerfile and exits 1 on any source that is not a plain file: flags such as `--from` or `--chown`, wildcards and directories. It refuses them rather than hash too little, so such a `COPY` makes `container-check.sh` and the CI "Identify the dependency images" step fail until `image-id.sh` learns to hash it.

`container-check.sh` labels the images `org.tokkl.kde-ci.inputs=<identity>` and reuses images that carry the current identity without building. With `TOKKL_KDE_CI_IMAGE_CACHE=<dir>` it loads missing images from the `docker save` archive `<dir>/<format>-<identity>.tar` and saves the images it built there. Each target container still fetches the package lists again (`scripts/prepare-target.sh --refresh`), because a reused image can be older than the archive.

In `.github/workflows/ci.yml` the `kde` job sets `TOKKL_KDE_CI_REFRESH` to the ISO week of the commit date (`<year>-W<week>`), restores the Actions cache entry `kde-images-<format>-<identity>` and saves it only when the restore missed. The Debian and Fedora archives move without any hashed file changing, so the weekly value is what makes the images follow them, and every job of one run computes the same identity. To rebuild sooner, delete the entries with `gh cache delete <key>` (`gh cache list --key kde-images-` lists them); the next run builds and saves new ones.

Actions caches are scoped by branch, so an entry a pull request saves is visible only to that pull request. The `kde-release` legs only restore entries saved on main and never save one, so pull request code cannot change the images a release uses.

<!-- kk:related:start -->
# Related

- Related: [map-kde-ci-and-release-pipeline](map-kde-ci-and-release-pipeline.md)
- Related: [map-kde-native-packaging](map-kde-native-packaging.md)
<!-- kk:related:end -->
