---
type: map
title: macOS menu bar timer actions and Settings window save
description: >-
  click toggles, Start/Stop Timer menu action, server-owned pause and Pomodoro
  state, two-step Keychain save in Settings
tags:
  - desktop
  - macos
kk_schema_version: 3
kk_id: map-macos-menu-bar-timer-actions-and-settings-window-save
kk_derived_from: []
kk_relates_to:
  - map-desktop-timer-state-client-stream-poll-settling-and-revisions
  - map-macos-app-layout-portable-qt-library-and-native-shims
kk_depends_on: []
kk_confidence: high
---
A primary click on the item calls `toggle()` (pause, resume or start). The menu's `startStopAction` (`statusmenu.cpp`) reads Start Timer or, while running or paused, Stop Timer, and calls `start()` or `stop()`. Stop Timer while paused posts a discard to the server, so it needs a connection like every other action; `menubarapptest` covers the offline case. The pause chain and the Pomodoro session are the server's, read through the shared `TimerStateClient` (see `map-desktop-timer-state-client-stream-poll-settling-and-revisions`), so the app stores only its settings, the Pomodoro mode and the sound choices on the Mac. While a session is active, in either mode, Start Timer and Stop Timer are hidden and Next phase and End session carry the revision shown.

The Settings window saves in two steps. It calls `ConnectionSetup::saveSecret(context, done)`, whose callback says whether the Keychain write worked, and writes the URL, auth mode and email and closes only when it did. A failed write keeps the window open with the typed secret. A Keychain write can wait for the user to allow access, so the Save button is disabled meanwhile.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-timer-state-client-stream-poll-settling-and-revisions](../kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md)
- Related: [map-macos-app-layout-portable-qt-library-and-native-shims](map-macos-app-layout-portable-qt-library-and-native-shims.md)
<!-- kk:related:end -->
