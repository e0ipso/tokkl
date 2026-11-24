---
type: map
title: 'Timer1 timer, project and Pomodoro limit properties'
description: >-
  Timer1 StartTime, LocalStartTime, ChainSeconds, Running, Paused,
  CanStartSession, project properties and PomodoroLengthLimits.
tags:
  - gnome
  - dbus
  - desktop
kk_schema_version: 3
kk_id: map-timer1-timer-project-and-pomodoro-limit-properties
kk_derived_from: []
kk_relates_to:
  - map-desktop-timer-state-client-stream-poll-settling-and-revisions
  - map-gnome-shell-extension-project-indicator-and-chosen-project-label
  - map-org-tokkl-timer1-interface-file-members-and-interfaceversion
kk_depends_on: []
kk_confidence: high
---
- `StartTime` is the server's start in Unix seconds, 0 when stopped or paused; it keeps that meaning for third-party callers and is deprecated in favour of `LocalStartTime`. `LocalStartTime` is the same start on this machine's clock, the server's start minus `TimerStateClient::serverOffsetMs()`, so on a machine whose clock differs from the server's the extension shows the elapsed time the KDE and macOS apps show. `ChainSeconds` is what the server stored for the entries the chain's pauses stopped, 0 without a chain, so elapsed time is `ChainSeconds` plus the clock minus `LocalStartTime` while running, and `ChainSeconds` alone while paused. The extension reads `LocalStartTime` alone. While `Paused` is true, `Running` is false. `Pause` stops the running entry and keeps the chain; `Resume` starts its clone; `Stop` ends the chain and, while paused, asks the server to discard it, which needs a connection (see `practice-kde-timer-controller-rules`). `Running` stays false during a session, whose open pomodoro is not a timer; `Start`, `Stop`, `Pause` and `Resume` return false while a session is active. `CanStartSession` is true when Pomodoro mode is on, no session action waits, and `TimerModel::canStartNew()` holds: the timer can write (no 429 cooldown, workspace not lost, no write or settling in flight, a state read), nothing runs and no session is active. `StartSession` is allowed only then. Do not enable the extension's Start session item from other properties.
- `ChosenProject` 0 means no project. `ChosenProjectName` is the name in `ChosenProjectLabel`. `ChosenProjectLabel` (`a{sv}`) is the core's `ProjectLabelParts` of the chosen project (`TimerModel::chosenProjectLabel()`): `kind` (`none`, `unknown`, `unavailable` or `named`), name, client, archived and missing, archived running projects included. The extension maps the kind to its words as the KDE and macOS menus map the same parts; `kind` was added within version 2, which no release had published before. It is declared in `dbus/org.tokkl.Timer1.xml`. `Projects` and `ProjectsIncomplete` come from the core's `ProjectChoices`; `ProjectsIncomplete` is true when the workspace has more active projects than the paging limit let the service read, and the extension's project menu then shows the note the KDE and macOS menus show.
- `PomodoroLengthLimits` (`a{sa{si}}`) is `PomodoroPreferences::limits()` keyed as `PomodoroLengths`, each with min, max and default: the `pomodoro_limits` of the server's `GET /api/app/status` (`PomodoroLimits`), kept until another server announces its own, and `PomodoroLimits::placeholder()` (1 to 999) before the first. It changes with them, with `PropertiesChanged`. The extension's preferences build their ranges from it and keep none of their own.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-timer-state-client-stream-poll-settling-and-revisions](../../kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md)
- Related: [map-gnome-shell-extension-project-indicator-and-chosen-project-label](../../gnome-shell-extension/map-gnome-shell-extension-project-indicator-and-chosen-project-label.md)
- Related: [map-org-tokkl-timer1-interface-file-members-and-interfaceversion](map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
<!-- kk:related:end -->
