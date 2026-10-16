---
type: map
title: KDE Plasma companion in desktop/kde
description: >-
  Standalone CMake project for the Plasma widget com.github.e0ipso.tokkl;
  versioned from root package.json; 6 ctest tests.
tags:
  - tooling
  - kde
  - desktop
  - testing
kk_schema_version: 3
kk_id: map-kde-plasma-companion-desktop-kde
kk_derived_from: []
kk_relates_to:
  - map-npm-workspaces-package-layout
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`desktop/kde` is a standalone CMake project, outside the npm workspaces (`packages/*`) and outside the `.dockerignore` allowlist, so npm scripts and the Docker image never build it. It ships a Plasma widget package with id `com.github.e0ipso.tokkl` (`package/metadata.json`, UI in `package/contents/ui/main.qml`) and a C++ QML backend module `com.github.e0ipso.tokkl.backend` (`src/`). Minimum versions are set at the top of `desktop/kde/CMakeLists.txt`: Qt 6.10, KDE Frameworks 6.24, Plasma 6.6.

The version defaults to the root `package.json` (`TOKKL_PACKAGE_JSON`, resolved by `cmake/TokklVersion.cmake`); `-DTOKKL_VERSION=<semver>` overrides it, and a copy built outside the repository needs it. The source `package/metadata.json` has no `Version`; the build stamps the resolved version into the package it assembles and installs. The package's `contents/` in the build tree is emptied and copied again on every configure, so files removed from `package/contents/` do not linger.

Build and test from the repository root, in any build directory:

```sh
cmake -S desktop/kde -B "$build"
cmake --build "$build" -j"$(nproc)"
QT_QPA_PLATFORM=offscreen ctest --test-dir "$build" --output-on-failure
```

ctest runs six tests: `appstreamtest` (added by ECM), `version`, `prune-package`, `stage-install`, `smokeload` and `stage-cleanup`. `smokeload` loads the widget through libplasma inside a minimal `TestCorona` with an empty containment. libplasma's CMake package does not pull in KF6Config, so the test block calls `find_package(KF6 ... COMPONENTS Config)` itself. The `version` test checks the real root `package.json` only when it exists. Build dependencies and install commands are in `desktop/kde/README.md`.

<!-- kk:related:start -->
# Related

- Related: [map-npm-workspaces-package-layout](map-npm-workspaces-package-layout.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
