# kenkeep Index: tooling-and-project / kde-companion

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`plasma-companion/`](plasma-companion/index.md) for more information on the desktop/core and desktop/kde projects, the panel UI and the CTest suite; read before changing desktop CMake, panel QML or desktop tests.

## Conventions (how we build)
- Open [**KDE companion: connection errors, settings generations and the Configure page**](practice-kde-companion-connection-and-configure-page-rules.md) to learn about: Access kinds decide what a 401/403 means; old-generation replies drop; cfg_instanceUrl holds only persistedUrl(); secrets only in KWallet. #kde #desktop #auth #configuration
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) to learn about: TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT. #kde #desktop

## Components (what exists)
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) to learn about: tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping. #tooling #kde #packaging #release
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) to learn about: The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release. #tooling #kde #ci #release

## By topic

### #kde
- Open [**KDE panel: button, menu and project indicator**](plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #release
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
### #tooling
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #auth
- Open [**Password checks go through FailureLimiter.attempt**](../../api-and-data/password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword.
- Open [**Cookie writes and session-starting routes need the CSRF header**](../../api-and-data/password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup and invite accept need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
- Open [**Users, roles and workspace membership**](../../api-and-data/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.
### #ci
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
### #configuration
- Open [**KDE companion: connection errors, settings generations and the Configure page**](practice-kde-companion-connection-and-configure-page-rules.md) — Access kinds decide what a 401/403 means; old-generation replies drop; cfg_instanceUrl holds only persistedUrl(); secrets only in KWallet.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.