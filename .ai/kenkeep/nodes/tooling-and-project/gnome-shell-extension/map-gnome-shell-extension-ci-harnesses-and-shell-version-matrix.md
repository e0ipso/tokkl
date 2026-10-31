---
type: map
title: GNOME Shell extension CI harnesses and Shell version matrix
description: >-
  check.sh mock harness per Shell version; realservice.sh against real timerd;
  waitFor drawn state; gnome-extension CI matrix 46-51
tags:
  - gnome
  - ci
  - testing
  - desktop
kk_schema_version: 3
kk_id: map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix
kk_derived_from: []
kk_relates_to:
  - map-gnome-timerd-d-bus-timer-service
  - map-kde-ci-and-release-pipeline
  - map-test-and-static-analysis-layout
  - practice-run-the-gnome-extension-shell-harness-locally-on-one-version-only
  - map-gnome-shell-extension-panel-button-and-menu
  - map-gnome-shell-extension-packaging-and-preferences
kk_depends_on: []
kk_confidence: high
---
Two harnesses run the extension (`desktop/gnome/extension/`) in a headless GNOME Shell. Both mount the repo read-only and run as an unprivileged user, with `python-dbusmock` standing in for logind on the system bus.

- `ci/check.sh [VERSION...]` runs one digest-pinned container per listed Shell version (Ubuntu 24.04 for 46, Fedora 41 to 45 for 47 to 51) against `ci/mock-timer.js`, an in-memory stand-in for the service. The distribution's patch release of Shell is whatever its repositories hold that day.
- `ci/realservice.sh` runs Shell 50 against the real `tokkl-timerd`, a Tokkl server on the host started by `ci/realservice.test.ts` with the API's test fixtures, and a private GNOME Keyring. It needs Node.js 24 and `npm ci` on the host. It calls `ci/shell-test.sh --service <timerd>`, which runs `realservice-check.js` instead of `shell-check.js`. Both checks share the panel helpers in `ci/shell-driver.js`; add new panel helpers there.

Checks of the panel's drawn state wait with the harness's `waitFor`; they never read once after enabling. Shell 48 and 49 enable the extension while the Shell is still starting up, before the top bar is shown, so the top bar logo is an undrawn 0x0 icon at that point and gets its size shortly after. The logo step of `ci/shell-check.js` checks the packed `tokkl.png` and the child order once, then waits for the drawn state. A size is not proof that the picture loaded: an `St.Icon` keeps its one child and its size when its PNG does not decode, and on Shell 48 that child is then a `ClutterActor` with no content. Only a loaded PNG gives the child an `St.ImageContent` with a preferred size above zero, so the step waits for that content too.

The root `npm test` also runs `desktop/gnome/extension/**/*.test.js` with `node --test` (`tests/timer1.test.js`, `tests/projectindicator.test.js`). In `.github/workflows/ci.yml` the `gnome` job runs only the service's `desktop/gnome/ci/check.sh`. The `gnome-extension` job runs `extension/ci/check.sh` as a matrix with one leg per Shell version 46 to 51. Its first step fails when the number of legs differs from the `shell-version` list in `metadata.json`, or when the leg's version is not listed, so changing the supported Shells means editing the matrix and `metadata.json` together. `ci/realservice.sh` is still not in CI. The `release` job needs `gnome-extension` as well as `gnome`.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-and-d-bus-contract](../gnome-timer-service/map-gnome-timer-service-and-d-bus-contract.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-and-core-ci-jobs](../kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-real-server-test](../kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md)
- Related: [map-kde-ci-and-release-pipeline → map-release-stages-kde-semantic-release-plugin-and-gnome-assets](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md)
- Related: [map-kde-ci-and-release-pipeline → map-tests-for-release-only-ci-steps](../kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md)
- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
- Related: [practice-run-the-gnome-extension-shell-harness-locally-on-one-version-only](../practice-run-the-gnome-extension-shell-harness-locally-on-one-version-only.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-packaging-and-preferences](map-gnome-shell-extension-packaging-and-preferences.md)
<!-- kk:related:end -->
