# kenkeep Index: tooling-and-project / kde-companion / plasma-companion / desktop-cmake-projects

↑ Parent: [plasma-companion](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**tokklcore static library and its CTest suites in desktop/core**](map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) to learn about: tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests. #desktop #tooling #kde
- Open [**KDE QML_FOREIGN types and backend module linking**](map-kde-qml-foreign-types-and-backend-module-linking.md) to learn about: qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround. #kde #desktop #tooling
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) to learn about: tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name. #kde #desktop
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) to learn about: desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums. #kde #desktop #tooling
- Open [**Desktop version resolution and Plasma metadata stamping**](map-desktop-version-resolution-and-plasma-metadata-stamping.md) to learn about: TokklVersion.cmake reads the root package.json unless -DTOKKL_VERSION is set; TokklMetadata.cmake stamps the widget package. #kde #desktop #tooling
- Open [**desktop/kde README guide, PRD scope and release assets**](map-desktop-kde-readme-guide-prd-scope-and-release-assets.md) to learn about: desktop/kde/README.md sections, PRD requirements C5 and C6, and why readers build the packages themselves. #kde #desktop

## By topic

### #desktop
- Open [**KDE panel: button, menu and project indicator**](../map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../../practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #kde
- Open [**tokklcore static library and its CTest suites in desktop/core**](map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #tooling
- Open [**tokklcore static library and its CTest suites in desktop/core**](map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.