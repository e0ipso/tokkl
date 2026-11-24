# kenkeep Index: tooling-and-project / gnome-shell-extension

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**GNOME Shell extension panel button and menu**](map-gnome-shell-extension-panel-button-and-menu.md) to learn about: desktop/gnome/extension drives tokkl-timerd; Shell 46-51; click and key activation; Shell 50 click gesture; Shell 51 key controller #gnome #desktop #tooling
- Open [**GNOME Shell extension CI harnesses and Shell version matrix**](map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md) to learn about: check.sh mock harness per Shell version; realservice.sh against real timerd; waitFor drawn state; gnome-extension CI matrix 46-51 #gnome #ci #testing #desktop
- Open [**GNOME Shell extension packaging and preferences**](map-gnome-shell-extension-packaging-and-preferences.md) to learn about: pack-extension.sh packs every *.js, *.png and *.svg and the D-Bus interface description as extra sources; panel logo tokkl.png; prefs.js keeps only non-secret fields in GSettings #gnome #desktop #tooling #packaging
- Open [**GNOME Shell extension project indicator and chosen project label**](map-gnome-shell-extension-project-indicator-and-chosen-project-label.md) to learn about: projectindicator.js decides, indicator.js draws; pulse check lifts enable-animations; chosenProjectLabel words the service's ChosenProjectLabel parts #gnome #desktop #tooling

## By topic

### #desktop
- Open [**KDE panel: button, menu and project indicator**](../kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #gnome
- Open [**tokkl-timerd daemon composition root and secret storage**](../gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md) — tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the parts TimerService gets; secrets live in QtKeychain.
- Open [**Timer1 Actions, Presentation, Status and AlarmError properties**](../gnome-timer-service/timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md) — Timer1 menu and status properties: core MenuActionStates, StatusPresentation, status keys, shared English words, alarm failures.
- Open [**Timer1 timer, project and Pomodoro limit properties**](../gnome-timer-service/timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md) — Timer1 StartTime, LocalStartTime, ChainSeconds, Running, Paused, CanStartSession, project properties and PomodoroLengthLimits.
### #tooling
- Open [**tokklcore static library and its CTest suites in desktop/core**](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](../kde-companion/plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #ci
- Open [**KDE real-server test**](../kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md) — realservertest.cpp, driven by realserver.test.ts, runs the companion against fixture Tokkl servers behind proxies and checks the data.
- Open [**Tests for release-only CI steps**](../kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md) — release-publish.test.ts runs ci.yml's publish and version-check steps with a stub gh; other release-only KDE code has node:test files.
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../kde-companion/map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**GNOME Shell extension packaging and preferences**](map-gnome-shell-extension-packaging-and-preferences.md) — pack-extension.sh packs every *.js, *.png and *.svg and the D-Bus interface description as extra sources; panel logo tokkl.png; prefs.js keeps only non-secret fields in GSettings
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.