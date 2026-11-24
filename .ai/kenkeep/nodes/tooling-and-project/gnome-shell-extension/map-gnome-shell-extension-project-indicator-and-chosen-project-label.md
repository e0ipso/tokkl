---
type: map
title: GNOME Shell extension project indicator and chosen project label
description: >-
  projectindicator.js decides, indicator.js draws; pulse check lifts
  enable-animations; chosenProjectLabel words the service's ChosenProjectLabel parts
tags:
  - gnome
  - desktop
  - tooling
kk_schema_version: 3
kk_id: map-gnome-shell-extension-project-indicator-and-chosen-project-label
kk_derived_from: []
kk_relates_to:
  - map-gnome-timerd-d-bus-timer-service
  - map-gnome-shell-extension-panel-button-and-menu
  - map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix
kk_depends_on: []
kk_confidence: high
---
The project indicator beside the elapsed time on the panel button (see `map-gnome-shell-extension-panel-button-and-menu`) splits deciding from drawing. What to draw (shape, fill, ring, pulse, placement) is decided in `projectindicator.js` (`describeIndicator`, `fillColor`, `shapeGeometry`, `pulseOpacity`), which imports nothing from GNOME Shell so Node tests it; `indicator.js` only draws the result. Shell turns animations off when it renders in software, so `ci/shell-check.js` sets the interface `enable-animations` key true before it checks the pulse and restores it afterwards. Keep that lift-and-restore for any new check that needs motion. The label comes from the core's `ProjectLabelParts` (`desktop/core/src/projectchoices.h`): a `kind` (None, Unknown, Unavailable or Named; `"none"`, `"unknown"`, `"unavailable"` and `"named"` in the variant map) and, for Named, name, client and archived, which `TimerModel::chosenProjectLabel()` gives for the chosen project and the service publishes as `ChosenProjectLabel`. The core decides the kind; each panel only maps it to its words: "No project", "Unknown project" while the project is read, "Unavailable project" for one the instance no longer has, and for Named "Name (Client)" and then "(archived)". `chosenProjectLabel(label, _)` in `timer1.js` does it for GNOME (an unknown kind reads as Unknown, an empty map as No project), `projectLabel()` in `StatusText.qml` for KDE (also for the project rows, whose `label` carries the parts) and `StatusWords::projectLabel()` for macOS. None of them looks at the project id. The submenu title and the indicator's accessible name use that label.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-org-tokkl-timer1-interface-file-members-and-interfaceversion](../gnome-timer-service/timer1-d-bus-contract/map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-actions-presentation-status-and-alarmerror-properties](../gnome-timer-service/timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-methods-requests-refreshprojects-configure-and-activate](../gnome-timer-service/timer1-d-bus-contract/map-timer1-methods-requests-refreshprojects-configure-and-activate.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-propertieschanged-publication-from-timerservice](../gnome-timer-service/timer1-d-bus-contract/map-timer1-propertieschanged-publication-from-timerservice.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-timer-project-and-pomodoro-limit-properties](../gnome-timer-service/timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-tokkl-timerd-daemon-composition-root-and-secret-storage](../gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
<!-- kk:related:end -->
