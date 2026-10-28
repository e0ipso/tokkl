# kenkeep Index: tooling-and-project / kde-companion / plasma-companion

↑ Parent: [kde-companion](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) to learn about: tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README. #kde #desktop #tooling
- Open [**KDE companion tests: build commands, the CTest suite and its fakes**](map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md) to learn about: Build and ctest commands; fifteen tests in the KDE build, four in core; fakes, private-bus wallet, panel QML tests, two gotchas. #kde #testing
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) to learn about: One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes. #desktop #timer #sse #kde #gnome #macos
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) to learn about: PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse. #kde #desktop
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) to learn about: Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded. #kde #desktop #packaging #troubleshooting

## By topic

### #kde
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #gnome
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](../../map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; Shell 51 key controller; check.sh mock harness; realservice.sh.
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) — One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes.
### #macos
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) — One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes.
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](../../map-macos-menu-bar-app.md) — desktop/macos: a Linux-testable Qt library and three macOS shims; click and menu actions, the bundle icon, NSStatusItem, the CI job.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) — Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded.
### #sse
- Open [**Timer event stream: keep-alive, credential rechecks and the stream cap**](../../../api-and-data/timer-state/map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md) — GET /api/app/timer/events sends the full state on connect and each change, a keep-alive every 25 s, and ends when the credential stops passing.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) — One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #timer
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../../../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../../../web-ui-behaviour/pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #tooling
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](../map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #troubleshooting
- Open [**Tokkl KDE live widgets reload with plasmashell**](map-tokkl-kde-live-widgets-reload-with-plasmashell.md) — Tokkl runs inside plasmashell; package metadata and the logo can refresh while an existing process keeps the old widget QML loaded.