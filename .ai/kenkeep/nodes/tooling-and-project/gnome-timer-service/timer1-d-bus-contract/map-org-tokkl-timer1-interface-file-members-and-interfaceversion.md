---
type: map
title: 'org.tokkl.Timer1 interface file, members and InterfaceVersion'
description: >-
  org.tokkl.Timer1.xml is the one contract source; members are additive only;
  InterfaceVersion and the extension support floor.
tags:
  - gnome
  - dbus
kk_schema_version: 3
kk_id: map-org-tokkl-timer1-interface-file-members-and-interfaceversion
kk_derived_from: []
kk_relates_to:
  - map-gnome-shell-extension-packaging-and-preferences
  - map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix
  - map-gnome-shell-extension-panel-button-and-menu
  - map-tokkl-timerd-daemon-composition-root-and-secret-storage
kk_depends_on: []
kk_confidence: high
---
The interface description is `desktop/gnome/dbus/org.tokkl.Timer1.xml`. It lives in `dbus/` because the root `.gitignore` ignores `data/`. Contract rules: The interface description is the one source of the contract. `scripts/pack-extension.sh` copies it into the extension zip, `timer1proxy.js` reads it next to itself (`TIMER1_XML_FILE` in `timer1.js`) and builds the proxy from it, and `ci/shell-test.sh` packs it the same way.

- Properties are `Running`, `StartTime`, `LocalStartTime`, `Paused`, `ChainSeconds`, `IndicatorState`, `IndicatorColor`, `Projects`, `ProjectsIncomplete`, `ChosenProject`, `ChosenProjectName`, `ChosenProjectLabel`, `Billable`, `Status` and `ErrorString`, the Pomodoro ones, among them `SessionActive`, `CanStartSession` and `PomodoroLengthLimits`, `Actions`, `Presentation`, `AlarmError` and `InterfaceVersion`. Methods are `Start`, `Stop`, `Pause`, `Resume`, their request forms `RequestStart`, `RequestStop`, `RequestPause` and `RequestResume`, `SetProject`, `SetBillable`, `Configure`, the Pomodoro ones, `RefreshPreferences` and `RefreshProjects`; the one signal of the interface is `RequestFinished`. Add members only; existing clients read the old ones.
- `InterfaceVersion` (`u`) is the version of the contract the service implements, `TimerService::version`. Version 2 is the first released one, in the first `tokkl-timerd` after 2.1.0, and publishes every member described; the comment on `InterfaceVersion` in `dbus/org.tokkl.Timer1.xml` is the one place that states the version history (`timer1.js` and `gnome/README.md` point to it). Raise it by one in a release that adds members. The extension supports a service from `OLDEST_SUPPORTED_INTERFACE_VERSION` in `timer1.js` on (`supportsService()`). It has no fallbacks: a service below it, or one without `InterfaceVersion`, gets the no-service menu with one status line, "This timer service is too old; update tokkl-timerd." (`describeStatus()`), and no method calls from the panel button or the preferences (`serviceOutdated()` in `timer1.js`).

<!-- kk:related:start -->
# Related

- Related: [map-gnome-shell-extension-packaging-and-preferences](../../gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md)
- Related: [map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](../../gnome-shell-extension/map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](../../gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-tokkl-timerd-daemon-composition-root-and-secret-storage](map-tokkl-timerd-daemon-composition-root-and-secret-storage.md)
<!-- kk:related:end -->
