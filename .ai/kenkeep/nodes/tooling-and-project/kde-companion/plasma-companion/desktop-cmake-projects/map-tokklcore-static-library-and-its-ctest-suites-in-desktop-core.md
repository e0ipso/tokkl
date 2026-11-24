---
type: map
title: tokklcore static library and its CTest suites in desktop/core
description: >-
  tokklcore is Qt-only (Core, Network, Test): API client, credential interface,
  state client, timer, Pomodoro, TimerStack, tests.
tags:
  - desktop
  - tooling
  - kde
kk_schema_version: 3
kk_id: map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies
  - map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name
  - map-tokkl-timerd-daemon-composition-root-and-secret-storage
kk_depends_on: []
kk_confidence: high
---
`desktop/core` is a standalone CMake project (`tokkl-core`) that needs only Qt6 Core, Network and Test: no ECM, KF6, Plasma or Qt Gui. It builds the static library `tokklcore`, which holds the API client (`ApiClient`, with `Connection` for the account, the connection state and the typed operations, and `SessionCredentials` for its settings and secret), the `CredentialStore` interface, the `TimerStateClient`, the timer controller (`TimerController` on its view base `TimerModel`), the menu action rules (`MenuActionStates`), the Pomodoro session and `TimerStack`, which builds the connection, the one state client, the timer, the Pomodoro preferences client and the session in order on one clock for every companion, with no `KF6::Wallet` and no KWallet include or symbol. It also holds its unit tests on plain CTest (`desktop/core/autotests`: `api`, `apiclient`, `connection`, `sessioncredentials`, `networktransport`, `timer`, `timerparts`, `timerstateclient`, `timerstack`, `translations`, and the Pomodoro store, preferences, session, sounds and glyph tests), the `tokklcorefakes` INTERFACE target and `cmake/TokklVersion.cmake`.

<!-- kk:related:start -->
# Related

- Related: [practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies](../../connection-and-credentials/practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies.md)
- Related: [map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name](map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md)
- Related: [map-tokkl-timerd-daemon-composition-root-and-secret-storage](../../../gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../../../.redirects.json)
<!-- kk:citations:end -->
