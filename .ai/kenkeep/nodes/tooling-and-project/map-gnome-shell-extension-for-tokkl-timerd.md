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

The root `npm test` also runs `desktop/gnome/extension/**/*.test.js` with `node --test` (`tests/timer1.test.js`). The `.github/workflows/ci.yml` `gnome` job runs only the service's `desktop/gnome/ci/check.sh`; neither extension harness is in CI yet, so run them by hand when the extension changes.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service](map-gnome-timerd-d-bus-timer-service.md)
- Related: [map-kde-ci-and-release-pipeline](kde-companion/map-kde-ci-and-release-pipeline.md)
- Related: [map-test-and-static-analysis-layout](testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
