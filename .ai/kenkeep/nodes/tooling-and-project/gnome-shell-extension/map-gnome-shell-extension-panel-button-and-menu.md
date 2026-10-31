---
type: map
title: GNOME Shell extension panel button and menu
description: >-
  desktop/gnome/extension drives tokkl-timerd; Shell 46-51; click and key
  activation; Shell 50 click gesture; Shell 51 key controller
tags:
  - gnome
  - desktop
  - tooling
kk_schema_version: 3
kk_id: map-gnome-shell-extension-panel-button-and-menu
kk_derived_from: []
kk_relates_to:
  - map-gnome-timerd-d-bus-timer-service
  - map-gnome-shell-extension-project-indicator-and-chosen-project-label
  - map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix
kk_depends_on: []
kk_confidence: high
---
`desktop/gnome/extension/` is a GJS ES-module top-bar extension that drives `tokkl-timerd` over `org.tokkl.Timer1` (see `map-gnome-timerd-d-bus-timer-service`) and holds no timer rule. `metadata.json` lists Shell 46 to 51. 45 is out because its releases are end of life; adding a version means adding an image to `ci/check.sh`.

- A primary click, or Space or Return with no modifier but Caps Lock or Num Lock (`_isActivateKey`), pauses a running timer, resumes a paused chain or starts (`Pause`, `Resume` or `Start`); the service decides, and during a session, in either mode, it confirms a ringing phase and otherwise asks for the menu. The Start/Stop menu item is hidden while a session is active, and the Start session item follows `CanStartSession`. Other buttons, touch and Down open the menu. The menu's first action reads Start, or Stop while running or paused, and calls `Start` or `Stop`; it never pauses. The label is `ChainSeconds` plus the running entry's own time, frozen while paused, and the button's accessible name starts with "Running", "Paused" or "Stopped". The menu's status line shows the connection words, and while paused it leads with the chain total, `Paused H:MM · <connection words>` (for example `Paused 1:03 · Connected`), as the KDE and macOS menus do; `ci/shell-check.js` checks it. Before Shell 50, `PanelMenu.Button` opens its menu in `vfunc_event`, which `indicator.js` overrides. From 50 on, a click gesture takes every button, so `indicator.js` disables PanelMenu's private `_clickGesture` and adds its own `Clutter.ClickGesture`. That field is private API: re-check it when you raise the top version. From Shell 51, PopupMenu also reads Space, Return and Down through a `Clutter.KeyController` on the button and stops them, so `vfunc_event` never sees them. When the button carries such a controller, `indicator.js` adds its own in the capture phase (`add_action_full('tokkl-activate-keys', Clutter.EventPhase.CAPTURE, ...)`), which runs first: Space or Return with no modifier but Caps Lock or Num Lock act as a primary click, and Down and every other key still reach the menu. Shell 46 to 50 keep the `vfunc_event` path. Do not call `Clutter.Action.get_phase()` from JS: it aborts Shell 51 on a GJS 1.90.1 assertion.
- From Shell 50 the Billable switch also emits `toggled` when the extension sets it from a service update. The `_syncing` guard keeps that from going back as `SetBillable`; any new menu control driven by service state needs the same guard.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-and-d-bus-contract](../gnome-timer-service/map-gnome-timer-service-and-d-bus-contract.md)
- Related: [map-gnome-shell-extension-project-indicator-and-chosen-project-label](map-gnome-shell-extension-project-indicator-and-chosen-project-label.md)
- Related: [map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
<!-- kk:related:end -->
