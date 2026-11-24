# kenkeep Index: tooling-and-project / kde-companion

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`connection-and-credentials/`](connection-and-credentials/index.md) for more information on the KDE companion's HTTP client, access kinds, settings generations, credential stores and Configure page; read before changing desktop connection, auth, KWallet or configGeneral.qml code.
- Load [`kde-ci-and-release-pipeline/`](kde-ci-and-release-pipeline/index.md) for more information on the kde and core CI jobs, the KDE real-server test, the three-stage release with its semantic-release plugin and GNOME assets, and the tests for release-only steps; read before changing ci.yml, desktop/kde/ci or .releaserc.json.
- Load [`plasma-companion/`](plasma-companion/index.md) for more information on the desktop/core and desktop/kde projects, the panel UI and the CTest suite; read before changing desktop CMake, panel QML or desktop tests.

## Conventions (how we build)
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) to learn about: TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused. #kde #desktop
- Open [**Isolate HOME and XDG dirs before running plasmawindowed checks**](practice-isolate-home-and-xdg-dirs-before-running-plasmawindowed-checks.md) to learn about: Export throwaway HOME and XDG_* dirs before dbus-run-session when running the plasmoid in plasmawindowed; use a stand-in kwalletd. #kde #testing #desktop #plasmoid

## Components (what exists)
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) to learn about: tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping. #tooling #kde #packaging #release
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](map-kde-release-upgrade-check-from-the-published-predecessor.md) to learn about: Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable. #tooling #kde #release #packaging
- Open [**KDE CI dependency images: image-id.sh identity, Actions cache, weekly refresh**](map-kde-ci-dependency-image-cache.md) to learn about: container-check.sh reuses images labelled with image-id.sh's hash; CI caches them per format and rebuilds them weekly or after gh cache delete. #tooling #kde #ci #docker

## By topic

### #kde
- Open [**tokklcore static library and its CTest suites in desktop/core**](plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #tooling
- Open [**tokklcore static library and its CTest suites in desktop/core**](plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**GNOME Shell extension packaging and preferences**](../gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md) — pack-extension.sh packs every *.js, *.png and *.svg and the D-Bus interface description as extra sources; panel logo tokkl.png; prefs.js keeps only non-secret fields in GSettings
### #release
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
### #ci
- Open [**KDE real-server test**](kde-ci-and-release-pipeline/map-kde-real-server-test.md) — realservertest.cpp, driven by realserver.test.ts, runs the companion against fixture Tokkl servers behind proxies and checks the data.
- Open [**Tests for release-only CI steps**](kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md) — release-publish.test.ts runs ci.yml's publish and version-check steps with a stub gh; other release-only KDE code has node:test files.
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
### #docker
- Open [**Container image ghcr.io/e0ipso/tokkl**](../map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
- Open [**KDE CI dependency images: image-id.sh identity, Actions cache, weekly refresh**](map-kde-ci-dependency-image-cache.md) — container-check.sh reuses images labelled with image-id.sh's hash; CI caches them per format and rebuilds them weekly or after gh cache delete.
### #plasmoid
- Open [**Isolate HOME and XDG dirs before running plasmawindowed checks**](practice-isolate-home-and-xdg-dirs-before-running-plasmawindowed-checks.md) — Export throwaway HOME and XDG_* dirs before dbus-run-session when running the plasmoid in plasmawindowed; use a stand-in kwalletd.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.