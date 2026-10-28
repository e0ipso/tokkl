---
type: map
title: GNOME Shell extension project indicator and chosen project label
description: >-
  projectindicator.js decides, indicator.js draws; pulse check lifts
  enable-animations; chosenProjectLabel falls back to ChosenProjectName
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
The project indicator beside the elapsed time on the panel button (see `map-gnome-shell-extension-panel-button-and-menu`) splits deciding from drawing. What to draw (shape, fill, ring, pulse, placement) is decided in `projectindicator.js` (`describeIndicator`, `fillColor`, `shapeGeometry`, `pulseOpacity`), which imports nothing from GNOME Shell so Node tests it; `indicator.js` only draws the result. Shell turns animations off when it renders in software, so `ci/shell-check.js` sets the interface `enable-animations` key true before it checks the pulse and restores it afterwards. Keep that lift-and-restore for any new check that needs motion. The extension looks the chosen project up in `Projects` and falls back to the service's `ChosenProjectName` when `Projects` lacks it (`chosenProjectLabel` in `timer1.js`), which happens for an archived project that is running; "Unavailable project" shows only when both are empty. The submenu title and the indicator's accessible name use that label. KDE (`StatusText.qml`) and macOS (`statuswords.cpp`, `projectindicator.cpp`) read the running entry's project directly and have no such gap.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service](../map-gnome-timerd-d-bus-timer-service.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
<!-- kk:related:end -->
