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

The interface description is `desktop/gnome/dbus/org.tokkl.Timer1.xml`. It lives in `dbus/` because the root `.gitignore` ignores `data/`. Contract rules:

- Properties are `Running`, `StartTime`, `Paused`, `ChainSeconds`, `IndicatorState`, `IndicatorColor`, `Projects`, `ChosenProject`, `ChosenProjectName`, `Billable`, `Status` and `ErrorString`, and the Pomodoro ones, among them `SessionActive` and `CanStartSession`. Methods are `Start`, `Stop`, `Pause`, `Resume`, `SetProject`, `SetBillable` and `Configure`. Add members only; existing clients read the old ones.
- `StartTime` is Unix seconds, 0 when stopped or paused. `ChainSeconds` is what the server stored for the entries the chain's pauses stopped, 0 without a chain, so elapsed time is `ChainSeconds` plus the clock minus `StartTime` while running, and `ChainSeconds` alone while paused. While `Paused` is true, `Running` is false. `Pause` stops the running entry and keeps the chain; `Resume` starts its clone; `Stop` ends the chain and, while paused, asks the server to discard it, which needs a connection (see `practice-kde-timer-controller-rules`). `Running` stays false during a session, whose open pomodoro is not a timer; `Start`, `Stop`, `Pause` and `Resume` return false while a session is active. `CanStartSession` is true when Pomodoro mode is on, nothing runs, no session is active, an account is connected and a state has been read, and `StartSession` is allowed only then. Do not enable the extension's Start session item from other properties.
- `desktop/gnome/extension/timer1.js` holds a copy of the interface without its comments (`TIMER1_INTERFACE`), and `tests/timer1.test.js` fails when the two differ, so change both together. `ChosenProject` 0 means no project. `ChosenProjectName` is the name of the project the core resolved for the running entry, archived projects included; while stopped it comes from `Projects`. `Projects` alone cannot name an archived running project, so clients read `ChosenProjectName` for the label. It is declared in `dbus/org.tokkl.Timer1.xml`.
- `PropertiesChanged` lists only the properties whose value changed since the last signal, never the whole set.
- `Configure` with an empty secret keeps the secret the credential store holds for that account. A nonempty one is saved first; if the store refuses, the call fails with `org.tokkl.Timer1.Error.CredentialStore` and the settings stay as they were.
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
