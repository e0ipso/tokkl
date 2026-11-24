---
type: map
title: Desktop version resolution and Plasma metadata stamping
description: >-
  TokklVersion.cmake reads the root package.json unless -DTOKKL_VERSION is set;
  TokklMetadata.cmake stamps the widget package.
tags:
  - kde
  - desktop
  - tooling
kk_schema_version: 3
kk_id: map-desktop-version-resolution-and-plasma-metadata-stamping
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - map-kde-native-packaging
  - map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core
kk_depends_on: []
kk_confidence: high
---
The version defaults to the root `package.json` (`TOKKL_PACKAGE_JSON`, resolved by `desktop/core/cmake/TokklVersion.cmake`); `-DTOKKL_VERSION=<semver>` overrides it, and a copy built outside the repository needs it. The source `package/metadata.json` has no `Version`; `desktop/kde/cmake/TokklMetadata.cmake` stamps the resolved version into the package it assembles and installs. The package's `contents/` in the build tree is emptied and copied again on every configure, so files removed from `package/contents/` do not linger.

<!-- kk:related:start -->
# Related

- Related: [map-kde-native-packaging](../../map-kde-native-packaging.md)
- Related: [map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../../../.redirects.json)
<!-- kk:citations:end -->
