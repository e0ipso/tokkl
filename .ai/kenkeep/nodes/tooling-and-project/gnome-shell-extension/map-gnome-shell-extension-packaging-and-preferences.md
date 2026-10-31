---
type: map
title: GNOME Shell extension packaging and preferences
description: >-
  pack-extension.sh packs every *.js and *.png as extra sources; panel logo
  tokkl.png; prefs.js keeps only non-secret fields in GSettings
tags:
  - gnome
  - desktop
  - tooling
  - packaging
kk_schema_version: 3
kk_id: map-gnome-shell-extension-packaging-and-preferences
kk_derived_from: []
kk_relates_to:
  - map-gnome-timerd-d-bus-timer-service
  - map-gnome-shell-extension-panel-button-and-menu
kk_depends_on: []
kk_confidence: high
---
- The panel logo is `extension/tokkl.png` (32 px, rendered by `npm run icons`; see `map-app-icons-script`). `desktop/gnome/scripts/pack-extension.sh` copies every `*.js` and `*.png` and passes each besides `extension.js` and `prefs.js` to `gnome-extensions pack` as `--extra-source`, so a new module or image is packed without editing the script.
- `prefs.js` keeps only non-secret fields (URL, auth mode, email) in GSettings and sends the secret straight to `Configure`; the service stores it in the keyring.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-and-d-bus-contract](../gnome-timer-service/map-gnome-timer-service-and-d-bus-contract.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](map-gnome-shell-extension-panel-button-and-menu.md)
<!-- kk:related:end -->
