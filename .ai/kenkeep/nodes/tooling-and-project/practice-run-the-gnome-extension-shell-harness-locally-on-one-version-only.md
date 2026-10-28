---
type: practice
title: Run the GNOME extension Shell harness locally on one version only
description: >-
  Run desktop/gnome/extension/ci/check.sh locally on one Shell version (50); the
  PR's gnome-extension CI matrix covers 46 to 51.
tags:
  - gnome
  - testing
  - ci
  - desktop
kk_schema_version: 3
kk_id: practice-run-the-gnome-extension-shell-harness-locally-on-one-version-only
kk_derived_from:
  - '7d565109-89a4-4625-9883-dd0baef2634a:practice:0'
kk_relates_to:
  - map-gnome-shell-extension-for-tokkl-timerd
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: medium
---
When verifying a change to the GNOME Shell extension locally, run `desktop/gnome/extension/ci/check.sh` on a single Shell version, normally 50 (the version `ci/realservice.sh` also uses). Do not run the other supported versions (46, 47, 48, 49, 51) locally as a matter of course.

The `gnome-extension` job in `.github/workflows/ci.yml` runs one leg per supported Shell version on every PR, and the PR merges only when all of them pass, so a local sweep duplicates that coverage. Each local version boots a headless GNOME Shell in its own container and takes a few minutes, which adds up quickly on a loaded machine.

Run a specific other version locally only when reproducing or fixing a failure that CI reported on that version.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](gnome-shell-extension/map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-packaging-and-preferences](gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-panel-button-and-menu](gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-project-indicator-and-chosen-project-label](gnome-shell-extension/map-gnome-shell-extension-project-indicator-and-chosen-project-label.md)
- Related: [map-test-and-static-analysis-layout](testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 7d565109-89a4-4625-9883-dd0baef2634a:practice:0
<!-- kk:citations:end -->
