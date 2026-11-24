# kenkeep Index: tooling-and-project / kde-companion / plasma-companion

↑ Parent: [kde-companion](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`desktop-cmake-projects/`](desktop-cmake-projects/index.md) for more information on the desktop/core and desktop/kde CMake projects, their libraries, QML types, version stamping and README; read when building or restructuring the desktop C++ code.

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**KDE companion tests: build commands, the CTest suite and its fakes**](map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md) to learn about: Build and ctest commands; fifteen tests in the KDE build, thirteen in core; fakes, private-bus wallet, panel QML tests, two gotchas. #kde #testing
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) to learn about: One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes. #desktop #timer #sse #kde #gnome #macos
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) to learn about: PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse. #kde #desktop
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) to learn about: Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded. #kde #desktop #packaging #troubleshooting

## By topic

### #kde
- Open [**tokklcore static library and its CTest suites in desktop/core**](desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #gnome
- Open [**tokkl-timerd daemon composition root and secret storage**](../../gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md) — tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the parts TimerService gets; secrets live in QtKeychain.
- Open [**Timer1 Actions, Presentation, Status and AlarmError properties**](../../gnome-timer-service/timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md) — Timer1 menu and status properties: core MenuActionStates, StatusPresentation, status keys, shared English words, alarm failures.
- Open [**Timer1 timer, project and Pomodoro limit properties**](../../gnome-timer-service/timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md) — Timer1 StartTime, LocalStartTime, ChainSeconds, Running, Paused, CanStartSession, project properties and PomodoroLengthLimits.
### #macos
- Open [**macOS bundle icon and NSStatusItem status image**](../../macos-menu-bar-app/map-macos-bundle-icon-and-nsstatusitem-status-image.md) — Tokkl.iconset to Tokkl.icns via iconutil; ProjectIndicator, StatusImage and macstatusitem.mm drawing; why NSStatusItem
- Open [**macOS menu bar timer actions and Settings window save**](../../macos-menu-bar-app/map-macos-menu-bar-timer-actions-and-settings-window-save.md) — click toggles, Start/Stop Timer menu action, server-owned pause and Pomodoro state, two-step Keychain save in Settings
- Open [**macOS app layout: portable Qt library and native shims**](../../macos-menu-bar-app/map-macos-app-layout-portable-qt-library-and-native-shims.md) — Tokkl.app on tokklcore: standalone CMake, LSUIElement, macOS 13; Linux-testable src/ library and the three .mm shims
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**GNOME Shell extension packaging and preferences**](../../gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md) — pack-extension.sh packs every *.js, *.png and *.svg and the D-Bus interface description as extra sources; panel logo tokkl.png; prefs.js keeps only non-secret fields in GSettings
### #sse
- Open [**Asynchronous ordered timer delivery after commit**](../../../api-and-data/timer-state/timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](../../../api-and-data/timer-state/timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](../../../api-and-data/timer-state/timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../../web-ui-behaviour/pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
### #troubleshooting
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) — Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded.