---
type: practice
title: 'KDE companion requests: Basic auth, access kinds and stale replies'
description: >-
  Basic auth with the instance path prefix, no followed redirects; Access kinds
  decide what 401/403 mean; older-generation replies drop.
tags:
  - kde
  - desktop
  - auth
kk_schema_version: 3
kk_id: practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - practice-password-checks-go-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
The client in `desktop/core/src` signs every request with HTTP Basic: `<token>:api_token` in token mode, `<email>:<password>` in password mode (`basicAuthorization` in `instanceurl.cpp`). `InstanceUrl::api()` keeps any path prefix of the instance address, so `https://host/tokkl` calls `https://host/tokkl/api/v9/...`. The transport uses `ManualRedirectPolicy`, because a followed redirect could carry the `Authorization` header to another origin. `GET /api/v9/me` validates the credentials and binds the user and its `default_workspace_id`, and every later operation uses that workspace. Before the first `/me` of each generation, and before each later one until the server has answered it, `AuthSession` sends `GET /api/app/status` and waits for its answer. It carries the same `Authorization` header, which that route ignores. A failed status read never changes the session state.

`ApiClient::call<T>()` (`apiclient.h`) takes an `ApiAccess` kind: `Read`, `Write` (refused unless `canWrite()`) or `Account`. `AuthSession` decides what each kind may do: `refusal()` before a request goes out, `absorbFailure()` after it fails. Only `Account` requests (`/me` and `GET /api/app/timer`) and a refusal that ends the event stream treat both 401 and 403 as refused credentials. `AuthSession::refuseCredentials` resets the account, sets `AuthenticationFailed` and pauses automatic retries, and `canWrite()` stays false until `reconnect()` or a settings change clears the pause. A 401 on any other request does the same. A 403 from a `Read` or `Write` request goes back to the caller unchanged, because a workspace 403 can mean many things. A 429 starts a cooldown from `Retry-After` (delta seconds or an HTTP date, clamped to 1 s to 1 h), or 60 s (`defaultCooldownMs`) when the header is missing. A 503 with `Retry-After` starts the same cooldown (`asksToWait()` in `apierrors.cpp`), on `/me`, the status read, any other request and a stream's end; it stays a `Server` error, so a write's outcome is still unknown. A 503 without the header is a plain transient failure. The API's limiter 429s (password and setup-code failures) send `Retry-After` as whole seconds from 1 to 900.

An error answer's `Tokkl-Error-Code` and `Tokkl-Error-Field` headers reach `HttpResponse::errorCode` and `errorField` (`NetworkTransport`), then `ApiError::code` and `ApiError::field` (`errorFromResponse()`). Both are empty from a server that sends neither. `PomodoroPreferences` takes a refused length from `field` alone; a refusal without the header, or one whose field names none of the four lengths, is the general error. `Connection` reads and saves the preferences through `/api/app/me/preferences`, whose refusals carry the headers; every supported server has it (`ServerFloor`). A 404 is a refusal; nothing is sent again elsewhere.

Changing a setting or the stored secret starts a new generation. Account data clears at once, requests in flight abort, and any reply issued under an older generation is dropped. Wallet reads check both the generation and the credential key they were issued for. Keep this check on every new asynchronous callback.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](../plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt](../../../api-and-data/password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md)
<!-- kk:related:end -->
