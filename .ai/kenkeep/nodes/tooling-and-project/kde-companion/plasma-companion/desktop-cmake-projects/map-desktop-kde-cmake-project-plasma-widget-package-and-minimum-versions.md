---
type: map
title: 'desktop/kde CMake project, Plasma widget package and minimum versions'
description: >-
  desktop/kde is a standalone CMake project outside npm and Docker; widget and
  backend module ids; Qt, KF6, Plasma minimums.
tags:
  - kde
  - desktop
  - tooling
kk_schema_version: 3
kk_id: map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - map-npm-workspaces-package-layout
  - map-kde-native-packaging
  - map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core
  - map-kde-qml-foreign-types-and-backend-module-linking
kk_depends_on: []
kk_confidence: high
---
`desktop/kde` is a standalone CMake project, outside the npm workspaces (`packages/*`) and outside the `.dockerignore` allowlist, so npm scripts and the Docker image never build it. It ships a Plasma widget package with id `com.canpicasoft.tokkl` (`package/metadata.json`, UI in `package/contents/ui/main.qml`) and a C++ QML backend module `com.canpicasoft.tokkl.backend` (`src/`). Minimum versions are set at the top of `desktop/kde/CMakeLists.txt`: Qt 6.8, KDE Frameworks 6.13, Plasma 6.3 (what Debian 13 shipped with); `desktop/core` and `desktop/gnome` need Qt 6.8. `desktop/kde/CMakeLists.txt` adds `desktop/core` with `add_subdirectory("${TOKKL_CORE_DIR}" core)`; `TOKKL_CORE_DIR` defaults to `../core`.

<!-- kk:related:start -->
# Related

- Related: [map-npm-workspaces-package-layout](../../../repo-and-scripts/map-npm-workspaces-package-layout.md)
- Related: [map-kde-native-packaging](../../map-kde-native-packaging.md)
- Related: [map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
- Related: [map-kde-qml-foreign-types-and-backend-module-linking](map-kde-qml-foreign-types-and-backend-module-linking.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../../../.redirects.json)
<!-- kk:citations:end -->
