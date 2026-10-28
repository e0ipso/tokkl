# kenkeep Index: tooling-and-project / kde-companion

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`connection-and-credentials/`](connection-and-credentials/index.md) for more information on the KDE companion's HTTP client, access kinds, settings generations, credential stores and Configure page; read before changing desktop connection, auth, KWallet or configGeneral.qml code.
- Load [`plasma-companion/`](plasma-companion/index.md) for more information on the desktop/core and desktop/kde projects, the panel UI and the CTest suite; read before changing desktop CMake, panel QML or desktop tests.

## Conventions (how we build)
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) to learn about: TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused. #kde #desktop

## Components (what exists)
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) to learn about: The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>. #tooling #kde #ci #release
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) to learn about: tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping. #tooling #kde #packaging #release
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](map-kde-release-upgrade-check-from-the-published-predecessor.md) to learn about: Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable. #tooling #kde #release #packaging
- Open [**KDE CI dependency images: image-id.sh identity, Actions cache, weekly refresh**](map-kde-ci-dependency-image-cache.md) to learn about: container-check.sh reuses images labelled with image-id.sh's hash; CI caches them per format and rebuilds them weekly or after gh cache delete. #tooling #kde #ci #docker

## By topic

### #kde
- Open [**KDE panel: button, menu and project indicator**](plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #tooling
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #release
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
### #ci
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](../map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; Shell 51 key controller; check.sh mock harness; realservice.sh.
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](../map-macos-menu-bar-app.md) — desktop/macos: a Linux-testable Qt library and three macOS shims; click and menu actions, the bundle icon, NSStatusItem, the CI job.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**Tokkl KDE live widgets reload with plasmashell**](plasma-companion/map-tokkl-kde-live-widgets-reload-with-plasmashell.md) — Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #docker
- Open [**KDE CI dependency images: image-id.sh identity, Actions cache, weekly refresh**](map-kde-ci-dependency-image-cache.md) — container-check.sh reuses images labelled with image-id.sh's hash; CI caches them per format and rebuilds them weekly or after gh cache delete.
- Open [**Container image ghcr.io/e0ipso/tokkl**](../map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.