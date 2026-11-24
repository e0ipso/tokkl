---
type: map
title: 'Timer1 Actions, Presentation, Status and AlarmError properties'
description: >-
  Timer1 menu and status properties: core MenuActionStates, StatusPresentation,
  status keys, shared English words, alarm failures.
tags:
  - gnome
  - dbus
  - desktop
kk_schema_version: 3
kk_id: map-timer1-actions-presentation-status-and-alarmerror-properties
kk_derived_from: []
kk_relates_to:
  - map-gnome-shell-extension-panel-button-and-menu
  - map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core
  - map-org-tokkl-timer1-interface-file-members-and-interfaceversion
kk_depends_on: []
kk_confidence: high
---
- `Actions` (`a{sa{sv}}`) is the core's `MenuActionStates` with `waitForReady`: for run, startSession, nextPhase, endSession, project, billable and mode it gives visible, enabled (false whenever visible is; project and billable are disabled during a session, as `TimerModel::canChooseProject()` and `canChooseBillable()` say) and the label key ("start" or "stop", the upcoming phase, "projectRunning" or "projectPaused" while locked, "pomodoroModeLocked"). The extension renders its menu from it; without a service it can use, nothing can be chosen (`OFFLINE_ACTIONS` in `menumodel.js`). The other properties stay for older clients.
- `Presentation` (`a{sv}`) is the core's `StatusPresentation` with `StatusPolicy::gnome()`: `summary` and `menuLine` (`as`, part keys such as "activity", "session", "project", "connection", "detail", "pomodoroMode") and `mark` ("none", "pending", "alert", "unconfigured"). The extension's `describeTime()` renders its parts; `tests/statuspresentation.test.js` checks that every key of `desktop/core/autotests/statuspresentation.json`, which the core test reads too, has words. The same file carries the English words every panel gives those keys (`words`: statuses, click actions, run states, phases, the project labels that name no project, the Pomodoro mode mark) and seconds paired with their H:MM text (`elapsed`). The core test checks `TimerModel::formatElapsed()`, the GNOME node test `timer1.js` and `menumodel.js`, the macOS test `StatusWords` and the KDE panel test `StatusText.qml` against it. It is the agreed English and the test oracle; each toolkit still translates at run time. Without a service it can use, the status line is the connection words alone (`offlinePresentation()`).
- `Status` is `timerStatusKey()` of the core's status, one of `timerStatusKeys()` in `desktop/core/src/statuspresentation.h`; the extension's words are keyed on the same list, which `desktop/core/autotests/statuspresentation.json` carries for its tests.
- `AlarmError` (`s`) is `PomodoroAlarm::failure()`: why the last ring or `PreviewSound` was silent, empty when it played. The extension shows it as the menu's message when no failed call or session message outranks it.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-shell-extension-panel-button-and-menu](../../gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](../../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
- Related: [map-org-tokkl-timer1-interface-file-members-and-interfaceversion](map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
<!-- kk:related:end -->
