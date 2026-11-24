---
type: map
title: 'tokklkde static library, KWallet store and tokkl-kde client name'
description: >-
  tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState,
  AppletPomodoroStore; callers inject the store and client name.
tags:
  - kde
  - desktop
kk_schema_version: 3
kk_id: map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - >-
    practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite
  - practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies
  - map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core
  - map-kde-qml-foreign-types-and-backend-module-linking
kk_depends_on: []
kk_confidence: high
---
`desktop/kde/src/CMakeLists.txt` builds the static library `tokklkde`, which links `tokklcore` and, privately, `KF6::Wallet` and `Plasma::Plasma`, and holds `KWalletCredentialStore`, `KdeConnection` (the Pomodoro settings page's connection) and the QML-facing `KdeConnectionSetup`, `KdeTimerState` (the widget's `TimerStack` on the network, KWallet and one system clock, so the timer and the session share one `TimerStateClient`; see `map-desktop-timer-state-client-stream-poll-settling-and-revisions`), `AppletPomodoroStore` (the Pomodoro mode in the applet's KConfig, which `KdeTimerState` owns), the alarm player and the sound catalogue. The pause chain and the session are the server's, so nothing but the mode and the sound choices is stored on the device (see `practice-kde-timer-controller-rules`). `KdeConnection`, `KdeConnectionSetup` and `KdeTimerState` inject the process-wide KWallet store (`KWalletCredentialStore::shared()`), own a `NetworkTransport` and pass the client name `tokkl-kde` (`kdeClientName()`). The core `Connection` and `ConnectionSetup` have no constructor that picks a store or a client name; the caller passes both, and the core tests pass `FakeCredentialStore` and `tokkl-test`.

<!-- kk:related:start -->
# Related

- Related: [practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite](../../connection-and-credentials/practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md)
- Related: [practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies](../../connection-and-credentials/practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies.md)
- Related: [map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
- Related: [map-kde-qml-foreign-types-and-backend-module-linking](map-kde-qml-foreign-types-and-backend-module-linking.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../../../.redirects.json)
<!-- kk:citations:end -->
