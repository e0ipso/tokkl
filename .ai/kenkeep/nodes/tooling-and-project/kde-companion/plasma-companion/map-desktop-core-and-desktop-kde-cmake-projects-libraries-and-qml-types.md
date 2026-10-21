---
type: map
title: 'desktop/core and desktop/kde: CMake projects, libraries and QML types'
description: >-
  tokklcore is Qt-only in desktop/core; tokklkde adds KWallet and the applet
  chain store; QML_FOREIGN types; version and README.
tags:
  - kde
  - desktop
  - tooling
kk_schema_version: 3
kk_id: map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies
  - >-
    practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite
  - practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing
  - map-npm-workspaces-package-layout
  - map-kde-native-packaging
kk_depends_on: []
kk_confidence: high
---
`desktop/kde` is a standalone CMake project, outside the npm workspaces (`packages/*`) and outside the `.dockerignore` allowlist, so npm scripts and the Docker image never build it. It ships a Plasma widget package with id `com.github.e0ipso.tokkl` (`package/metadata.json`, UI in `package/contents/ui/main.qml`) and a C++ QML backend module `com.github.e0ipso.tokkl.backend` (`src/`). Minimum versions are set at the top of `desktop/kde/CMakeLists.txt`: Qt 6.8, KDE Frameworks 6.13, Plasma 6.3 (what Debian 13 shipped with); `desktop/core` and `desktop/gnome` need Qt 6.8.

`desktop/core` is a standalone CMake project (`tokkl-core`) that needs only Qt6 Core, Network and Test: no ECM, KF6, Plasma or Qt Gui. It builds the static library `tokklcore`, which holds the API client, the `CredentialStore` interface, connection state and the timer controller, with no `KF6::Wallet` and no KWallet include or symbol. It also holds the `api`, `connection`, `networktransport` and `timer` tests on plain CTest (`desktop/core/autotests`), the `tokklcorefakes` INTERFACE target and `cmake/TokklVersion.cmake`. `desktop/kde/CMakeLists.txt` adds it with `add_subdirectory("${TOKKL_CORE_DIR}" core)`; `TOKKL_CORE_DIR` defaults to `../core`. `desktop/kde/src/CMakeLists.txt` builds the static library `tokklkde`, which links `tokklcore` and, privately, `KF6::Wallet` and `Plasma::Plasma`, and holds `KWalletCredentialStore`, the QML-facing `KdeConnection` and `KdeConnectionSetup`, and `AppletChainStore` (the pause chain in the applet's KConfig; see `practice-kde-timer-controller-rules`). Those two inject the process-wide KWallet store (`KWalletCredentialStore::shared()`), own a `NetworkTransport` (made their child) and pass the client name `tokkl-kde`. The core `Connection` and `ConnectionSetup` have no constructor that picks a store or a client name; the caller passes both, and the core tests pass `FakeCredentialStore` and `tokkl-test`. `src/qmltypes.h` exposes the types to QML through `QML_FOREIGN`: `KdeConnection`, `KdeConnectionSetup`, `AppletChainStore` and `TimerController` as `TokklConnection`, `TokklConnectionSetup`, `TokklChainStore` and `TokklTimer`, and the core `Connection` and `ConnectionSetup` as `QML_ANONYMOUS`. The backend module links both libraries, so the installed plugin links KDE Wallet, and for `AppletChainStore` also libplasma and KF6 ConfigCore. `desktop/kde/CMakeLists.txt` asks for KF6 `Config` itself because libplasma's CMake package names it in its link interface without finding it; `debian/control` build-depends on `libkf6config-dev` and the RPM spec on `cmake(KF6Config)`.

The version defaults to the root `package.json` (`TOKKL_PACKAGE_JSON`, resolved by `desktop/core/cmake/TokklVersion.cmake`); `-DTOKKL_VERSION=<semver>` overrides it, and a copy built outside the repository needs it. The source `package/metadata.json` has no `Version`; `desktop/kde/cmake/TokklMetadata.cmake` stamps the resolved version into the package it assembles and installs. The package's `contents/` in the build tree is emptied and copied again on every configure, so files removed from `package/contents/` do not linger.

`desktop/kde/README.md` is the companion's guide: install, upgrade and remove; adding the widget to a panel; connection settings; accounts and privacy; the panel state table; the timer; packages; CI and releases; and the real Plasma smoke checklist. Build dependencies and install commands are there too. The PRD allows the companion: a narrowed non-goal and requirements C5 and C6 in `docs/PRD.md`. No GitHub release carries the packages yet (v1.0.0 and v1.0.1 have no assets; checked 2026-10-16), so the README tells readers to build them.

<!-- Verified against the current code on 2026-10-16. -->

<!-- kk:related:start -->
# Related

- Related: [practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies](../connection-and-credentials/practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies.md)
- Related: [practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite](../connection-and-credentials/practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md)
- Related: [practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing](../connection-and-credentials/practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing.md)
- Related: [map-npm-workspaces-package-layout](../../repo-and-scripts/map-npm-workspaces-package-layout.md)
- Related: [map-kde-native-packaging](../map-kde-native-packaging.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../../.redirects.json)
<!-- kk:citations:end -->
