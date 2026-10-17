---
type: map
title: 'KDE companion tests: build commands, the CTest suite and its fakes'
description: >-
  Build and ctest commands; fourteen tests in the KDE build, four in core;
  fakes, private-bus wallet, panel QML tests, two gotchas.
tags:
  - kde
  - testing
kk_schema_version: 3
kk_id: map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
kk_derived_from: []
kk_relates_to:
  - map-test-and-static-analysis-layout
  - map-kde-ci-and-release-pipeline
  - map-kde-native-packaging
kk_depends_on: []
kk_confidence: high
---
Build and test from the repository root, in any build directory:

```sh
cmake -S desktop/kde -B "$build"
cmake --build "$build" -j"$(nproc)"
QT_QPA_PLATFORM=offscreen ctest --test-dir "$build" --output-on-failure
```

In the KDE build ctest runs fourteen tests, the four core ones included. Configured alone, `desktop/core` lists only those four (`api`, `connection`, `networktransport`, `timer`) and needs no Qt Gui; `desktop/core/ci/check.sh` enforces that (see `map-kde-ci-and-release-pipeline`). The fourteen are: `appstreamtest` (added by ECM), the unit tests `api`, `connection`, `networktransport` and `timer`, the KDE tests `kdeconnection` and `kdewallet-disabled`, the QtQuickTest `panel`, then `version`, `native-version`, `prune-package`, `stage-install`, `smokeload` and `stage-cleanup`. `native-version` checks `scripts/native-version.sh` (see the packaging node), including dpkg order; the rpm order check is skipped where `rpm` is absent, as on this host. The unit tests use `FakeTransport`, `FakeCredentialStore` and `FakeClock` from `desktop/core/autotests/fakes.h` and never touch the network or the real wallet. `kdeconnection` and `kdewallet-disabled` link `tokklkde`; `kdeconnection` also needs Qt6 DBus and a `dbus-daemon`, required only with `BUILD_TESTING`. `kdeconnection` runs the real KDE Wallet client against a fake `kwalletd` on a private `dbus-daemon` that the test starts with no service files, and it fails unless the bus the wallet uses has the same id as that daemon, so the user's session bus and wallet are never reached. An in-process HTTP server on 127.0.0.1 stands in for Tokkl. A new test that needs an enabled wallet must use that private-bus fake, never the inherited session bus. KDE Wallet reads `Enabled` from `kwalletrc` once per process (`Wallet::isEnabled()` returns a cached value; seen with KWallet 6.24), so the disabled-wallet case is its own test, `kdewallet-disabled`, run in its own process with a temporary `kwalletrc`. `panel` links `KF6::KirigamiPlatform` so its fixture can set `Kirigami.Units.longDuration` for the reduced-motion test, and runs the QML tests in `autotests/qml/` (`tst_panel.qml`, and `tst_configure.qml`, which loads the real `configGeneral.qml` with `FakeConnectionSetup` and `WalletFixture` from `panelquicktest.cpp`) offscreen against `tokklcore` wired to those fakes; the panel tests never load `main.qml` or the real connection. Its fake responses echo the metadata the test scripts into them, so it cannot catch the server losing description or tags on a partial PUT. That behaviour lives in `updateTimeEntry` (`packages/api/src/models/timeEntries.ts`) and needs an API test. `smokeload` loads the widget through libplasma inside a minimal `TestCorona` with an empty containment. libplasma's CMake package does not pull in KF6Config, so the test block calls `find_package(KF6 ... COMPONENTS Config)` itself. The `version` test checks the real root `package.json` only when it exists. Native DEB and RPM packages are described in `map-kde-native-packaging`. `desktop/kde/tests` holds a test that is not in CTest: `realservertest.cpp` (QtTest) run against real Tokkl servers by `realserver.test.ts`; see `map-kde-ci-and-release-pipeline`. `npm run typecheck` covers its TypeScript through `desktop/kde/tests/tsconfig.json`.

Two gotchas. A raw string literal (`R"(...)"`) inside a test class once hid `Q_OBJECT` from AutoMoc in the `timer` test, and the link then failed for lack of the moc symbols; a plain literal in a small class compiled fine when tried, so the exact trigger is unverified. If a test target stops linking after a literal is added, look at the literals first. And `package/metadata.json` has `"FormFactors": ["desktop"]`. In KF6 metadata that names the device type (desktop against mobile or tablet), not panel against desktop placement; whether a panel needs another value is unverified on a real Plasma session.

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](../../testing/map-test-and-static-analysis-layout.md)
- Related: [map-kde-ci-and-release-pipeline](../map-kde-ci-and-release-pipeline.md)
- Related: [map-kde-native-packaging](../map-kde-native-packaging.md)
<!-- kk:related:end -->
