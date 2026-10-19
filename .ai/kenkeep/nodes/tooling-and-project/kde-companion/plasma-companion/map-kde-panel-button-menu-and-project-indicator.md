---
type: map
title: 'KDE panel: button, menu and project indicator'
description: >-
  PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open
  Tokkl URL, and the project indicator's shapes and pulse.
tags:
  - kde
  - desktop
kk_schema_version: 3
kk_id: map-kde-panel-button-menu-and-project-indicator
kk_derived_from: []
kk_relates_to:
  - practice-kde-timer-controller-rules
kk_depends_on: []
kk_confidence: high
---
The Configure page is `package/contents/ui/configGeneral.qml`. The panel is `PanelButton.qml` (compact representation) and `PanelMenu.qml`, wired in `main.qml`. The `PanelButton` row is the logo (`logoIcon`, `contents/images/tokkl.png`), the project indicator (`projectIndicator`), the elapsed time (`elapsedLabel`, `TokklTimer.elapsedText`) and then the state symbol (`stateIcon`), shown only while `status` is not Ready. The indicator's shape shows running, paused or stopped, so the row has no run-state symbol. Left click, Space, Return, Enter, Select and the accessible press action call `toggle()`, which pauses a running timer, resumes a paused chain or starts one (see `practice-kde-timer-controller-rules`). The button's accessible name follows: "Pause the Tokkl timer", "Resume the Tokkl timer" or "Start the Tokkl timer". Right click, the Menu key or Shift+F10 opens the menu: the state line, then Start or Stop (`runItem`), Project, Billable, Reconnect, Open Tokkl and Configure. Start or Stop calls `start()` or `stop()`, never `toggle()`; while running or paused it reads Stop, and Stop while paused only ends the chain, so it is enabled whenever the timer is not busy. Project and Billable are disabled while paused. `StatusText.qml` says Paused in the status text and tooltip. Open Tokkl uses `Connection::webUrl`, the instance URL with user info, query and fragment removed and a trailing slash, so no credential reaches the browser.

Panel indicator. `ProjectIndicator.qml` sits in the `PanelButton` row between the logo and the elapsed time, in a slot of the same width in every state. Running is a dot, paused is a still dot and stopped is a still square. The fill is the project colour, inside a separate ring in the theme text colour (11.5 to 17.7:1 on Breeze Light and Dark, by WCAG 2 luminance). No project is a dashed outline in the text colour, pending leaves the slot empty, and an empty `indicatorColor` string fills the shape with the text colour. Only the fill pulses (opacity to 0.35 and back over 1.6 s, as in the web app): the ring and the outline never fade, because a fading ring dropped to about 2:1. The pulse runs only while an entry runs and the item is visible and its window is not hidden (as Plasma's `BusyIndicator`), and the fill goes back to opacity 1 when it stops. Reduced motion is `Kirigami.Units.longDuration <= 1`, not `== 0`: Plasma's Animation speed "Instant" writes `AnimationDurationFactor = 0`, which gives `longDuration` 1 under both the org.kde.desktop and Plasma Kirigami styles, and Plasma's `BusyIndicator.qml` tests `longDuration > 1` for the same reason. `StatusText.summary` includes the project name or "No project" and feeds the tooltip (`main.qml`) and the accessible description of `PanelButton`, so the shape itself is decoration. The backend QML module depends on QtQuick (`src/CMakeLists.txt`) so qmllint knows the colour type of `TokklTimer.indicatorColor`. The real Plasma pulse, Instant and Breeze checks are manual, in the checklist of `desktop/kde/README.md`.

<!-- kk:related:start -->
# Related

- Related: [practice-kde-timer-controller-rules](../practice-kde-timer-controller-rules.md)
<!-- kk:related:end -->
