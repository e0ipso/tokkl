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

Panel indicator. `ProjectIndicator.qml` sits in the `PanelButton` row between the play/stop symbol and the elapsed time, in a slot of the same width in every state. Running is a dot and stopped is a still square. The fill is the project colour, inside a separate ring in the theme text colour (11.5 to 17.7:1 on Breeze Light and Dark, by WCAG 2 luminance). No project is a dashed outline in the text colour, pending leaves the slot empty, and an invalid colour fills the shape with the text colour. Only the fill pulses (opacity to 0.35 and back over 1.6 s, as in the web app): the ring and the outline never fade, because a fading ring dropped to about 2:1. The pulse runs only while the item is visible and its window is not hidden (as Plasma's `BusyIndicator`), and the fill goes back to opacity 1 when it stops. Reduced motion is `Kirigami.Units.longDuration <= 1`, not `== 0`: Plasma's Animation speed "Instant" writes `AnimationDurationFactor = 0`, which gives `longDuration` 1 under both the org.kde.desktop and Plasma Kirigami styles, and Plasma's `BusyIndicator.qml` tests `longDuration > 1` for the same reason. `StatusText.summary` includes the project name or "No project" and feeds the tooltip (`main.qml`) and the accessible description of `PanelButton`, so the shape itself is decoration. The backend QML module depends on QtQuick (`src/CMakeLists.txt`) so qmllint knows the colour type of `TokklTimer.indicatorColor`. The real Plasma pulse, Instant and Breeze checks are manual, in the checklist of `desktop/kde/README.md`.

The version defaults to the root `package.json` (`TOKKL_PACKAGE_JSON`, resolved by `cmake/TokklVersion.cmake`); `-DTOKKL_VERSION=<semver>` overrides it, and a copy built outside the repository needs it. The source `package/metadata.json` has no `Version`; the build stamps the resolved version into the package it assembles and installs. The package's `contents/` in the build tree is emptied and copied again on every configure, so files removed from `package/contents/` do not linger.

Build and test from the repository root, in any build directory:

```sh
cmake -S desktop/kde -B "$build"
cmake --build "$build" -j"$(nproc)"
QT_QPA_PLATFORM=offscreen ctest --test-dir "$build" --output-on-failure
```

ctest runs twelve tests: `appstreamtest` (added by ECM), the unit tests `api`, `connection`, `networktransport` and `timer`, the QtQuickTest `panel`, then `version`, `native-version`, `prune-package`, `stage-install`, `smokeload` and `stage-cleanup`. `native-version` checks `scripts/native-version.sh` (see the packaging node), including dpkg order; the rpm order check is skipped where `rpm` is absent, as on this host. The unit tests use `FakeTransport`, `FakeCredentialStore` and `FakeClock` from `autotests/fakes.h` and never touch the network or the real wallet. `panel` links `KF6::KirigamiPlatform` so its fixture can set `Kirigami.Units.longDuration` for the reduced-motion test, and runs the QML tests in `autotests/qml/` (`tst_panel.qml`) offscreen against `tokklcore` wired to those fakes; it never loads `main.qml` or the real connection. Its fake responses echo the metadata the test scripts into them, so it cannot catch the server losing description or tags on a partial PUT. That behaviour lives in `updateTimeEntry` (`packages/api/src/models/timeEntries.ts`) and needs an API test. `smokeload` loads the widget through libplasma inside a minimal `TestCorona` with an empty containment. libplasma's CMake package does not pull in KF6Config, so the test block calls `find_package(KF6 ... COMPONENTS Config)` itself. The `version` test checks the real root `package.json` only when it exists. `desktop/kde/README.md` is the companion's guide: install, upgrade and remove; adding the widget to a panel; connection settings; accounts and privacy; the panel state table; the timer; packages; CI and releases; and the real Plasma smoke checklist. Build dependencies and install commands are there too. The PRD allows the companion: a narrowed non-goal and requirements C5 and C6 in `docs/PRD.md`. No GitHub release carries the packages yet (v1.0.0 and v1.0.1 have no assets; checked 2026-10-16), so the README tells readers to build them. Native DEB and RPM packages are described in [map-kde-native-packaging](map-kde-native-packaging.md). `desktop/kde/tests` holds a test that is not in CTest: `realservertest.cpp` (QtTest) run against real Tokkl servers by `realserver.test.ts`; see [map-kde-ci-and-release-pipeline](map-kde-ci-and-release-pipeline.md). `npm run typecheck` covers its TypeScript through `desktop/kde/tests/tsconfig.json`.

Two gotchas. A raw string literal (`R"(...)"`) inside a test class once hid `Q_OBJECT` from AutoMoc in the `timer` test, and the link then failed for lack of the moc symbols; a plain literal in a small class compiled fine when tried, so the exact trigger is unverified. If a test target stops linking after a literal is added, look at the literals first. And `package/metadata.json` has `"FormFactors": ["desktop"]`. In KF6 metadata that names the device type (desktop against mobile or tablet), not panel against desktop placement; whether a panel needs another value is unverified on a real Plasma session.

<!-- kk:related:start -->
# Related

- Related: [practice-kde-companion-connection-and-configure-page-rules](practice-kde-companion-connection-and-configure-page-rules.md)
- Related: [map-npm-workspaces-package-layout](map-npm-workspaces-package-layout.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
