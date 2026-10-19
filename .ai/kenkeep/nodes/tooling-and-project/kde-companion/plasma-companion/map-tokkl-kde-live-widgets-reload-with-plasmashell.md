---
type: map
title: Tokkl KDE live widgets reload with plasmashell
description: >-
  Tokkl runs inside plasmashell; package metadata and the logo can refresh while
  an existing process keeps the old widget QML loaded.
tags:
  - kde
  - desktop
  - packaging
  - troubleshooting
kk_schema_version: 3
kk_id: map-tokkl-kde-live-widgets-reload-with-plasmashell
kk_derived_from:
  - 'ba6a10d5-e7f0-4f2c-923e-8a293e65c64b:map:0'
kk_relates_to:
  - map-kde-panel-button-menu-and-project-indicator
  - map-kde-native-packaging
kk_depends_on: []
kk_confidence: high
---
`tokkl-kde` runs inside the `plasmashell` process. Updating its installed package can refresh the widget picker's metadata and Tokkl logo while the running shell still holds the previous widget QML in memory. A refreshed logo and a successful connection test do not establish that the live timer view is using the installed UI code.

When validating a Tokkl widget update or investigating a blank timer after an upgrade, reload the host with `systemctl --user restart plasma-plasmashell.service`, or log out and back in. The panel and desktop briefly disappear during the restart. Compare the `plasmashell` PID in journal entries across the upgrade to detect a shell that has not restarted; a persistent process is a clue to stale live QML, not proof that the installed package is defective.

<!-- kk:related:start -->
# Related

- Related: [map-kde-panel-button-menu-and-project-indicator](map-kde-panel-button-menu-and-project-indicator.md)
- Related: [map-kde-native-packaging](../map-kde-native-packaging.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] ba6a10d5-e7f0-4f2c-923e-8a293e65c64b:map:0
<!-- kk:citations:end -->
