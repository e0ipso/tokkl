# kenkeep Index: tooling-and-project / macos-menu-bar-app

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**macOS app layout: portable Qt library and native shims**](map-macos-app-layout-portable-qt-library-and-native-shims.md) to learn about: Tokkl.app on tokklcore: standalone CMake, LSUIElement, macOS 13; Linux-testable src/ library and the three .mm shims #tooling #desktop #macos
- Open [**macOS bundle icon and NSStatusItem status image**](map-macos-bundle-icon-and-nsstatusitem-status-image.md) to learn about: Tokkl.iconset to Tokkl.icns via iconutil; ProjectIndicator, StatusImage and macstatusitem.mm drawing; why NSStatusItem #desktop #macos
- Open [**macOS CI job and DMG release publishing**](map-macos-ci-job-and-dmg-release-publishing.md) to learn about: macos CI job (pinned Qt, QtKeychain, CTest, DMG checks) and the macos-release/macos-publish jobs that attach the DMG #tooling #macos #ci
- Open [**macOS menu bar timer actions and Settings window save**](map-macos-menu-bar-timer-actions-and-settings-window-save.md) to learn about: click toggles, Start/Stop Timer menu action, server-owned pause and Pomodoro state, two-step Keychain save in Settings #desktop #macos

## By topic

### #macos
- Open [**macOS bundle icon and NSStatusItem status image**](map-macos-bundle-icon-and-nsstatusitem-status-image.md) — Tokkl.iconset to Tokkl.icns via iconutil; ProjectIndicator, StatusImage and macstatusitem.mm drawing; why NSStatusItem
- Open [**macOS menu bar timer actions and Settings window save**](map-macos-menu-bar-timer-actions-and-settings-window-save.md) — click toggles, Start/Stop Timer menu action, server-owned pause and Pomodoro state, two-step Keychain save in Settings
- Open [**macOS app layout: portable Qt library and native shims**](map-macos-app-layout-portable-qt-library-and-native-shims.md) — Tokkl.app on tokklcore: standalone CMake, LSUIElement, macOS 13; Linux-testable src/ library and the three .mm shims
### #desktop
- Open [**KDE panel: button, menu and project indicator**](../kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #tooling
- Open [**tokklcore static library and its CTest suites in desktop/core**](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](../kde-companion/plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #ci
- Open [**KDE real-server test**](../kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md) — realservertest.cpp, driven by realserver.test.ts, runs the companion against fixture Tokkl servers behind proxies and checks the data.
- Open [**Tests for release-only CI steps**](../kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md) — release-publish.test.ts runs ci.yml's publish and version-check steps with a stub gh; other release-only KDE code has node:test files.
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.