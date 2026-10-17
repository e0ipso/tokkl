# kenkeep Index: tooling-and-project / kde-companion / plasma-companion

↑ Parent: [kde-companion](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) to learn about: tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide. #kde #desktop #tooling
- Open [**KDE companion tests: build commands, the CTest suite and its fakes**](map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md) to learn about: Build and ctest commands; fourteen tests in the KDE build, four in core; fakes, private-bus wallet, panel QML tests, two gotchas. #kde #testing
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) to learn about: PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion. #kde #desktop

## By topic

### #kde
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #desktop
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #tooling
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](../../map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; check.sh mock harness, realservice.sh real service.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.