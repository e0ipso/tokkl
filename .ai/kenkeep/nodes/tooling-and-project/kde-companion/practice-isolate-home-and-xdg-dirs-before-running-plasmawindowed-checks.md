---
type: practice
title: Isolate HOME and XDG dirs before running plasmawindowed checks
description: >-
  Export throwaway HOME and XDG_* dirs before dbus-run-session when running the
  plasmoid in plasmawindowed; use a stand-in kwalletd.
tags:
  - kde
  - testing
  - desktop
  - plasmoid
kk_schema_version: 3
kk_id: practice-isolate-home-and-xdg-dirs-before-running-plasmawindowed-checks
kk_derived_from:
  - '8e0fca55-8bce-4b20-8442-82d327ec3272:practice:0'
kk_relates_to:
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
  - map-tokkl-kde-live-widgets-reload-with-plasmashell
  - >-
    practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite
kk_depends_on: []
kk_confidence: high
---
For end-to-end checks of the KDE plasmoid with `plasmawindowed`, export `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` to throwaway paths before starting `dbus-run-session`, not inside it. Serve the token from a stand-in kwalletd on that private bus, and stop `kactivitymanagerd` and `kglobalaccel5` afterwards, because they outlive the bus.

Rationale: with only the XDG dirs set inside the session, the private bus auto-starts kactivitymanagerd, which rewrites files under the real `~/.local/share/kactivitymanagerd`. Running on the real session bus would also reach the user's real KDE Wallet.

<!-- kk:related:start -->
# Related

- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
- Related: [map-tokkl-kde-live-widgets-reload-with-plasmashell](plasma-companion/map-tokkl-kde-live-widgets-reload-with-plasmashell.md)
- Related: [practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite](connection-and-credentials/practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 8e0fca55-8bce-4b20-8442-82d327ec3272:practice:0
<!-- kk:citations:end -->
