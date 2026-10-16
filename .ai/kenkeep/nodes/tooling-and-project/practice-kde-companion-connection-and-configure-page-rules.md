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
  - map-kde-plasma-companion-desktop-kde
  - practice-password-checks-and-csrf-rules
kk_depends_on: []
kk_confidence: high
---
The client in `desktop/kde/src` signs every request with HTTP Basic: `<token>:api_token` in token mode, `<email>:<password>` in password mode (`basicAuthorization` in `instanceurl.cpp`). `InstanceUrl::api()` keeps any path prefix of the instance address, so `https://host/tokkl` calls `https://host/tokkl/api/v9/...`. The transport uses `ManualRedirectPolicy`, because a followed redirect could carry the `Authorization` header to another origin. `GET /api/v9/me` validates the credentials and binds the user and its `default_workspace_id`, and every later operation uses that workspace.

`Connection::call<T>()` takes an `Access` kind: `Read`, `Write` (refused unless `canWrite()`) or `Account`. Only `Account` requests (`/me` and `/me/time_entries/current`) treat both 401 and 403 as refused credentials. `refuseCredentials` resets the account, sets `AuthenticationFailed` and pauses automatic retries, and `canWrite()` stays false until `reconnect()` or a settings change clears the pause. A 401 on any other request does the same. A 403 from a `Read` or `Write` request goes back to the caller unchanged, because a workspace 403 can mean many things. A 429 starts a cooldown from `Retry-After` (delta seconds or an HTTP date, clamped to 1 s to 1 h), or 60 s (`defaultCooldownMs`) when the header is missing. The API's limiter 429s (password and setup-code failures) send `Retry-After` as whole seconds from 1 to 900.

Changing a setting or the stored secret starts a new generation. Account data clears at once, requests in flight abort, and any reply issued under an older generation is dropped. Wallet reads check both the generation and the credential key they were issued for. Keep this check on every new asynchronous callback.

Plasma saves every `cfg_*` property on Apply, separately from the page's own `saveConfig()`. A `cfg_*` property that must hold a validated value cannot be an alias of the text field. `cfg_instanceUrl` in `package/contents/ui/configGeneral.qml` is a plain property set from `TokklConnectionSetup.persistedUrl(text)`. That returns the normalized address with its path prefix, or an empty string when the address is invalid or has user info, a query or a fragment, so no credential reaches the config file. `cfg_email` can stay an alias because any text is a valid value.

Secrets live only in KWallet, through `KWalletCredentialStore`. When the store fails there is no plaintext fallback. `TokklConnectionSetup` owns the secret field and tracks which account a loaded or saved secret belongs to. It clears that secret when the URL, auth mode or email changes, so the secret is never tested against or saved under another account; a secret the user typed stays until saved. Tests inject `FakeTransport` and `FakeCredentialStore` (`autotests/fakes.h`) and never use the real wallet.

<!-- kk:related:start -->
# Related

- Related: [map-kde-plasma-companion-desktop-kde](map-kde-plasma-companion-desktop-kde.md)
- Related: [practice-password-checks-and-csrf-rules](../api-and-data/practice-password-checks-and-csrf-rules.md)
<!-- kk:related:end -->
