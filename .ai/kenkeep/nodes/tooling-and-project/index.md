# kenkeep Index: tooling-and-project

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`kde-companion/`](kde-companion/index.md) for more information on the KDE Plasma companion and desktop/core: layout, timer and connection rules, native packages, CI and release; read before changing anything under desktop/ or the kde release job.
- Load [`repo-and-scripts/`](repo-and-scripts/index.md) for more information on npm workspace layout, commit message rules, the Tokkl rename fallbacks, and the screenshot and icon scripts; read before adding a package or script, committing, or regenerating images.
- Load [`testing/`](testing/index.md) for more information on the Playwright e2e suite, visual baselines, what npm test and typecheck run, and the history bench; read before adding, running or debugging a test, spec or benchmark.

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) to learn about: tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container. #tooling #desktop #gnome #ci
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](map-macos-menu-bar-app.md) to learn about: desktop/macos splits a Linux-testable Qt library from three macOS-only shims; why NSStatusItem; what the macos CI job covers. #tooling #desktop #macos #ci

## By topic

### #ci
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](map-macos-menu-bar-app.md) — desktop/macos splits a Linux-testable Qt library from three macOS-only shims; why NSStatusItem; what the macos CI job covers.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #tooling
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #gnome
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #macos
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](map-macos-menu-bar-app.md) — desktop/macos splits a Linux-testable Qt library from three macOS-only shims; why NSStatusItem; what the macos CI job covers.