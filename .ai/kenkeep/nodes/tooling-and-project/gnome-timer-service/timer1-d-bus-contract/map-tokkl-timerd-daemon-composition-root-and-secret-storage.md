---
type: map
title: tokkl-timerd daemon composition root and secret storage
description: >-
  tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the
  parts TimerService gets; secrets live in QtKeychain.
tags:
  - desktop
  - gnome
  - dbus
kk_schema_version: 3
kk_id: map-tokkl-timerd-daemon-composition-root-and-secret-storage
kk_derived_from: []
kk_relates_to:
  - map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core
  - map-desktop-timer-state-client-stream-poll-settling-and-revisions
  - map-org-tokkl-timer1-interface-file-members-and-interfaceversion
kk_depends_on: []
kk_confidence: high
---
`desktop/gnome/` builds `tokkl-timerd`, a headless Qt service that runs the shared `tokklcore` (`desktop/core`) and adds no timer rule of its own. The running entry, the pause chain and the Pomodoro session are the server's, read through one `TimerStateClient`, so a change on any device shows in either mode; the service stores only the Pomodoro mode and the sound choices. It owns `org.tokkl.Timer1` at `/org/tokkl/Timer1` on the session bus. A GNOME panel extension or any other client drives it over D-Bus. Requests carry the client name `tokkl-gnome`.

`desktop/gnome/src/main.cpp` is the daemon's composition root: it builds the settings file, clock, Pomodoro store, the core's `TimerStack` (connection, `TimerController` and its `TimerStateClient`, preferences client and session on the timer), sound choices, and `ServiceSettings`, and hands `TimerService` its `Parts`. `TimerService` builds nothing; it reads and acts through the `TimerController` and maps properties and methods onto the bus. `TimerService::Configure` calls `ServiceSettings::configure` and sends the delayed reply or error once the credential store has answered. `autotests/timerservicetest.cpp` builds the same graph in its `Daemon` struct, in the same order as `main.cpp`; change both together.

Secrets live in QtKeychain: libsecret (GNOME Keyring) on GNOME, KWallet if the desktop is KDE.

<!-- kk:related:start -->
# Related

- Related: [map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](../../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
- Related: [map-desktop-timer-state-client-stream-poll-settling-and-revisions](../../kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md)
- Related: [map-org-tokkl-timer1-interface-file-members-and-interfaceversion](map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
<!-- kk:related:end -->
