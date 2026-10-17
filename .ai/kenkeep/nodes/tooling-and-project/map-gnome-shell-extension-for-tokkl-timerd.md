---
type: map
title: 'GNOME Shell extension: panel button, versions and the two CI harnesses'
description: >-
  desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click
  gesture; check.sh mock harness, realservice.sh real service.
tags:
  - tooling
  - desktop
  - gnome
  - ci
  - testing
kk_schema_version: 3
kk_id: map-gnome-shell-extension-for-tokkl-timerd
kk_derived_from: []
kk_relates_to:
  - map-gnome-timerd-d-bus-timer-service
  - map-kde-ci-and-release-pipeline
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`desktop/gnome/extension/` is a GJS ES-module top-bar extension that drives `tokkl-timerd` over `org.tokkl.Timer1` (see `map-gnome-timerd-d-bus-timer-service`) and holds no timer rule. `metadata.json` lists Shell 46 to 51. 45 is out because its releases are end of life; adding a version means adding an image to `ci/check.sh`.

- Primary click toggles the timer. Right-click, tap and Space open the menu. Before Shell 50, `PanelMenu.Button` opens its menu in `vfunc_event`, which `indicator.js` overrides. From 50 on, a click gesture takes every button, so `indicator.js` disables PanelMenu's private `_clickGesture` and adds its own `Clutter.ClickGesture`. That field is private API: re-check it when you raise the top version.
- From Shell 50 the Billable switch also emits `toggled` when the extension sets it from a service update. The `_syncing` guard keeps that from going back as `SetBillable`; any new menu control driven by service state needs the same guard.
- `prefs.js` keeps only non-secret fields (URL, auth mode, email) in GSettings and sends the secret straight to `Configure`; the service stores it in the keyring.

Two harnesses run the extension in a headless GNOME Shell. Both mount the repo read-only and run as an unprivileged user, with `python-dbusmock` standing in for logind on the system bus.

- `ci/check.sh [VERSION...]` runs one digest-pinned container per listed Shell version (Ubuntu 24.04 for 46, Fedora 41 to 45 for 47 to 51) against `ci/mock-timer.js`, an in-memory stand-in for the service. The distribution's patch release of Shell is whatever its repositories hold that day.
- `ci/realservice.sh` runs Shell 50 against the real `tokkl-timerd`, a Tokkl server on the host started by `ci/realservice.test.ts` with the API's test fixtures, and a private GNOME Keyring. It needs Node.js 24 and `npm ci` on the host. It calls `ci/shell-test.sh --service <timerd>`, which runs `realservice-check.js` instead of `shell-check.js`. Both checks share the panel helpers in `ci/shell-driver.js`; add new panel helpers there.

The project indicator beside the elapsed time follows the same split. What to draw (shape, fill, ring, pulse, placement) is decided in `projectindicator.js` (`describeIndicator`, `fillColor`, `shapeGeometry`, `pulseOpacity`), which imports nothing from GNOME Shell so Node tests it; `indicator.js` only draws the result. Shell turns animations off when it renders in software, so `ci/shell-check.js` sets the interface `enable-animations` key true before it checks the pulse and restores it afterwards. Keep that lift-and-restore for any new check that needs motion. The extension looks the chosen project up in `Projects` and falls back to the service's `ChosenProjectName` when `Projects` lacks it (`chosenProjectLabel` in `timer1.js`), which happens for an archived project that is running; "Unavailable project" shows only when both are empty. The submenu title and the indicator's accessible name use that label. KDE (`StatusText.qml`) and macOS (`statuswords.cpp`, `projectindicator.cpp`) read the running entry's project directly and have no such gap.

The root `npm test` also runs `desktop/gnome/extension/**/*.test.js` with `node --test` (`tests/timer1.test.js`, `tests/projectindicator.test.js`). In `.github/workflows/ci.yml` the `gnome` job runs only the service's `desktop/gnome/ci/check.sh`. The `gnome-extension` job runs `extension/ci/check.sh` as a matrix with one leg per Shell version 46 to 51. Its first step fails when the number of legs differs from the `shell-version` list in `metadata.json`, or when the leg's version is not listed, so changing the supported Shells means editing the matrix and `metadata.json` together. `ci/realservice.sh` is still not in CI. The `release` job needs `gnome-extension` as well as `gnome`.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service](map-gnome-timerd-d-bus-timer-service.md)
- Related: [map-kde-ci-and-release-pipeline](kde-companion/map-kde-ci-and-release-pipeline.md)
- Related: [map-test-and-static-analysis-layout](testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
