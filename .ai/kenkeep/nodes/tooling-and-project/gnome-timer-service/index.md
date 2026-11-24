# kenkeep Index: tooling-and-project / gnome-timer-service

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`timer1-d-bus-contract/`](timer1-d-bus-contract/index.md) for more information on the tokkl-timerd daemon and its org.tokkl.Timer1 D-Bus contract: members, versioning, properties, signals and methods; read before changing the GNOME service or its interface.

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**GNOME timer service activation and packaging**](map-gnome-timer-service-activation-and-packaging.md) to learn about: Headless Qt dependency checks, D-Bus/systemd activation and Debian/Fedora packaging run in pinned containers. #desktop #gnome #ci #packaging

## By topic

### #ci
- Open [**KDE real-server test**](../kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md) — realservertest.cpp, driven by realserver.test.ts, runs the companion against fixture Tokkl servers behind proxies and checks the data.
- Open [**Tests for release-only CI steps**](../kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md) — release-publish.test.ts runs ci.yml's publish and version-check steps with a stub gh; other release-only KDE code has node:test files.
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](../kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #gnome
- Open [**tokkl-timerd daemon composition root and secret storage**](timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md) — tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the parts TimerService gets; secrets live in QtKeychain.
- Open [**Timer1 Actions, Presentation, Status and AlarmError properties**](timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md) — Timer1 menu and status properties: core MenuActionStates, StatusPresentation, status keys, shared English words, alarm failures.
- Open [**Timer1 timer, project and Pomodoro limit properties**](timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md) — Timer1 StartTime, LocalStartTime, ChainSeconds, Running, Paused, CanStartSession, project properties and PomodoroLengthLimits.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../kde-companion/map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**GNOME Shell extension packaging and preferences**](../gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md) — pack-extension.sh packs every *.js, *.png and *.svg and the D-Bus interface description as extra sources; panel logo tokkl.png; prefs.js keeps only non-secret fields in GSettings