---
type: map
title: KDE Plasma companion in desktop/kde
description: >-
  Standalone CMake project for the Plasma widget com.github.e0ipso.tokkl;
  tokklcore library; panel item and menu; versioned from root package.json; 12 ctest tests; DEB and RPM packaging.
tags:
  - tooling
  - kde
  - desktop
  - testing
kk_schema_version: 3
kk_id: map-kde-plasma-companion-desktop-kde
kk_derived_from: []
kk_relates_to:
  - practice-kde-companion-connection-and-configure-page-rules
  - map-npm-workspaces-package-layout
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`desktop/kde` is a standalone CMake project, outside the npm workspaces (`packages/*`) and outside the `.dockerignore` allowlist, so npm scripts and the Docker image never build it. It ships a Plasma widget package with id `com.github.e0ipso.tokkl` (`package/metadata.json`, UI in `package/contents/ui/main.qml`) and a C++ QML backend module `com.github.e0ipso.tokkl.backend` (`src/`). Minimum versions are set at the top of `desktop/kde/CMakeLists.txt`: Qt 6.10, KDE Frameworks 6.24, Plasma 6.6.

The API client, credential storage, connection state and timer controller live in the static `tokklcore` library (`src/CMakeLists.txt`), which both the QML module and the autotests link. `src/qmltypes.h` exposes `Tokkl::Connection`, `Tokkl::ConnectionSetup` and `Tokkl::TimerController` to QML as `TokklConnection`, `TokklConnectionSetup` and `TokklTimer` through `QML_FOREIGN`. The Configure page is `package/contents/ui/configGeneral.qml`. The panel is `PanelButton.qml` (compact representation: icon, running or stopped symbol, elapsed time, state symbol) and `PanelMenu.qml`, wired in `main.qml`. Left click, Space or Return starts or stops; right click, the Menu key or Shift+F10 opens the menu (Project, Billable, Reconnect, Open Tokkl, Configure). Open Tokkl uses `Connection::webUrl`, the instance URL with user info, query and fragment removed and a trailing slash, so no credential reaches the browser.

The version defaults to the root `package.json` (`TOKKL_PACKAGE_JSON`, resolved by `cmake/TokklVersion.cmake`); `-DTOKKL_VERSION=<semver>` overrides it, and a copy built outside the repository needs it. The source `package/metadata.json` has no `Version`; the build stamps the resolved version into the package it assembles and installs. The package's `contents/` in the build tree is emptied and copied again on every configure, so files removed from `package/contents/` do not linger.

Build and test from the repository root, in any build directory:

```sh
cmake -S desktop/kde -B "$build"
cmake --build "$build" -j"$(nproc)"
QT_QPA_PLATFORM=offscreen ctest --test-dir "$build" --output-on-failure
```

ctest runs twelve tests: `appstreamtest` (added by ECM), the unit tests `api`, `connection`, `networktransport` and `timer`, the QtQuickTest `panel`, then `version`, `native-version`, `prune-package`, `stage-install`, `smokeload` and `stage-cleanup`. `native-version` checks `scripts/native-version.sh` (see the packaging node), including dpkg order; the rpm order check is skipped where `rpm` is absent, as on this host. The unit tests use `FakeTransport`, `FakeCredentialStore` and `FakeClock` from `autotests/fakes.h` and never touch the network or the real wallet. `panel` runs the QML tests in `autotests/qml/` (`tst_panel.qml`) offscreen against `tokklcore` wired to those fakes; it never loads `main.qml` or the real connection. Its fake responses echo the metadata the test scripts into them, so it cannot catch the server losing description or tags on a partial PUT. That behaviour lives in `updateTimeEntry` (`packages/api/src/models/timeEntries.ts`) and needs an API test. `smokeload` loads the widget through libplasma inside a minimal `TestCorona` with an empty containment. libplasma's CMake package does not pull in KF6Config, so the test block calls `find_package(KF6 ... COMPONENTS Config)` itself. The `version` test checks the real root `package.json` only when it exists. Build dependencies and install commands are in `desktop/kde/README.md`. Native DEB and RPM packages are described in [map-kde-native-packaging](map-kde-native-packaging.md).

<!-- kk:related:start -->
# Related

- Related: [practice-kde-companion-connection-and-configure-page-rules](practice-kde-companion-connection-and-configure-page-rules.md)
- Related: [map-npm-workspaces-package-layout](map-npm-workspaces-package-layout.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
