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
- `prefs.js` keeps only non-secret fields (URL, auth mode, email) in GSettings and sends the secret straight to `Configure`; the service stores it in the keyring. It keeps the fields only when `Configure` succeeds, so a call that failed, `org.tokkl.Timer1.Error.Superseded` included, leaves the last accepted values. A typed secret belongs to the URL, sign-in method and, for password sign-in, email it was typed for (`typedsecret.js`, Node-tested); changing one of them clears it, so it has to be typed again and never goes to another instance or account. Below the URL a row warns "This address uses plain http. Your token or password would be sent unencrypted.", the words of the KDE and macOS settings, while `isInsecureUrl()` (`instanceurl.js`, Node-tested) holds: the rule of the core's `ConnectionSetup::isInsecure()`, a usable `http://` address whose host is neither `localhost` nor a loopback address. `desktop/core/autotests/insecureurls.json` holds the cases both the core's `connection` test and `tests/instanceurl.test.js` read, so the two rules cannot drift apart. The extension computes it itself rather than asking the service: the warning shows while the address is typed, also when `tokkl-timerd` is stopped or older than the extension supports, and a D-Bus call to a stopped service would start it through activation. The fixture and `instanceurl.js` say so.
- The Pomodoro rows take their ranges from the service's `PomodoroLengthLimits`, the server's limits, or the core's `PomodoroLimits::placeholder()` that the service publishes before the server announces any. `prefs.js` keeps no range of its own: until the service publishes one a row has none and is insensitive. A test in `tests/timer1.test.js` fails if a range comes back into `prefs.js`, and another if a fallback for an older service comes back. `ci/prefs-check.js` checks that the rows follow the published ranges.
- The preferences stop at the floor the panel button stops at. Both read the service through `serviceOutdated()`, `supportedProperty()` and `interfaceVersion()` in `timer1.js` (with `serviceRunning()` and `cachedProperty()`, which Node tests with a stand-in proxy), and neither calls `cachedProperty()` itself; a test in `tests/timer1.test.js` checks that. Against a service below `OLDEST_SUPPORTED_INTERFACE_VERSION` the window calls nothing (no `RefreshPreferences`, `Configure`, `SetPomodoroLengths`, `SetSound` or `PreviewSound`), the connection and Pomodoro rows and Connect are insensitive, and the Timer service row and the Pomodoro group say "This timer service is too old; update tokkl-timerd." (`outdatedServiceText()`). `ci/prefs-check.js` checks it against the mock's `ActAsOlderService`.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-and-d-bus-contract](../gnome-timer-service/map-gnome-timer-service-and-d-bus-contract.md)
- Related: [map-gnome-shell-extension-panel-button-and-menu](map-gnome-shell-extension-panel-button-and-menu.md)
<!-- kk:related:end -->
