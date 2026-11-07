---
type: map
title: GNOME timer service and D-Bus contract
description: >-
  tokkl-timerd wraps shared timer state and exposes org.tokkl.Timer1 with
  additive D-Bus contract rules.
tags:
  - desktop
  - gnome
  - dbus
kk_schema_version: 3
kk_id: map-gnome-timer-service-and-d-bus-contract
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-gnome-shell-extension-for-tokkl-timerd
  - map-desktop-timer-state-client-stream-poll-settling-and-revisions
kk_depends_on: []
kk_confidence: high
---
`desktop/gnome/` builds `tokkl-timerd`, a headless Qt service that runs the shared `tokklcore` (`desktop/core`) and adds no timer rule of its own. The running entry, the pause chain and the Pomodoro session are the server's, read through one `TimerStateClient`, so a change on any device shows in either mode; the service stores only the Pomodoro mode and the sound choices. It owns `org.tokkl.Timer1` at `/org/tokkl/Timer1` on the session bus. A GNOME panel extension or any other client drives it over D-Bus. Requests carry the client name `tokkl-gnome`.

`desktop/gnome/src/main.cpp` is the daemon's composition root: it builds the settings file, clock, connection, `TimerController` and its `TimerStateClient`, Pomodoro store, sound choices, preferences client, session (on the timer's coordinator), `ServiceSettings` and `ConfigurationAdapter`, and hands `TimerService` its `Parts`. `TimerService` builds nothing; it reads the timer's `TimerModel`, acts through its `TimerCoordinator`, and maps properties and methods onto the bus. `ConfigurationAdapter` (`desktop/gnome/src/configurationadapter.h`) owns `Configure`: it calls `ServiceSettings::configure` and sends the delayed reply or error once the credential store has answered. `autotests/timerservicetest.cpp` builds the same graph in its `Daemon` struct, in the same order as `main.cpp`; change both together.

The interface description is `desktop/gnome/dbus/org.tokkl.Timer1.xml`. It lives in `dbus/` because the root `.gitignore` ignores `data/`. Contract rules:

- Properties are `Running`, `StartTime`, `LocalStartTime`, `Paused`, `ChainSeconds`, `IndicatorState`, `IndicatorColor`, `Projects`, `ProjectsIncomplete`, `ChosenProject`, `ChosenProjectName`, `Billable`, `Status` and `ErrorString`, the Pomodoro ones, among them `SessionActive` and `CanStartSession`, and `Actions`. Methods are `Start`, `Stop`, `Pause`, `Resume`, `SetProject`, `SetBillable` and `Configure`. Add members only; existing clients read the old ones.
- `StartTime` is the server's start in Unix seconds, 0 when stopped or paused; it keeps that meaning for older clients. `LocalStartTime` is the same start on this machine's clock, the server's start minus `TimerStateClient::serverOffsetMs()`, so on a machine whose clock differs from the server's the extension shows the elapsed time the KDE and macOS apps show. `ChainSeconds` is what the server stored for the entries the chain's pauses stopped, 0 without a chain, so elapsed time is `ChainSeconds` plus the clock minus `LocalStartTime` while running, and `ChainSeconds` alone while paused. The extension falls back to `StartTime` when a service from before `LocalStartTime` lacks it. While `Paused` is true, `Running` is false. `Pause` stops the running entry and keeps the chain; `Resume` starts its clone; `Stop` ends the chain and, while paused, asks the server to discard it, which needs a connection (see `practice-kde-timer-controller-rules`). `Running` stays false during a session, whose open pomodoro is not a timer; `Start`, `Stop`, `Pause` and `Resume` return false while a session is active. `CanStartSession` is true when Pomodoro mode is on, no session action waits, and `TimerModel::canStartNew()` holds: the timer can write (no 429 cooldown, workspace not lost, no write or settling in flight, a state read), nothing runs and no session is active. `StartSession` is allowed only then. Do not enable the extension's Start session item from other properties.
- `Actions` (`a{sa{sv}}`) is the core's `MenuActionStates` with `MenuActionPolicy::gnome()`: for run, startSession, nextPhase, endSession, project, billable and mode it gives visible, enabled (false whenever visible is) and the label key ("start" or "stop", the upcoming phase, "projectRunning" or "projectPaused" while locked, "pomodoroModeLocked"). The extension renders its menu from it. Without it, from no service or one from before `Actions`, the extension falls back to the rules it had before (`extension/legacyactions.js`), as an extension updated from extensions.gnome.org often meets an older packaged service. The other properties stay for older clients.
- The interface description is the one source of the contract. `scripts/pack-extension.sh` copies it into the extension zip, `timer1proxy.js` reads it next to itself (`TIMER1_XML_FILE` in `timer1.js`) and builds the proxy from it, and `ci/shell-test.sh` packs it the same way. `ChosenProject` 0 means no project. `ChosenProjectName` is the name of the project the core resolved for the running entry, archived projects included; while stopped it comes from `Projects`. `Projects` alone cannot name an archived running project, so clients read `ChosenProjectName` for the label. It is declared in `dbus/org.tokkl.Timer1.xml`. `Projects` and `ProjectsIncomplete` come from the core's `ProjectChoices`; `ProjectsIncomplete` is true when the workspace has more active projects than the paging limit let the service read, and the extension's project menu then shows the note the KDE and macOS menus show.
- `PropertiesChanged` lists only the properties whose value changed since the last signal, never the whole set.
- `Configure` with an empty secret keeps the secret the credential store holds for that account. A nonempty one is saved first; if the store refuses, the call fails with `org.tokkl.Timer1.Error.CredentialStore` (`ConfigurationAdapter::credentialStoreError`) and the settings stay as they were.
- `Activate` returns "ignored" whenever nothing applied, also in Timer mode when the timer's toggle sent nothing (no account, no state read, a write waiting). The extension acts only on "open-menu".
- Secrets live in QtKeychain: libsecret (GNOME Keyring) on GNOME, KWallet if the desktop is KDE.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](../gnome-shell-extension/map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-packaging-and-preferences](../gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-panel-button-and-menu](../gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-project-indicator-and-chosen-project-label](../gnome-shell-extension/map-gnome-shell-extension-project-indicator-and-chosen-project-label.md)
- Related: [map-desktop-timer-state-client-stream-poll-settling-and-revisions](../kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md)
<!-- kk:related:end -->
