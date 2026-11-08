---
type: map
title: GNOME Shell extension packaging and preferences
description: >-
  pack-extension.sh packs every *.js, *.png and *.svg and the D-Bus interface
  description as extra sources; panel logo tokkl.png; prefs.js keeps only
  non-secret fields in GSettings
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
- The panel logo is `extension/tokkl.png` (32 px, rendered by `npm run icons`; see `map-app-icons-script`). `desktop/gnome/scripts/pack-extension.sh` copies every `*.js`, `*.png` and `*.svg`, and `desktop/gnome/dbus/org.tokkl.Timer1.xml`, the only copy of the D-Bus interface in the checkout, and passes each besides `extension.js` and `prefs.js` to `gnome-extensions pack` as `--extra-source`, so a new module or image is packed without editing the script. `timer1proxy.js` reads the interface from that file next to itself at load time. `extension/ci/shell-test.sh` lists its files by hand: it packs a copy of the extension with the description added, so a new module goes in both scripts.
- `prefs.js` keeps only non-secret fields (URL, auth mode, email) in GSettings and sends the secret straight to `Configure`; the service stores it in the keyring. It keeps the fields only when `Configure` succeeds, so a call that failed, `org.tokkl.Timer1.Error.Superseded` included, leaves the last accepted values. A typed secret belongs to the URL, sign-in method and, for password sign-in, email it was typed for (`typedsecret.js`, Node-tested); changing one of them clears it, so it has to be typed again and never goes to another instance or account. Below the URL a row warns "This address uses plain http. Your token or password would be sent unencrypted.", the words of the KDE and macOS settings, while `isInsecureUrl()` (`instanceurl.js`, Node-tested) holds: the rule of the core's `ConnectionSetup::isInsecure()`, a usable `http://` address whose host is neither `localhost` nor a loopback address. `desktop/core/autotests/insecureurls.json` holds the cases both the core's `connection` test and `tests/instanceurl.test.js` read, so the two rules cannot drift apart. The extension computes it itself rather than asking the service, so it works with any `tokkl-timerd`.
- The Pomodoro rows take their ranges from the service's `PomodoroLengthLimits`, the server's limits; until the service publishes them a row's range is 1 to 999 and it cannot be saved. A test in `tests/timer1.test.js` fails if a fallback for an older service comes back. `ci/prefs-check.js` checks that the rows follow the published ranges.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-and-d-bus-contract](../gnome-timer-service/map-gnome-timer-service-and-d-bus-contract.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](map-gnome-shell-extension-panel-button-and-menu.md)
<!-- kk:related:end -->
