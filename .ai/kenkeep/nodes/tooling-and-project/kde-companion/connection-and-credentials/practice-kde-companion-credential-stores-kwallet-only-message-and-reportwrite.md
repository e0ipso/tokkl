---
type: practice
title: 'KDE companion credential stores: KWallet only, message() and reportWrite'
description: >-
  Secrets live only in KWallet with no plaintext fallback; store wording via
  message(); writes report through reportWrite; tests use fakes.
tags:
  - kde
  - desktop
  - auth
  - configuration
kk_schema_version: 3
kk_id: practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
kk_depends_on: []
kk_confidence: high
---
Secrets live only in KWallet, through `KWalletCredentialStore`. When the store fails there is no plaintext fallback. The core `Connection` and `ConnectionSetup` are handed a `CredentialStore` and never pick one; only `KdeConnection` and `KdeConnectionSetup` (library `tokklkde`) pass the process-wide KWallet store, and QML creates those as `TokklConnection` and `TokklConnectionSetup`. User-facing wording comes from the virtual `CredentialStore::message(result)`: the base text names no platform, and `KWalletCredentialStore` keeps the KDE Wallet and System Settings wording. Once the store has been destroyed, `Connection` shows the neutral text. Route new store failures through `message()` so no platform name enters `tokklcore`. The client name is likewise a constructor argument of `NetworkTransport` and `Connection`: it fills `created_with` and the User-Agent `<name>/<version>`, and the KDE types pass `tokkl-kde`; no `tokkl-kde` literal belongs in `tokklcore`. `TokklConnectionSetup` owns the secret field and tracks which account a loaded or saved secret belongs to. It clears that secret when the URL, auth mode or email changes, so the secret is never tested against or saved under another account; a secret the user typed stays until saved. `ConnectionSetup::saveSecret(QObject *context, std::function<void(bool)> done)` reports whether the credential write worked, and a caller that must not act on a failed write (the macOS Settings window) waits for it. The no-argument `saveSecret()` that QML calls forwards to it and ignores the result. A refused credential write is reported, never swallowed. A store calls the protected `CredentialStore::reportWrite(key, result)` after each write, which emits `secretChanged` or `secretWriteFailed(key, result)`; the signal carries the status and the key but never the secret, so a new store must go through `reportWrite` and not emit either signal itself. `Connection` answers a failure for its own credential key with the `WalletError` state and "The new credentials were not saved." plus the store's `message()`. If the refusal arrives before the settings for that key do (a page that saves the secret before the settings), `Connection` remembers it, shows it on the next reload for that key, and drops it if the reload is for another key. `reconnect()` or a later successful write clears it. A refused write for the current account also drops the working session, on KWallet, macOS Keychain and GNOME keyring alike, because the store no longer holds what the user typed. `ConnectionSetup` emits `secretSaveFinished(bool)` from the QML-callable `saveSecret()`.

Core tests inject `FakeTransport` and `FakeCredentialStore` (`desktop/core/autotests/fakes.h`) and never use the real wallet; the real KDE Wallet client is tested only against the private-bus fake in `kdeconnection` (see [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)).

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](../plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
<!-- kk:related:end -->
