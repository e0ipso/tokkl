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
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) to learn about: Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded. #kde #desktop #packaging #troubleshooting

## By topic

### #kde
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) — Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #tooling
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](../map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #troubleshooting
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) — Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded.