---
type: practice
title: 'KDE companion: connection errors, settings generations and the Configure page'
description: >-
  Access kinds decide what a 401/403 means; old-generation replies drop;
  cfg_instanceUrl holds only persistedUrl(); secrets only in KWallet.
tags:
  - kde
  - desktop
  - auth
  - configuration
kk_schema_version: 3
kk_id: practice-kde-companion-connection-and-configure-page-rules
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
  - practice-password-checks-go-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
The client in `desktop/kde/src` signs every request with HTTP Basic: `<token>:api_token` in token mode, `<email>:<password>` in password mode (`basicAuthorization` in `instanceurl.cpp`). `InstanceUrl::api()` keeps any path prefix of the instance address, so `https://host/tokkl` calls `https://host/tokkl/api/v9/...`. The transport uses `ManualRedirectPolicy`, because a followed redirect could carry the `Authorization` header to another origin. `GET /api/v9/me` validates the credentials and binds the user and its `default_workspace_id`, and every later operation uses that workspace.

`Connection::call<T>()` takes an `Access` kind: `Read`, `Write` (refused unless `canWrite()`) or `Account`. Only `Account` requests (`/me` and `/me/time_entries/current`) treat both 401 and 403 as refused credentials. `refuseCredentials` resets the account, sets `AuthenticationFailed` and pauses automatic retries, and `canWrite()` stays false until `reconnect()` or a settings change clears the pause. A 401 on any other request does the same. A 403 from a `Read` or `Write` request goes back to the caller unchanged, because a workspace 403 can mean many things. A 429 starts a cooldown from `Retry-After` (delta seconds or an HTTP date, clamped to 1 s to 1 h), or 60 s (`defaultCooldownMs`) when the header is missing. The API's limiter 429s (password and setup-code failures) send `Retry-After` as whole seconds from 1 to 900.

Changing a setting or the stored secret starts a new generation. Account data clears at once, requests in flight abort, and any reply issued under an older generation is dropped. Wallet reads check both the generation and the credential key they were issued for. Keep this check on every new asynchronous callback.

Plasma saves every `cfg_*` property on Apply, separately from the page's own `saveConfig()`. A `cfg_*` property that must hold a validated value cannot be an alias of the text field. `cfg_instanceUrl` in `package/contents/ui/configGeneral.qml` is a plain property set from `TokklConnectionSetup.persistedUrl(text)`. That returns the normalized address with its path prefix, or an empty string when the address is invalid or has user info, a query or a fragment, so no credential reaches the config file. `cfg_email` can stay an alias because any text is a valid value.

Secrets live only in KWallet, through `KWalletCredentialStore`. When the store fails there is no plaintext fallback. The core `Connection` and `ConnectionSetup` are handed a `CredentialStore` and never pick one; only `KdeConnection` and `KdeConnectionSetup` (library `tokklkde`) pass the process-wide KWallet store, and QML creates those as `TokklConnection` and `TokklConnectionSetup`. User-facing wording comes from the virtual `CredentialStore::message(result)`: the base text names no platform, and `KWalletCredentialStore` keeps the KDE Wallet and System Settings wording. Once the store has been destroyed, `Connection` shows the neutral text. Route new store failures through `message()` so no platform name enters `tokklcore`. The client name is likewise a constructor argument of `NetworkTransport` and `Connection`: it fills `created_with` and the User-Agent `<name>/<version>`, and the KDE types pass `tokkl-kde`; no `tokkl-kde` literal belongs in `tokklcore`. `TokklConnectionSetup` owns the secret field and tracks which account a loaded or saved secret belongs to. It clears that secret when the URL, auth mode or email changes, so the secret is never tested against or saved under another account; a secret the user typed stays until saved. `ConnectionSetup::saveSecret(QObject *context, std::function<void(bool)> done)` reports whether the credential write worked, and a caller that must not act on a failed write (the macOS Settings window) waits for it. The no-argument `saveSecret()` that QML calls forwards to it and ignores the result. A refused credential write is reported, never swallowed. A store calls the protected `CredentialStore::reportWrite(key, result)` after each write, which emits `secretChanged` or `secretWriteFailed(key, result)`; the signal carries the status and the key but never the secret, so a new store must go through `reportWrite` and not emit either signal itself. `Connection` answers a failure for its own credential key with the `WalletError` state and "The new credentials were not saved." plus the store's `message()`. If the refusal arrives before the settings for that key do (a page that saves the secret before the settings), `Connection` remembers it, shows it on the next reload for that key, and drops it if the reload is for another key. `reconnect()` or a later successful write clears it. A refused write for the current account also drops the working session, on KWallet, macOS Keychain and GNOME keyring alike, because the store no longer holds what the user typed. `ConnectionSetup` emits `secretSaveFinished(bool)` from the QML-callable `saveSecret()`.

The Configure page and Plasma's dialog disagree about timing, and the page cannot fix it. `AppletConfiguration.qml` disables Apply after `saveConfig()` returns and closes the dialog on OK, while the wallet answers later; `ConfigView` deletes itself on hide, so a page cannot hold the dialog open. `configGeneral.qml` therefore listens to `secretSaveFinished` and, on failure, keeps the typed secret and error on the page and emits `configurationChanged()`, which re-enables Apply and makes closing prompt. OK still closes before the answer. An upstream proposal for a way to hold the dialog is filed as a dx item; do not work around it in the page. `tst_configure.qml` covers the page with `FakeConnectionSetup` and `WalletFixture`.

Core tests inject `FakeTransport` and `FakeCredentialStore` (`desktop/core/autotests/fakes.h`) and never use the real wallet; the real KDE Wallet client is tested only against the private-bus fake in `kdeconnection` (see [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)).

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt](../../api-and-data/password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md)
<!-- kk:related:end -->
