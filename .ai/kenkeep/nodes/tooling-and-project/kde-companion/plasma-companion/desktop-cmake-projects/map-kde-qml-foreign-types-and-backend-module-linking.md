---
type: map
title: KDE QML_FOREIGN types and backend module linking
description: >-
  qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend
  module links and the KF6 Config workaround.
tags:
  - kde
  - desktop
  - tooling
kk_schema_version: 3
kk_id: map-kde-qml-foreign-types-and-backend-module-linking
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing
  - map-kde-native-packaging
  - map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name
kk_depends_on: []
kk_confidence: high
---
`src/qmltypes.h` exposes the types to QML through `QML_FOREIGN`: `KdeConnectionSetup` and `KdeTimerState` as the creatable `TokklConnectionSetup` and `TokklTimerState`, the stack's `Connection`, `TimerController`, `PomodoroSession` and `PomodoroPreferences` as the uncreatable `TokklConnection`, `TokklTimer`, `TokklPomodoroSession` and `TokklPomodoroPreferences`, and the core `ConnectionSetup` as `QML_ANONYMOUS`. `main.qml` configures the connection through grouped properties (`connection.instanceUrl: ...`) and hands `TokklTimerState` the applet; `AppletPomodoroStore` then emits `PomodoroStore::sourceChanged()` and the session reads the stored mode. The backend module links both libraries, so the installed plugin links KDE Wallet, and for `AppletPomodoroStore` also libplasma and KF6 ConfigCore. `desktop/kde/CMakeLists.txt` asks for KF6 `Config` itself because libplasma's CMake package names it in its link interface without finding it; `debian/control` build-depends on `libkf6config-dev` and the RPM spec on `cmake(KF6Config)`.

<!-- kk:related:start -->
# Related

- Related: [practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing](../../connection-and-credentials/practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing.md)
- Related: [map-kde-native-packaging](../../map-kde-native-packaging.md)
- Related: [map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name](map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../../../.redirects.json)
<!-- kk:citations:end -->
