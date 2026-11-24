---
type: map
title: 'Timer1 methods: requests, RefreshProjects, Configure and Activate'
description: >-
  Timer1 Request* methods and RequestFinished, deprecated members,
  RefreshProjects on menu open, Configure errors, Activate results.
tags:
  - gnome
  - dbus
kk_schema_version: 3
kk_id: map-timer1-methods-requests-refreshprojects-configure-and-activate
kk_derived_from: []
kk_relates_to:
  - map-gnome-shell-extension-panel-button-and-menu
  - map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix
  - map-gnome-shell-extension-packaging-and-preferences
  - map-org-tokkl-timer1-interface-file-members-and-interfaceversion
kk_depends_on: []
kk_confidence: high
---
- `RequestStart`, `RequestStop`, `RequestPause` and `RequestResume` do what the plain method does and return a request id, 0 when nothing was sent. `RequestFinished(t request, b ok, s error)` follows the server's answer, after the properties it changed: `error` is `TimerController::writeFinished()`'s message, as `ErrorString` words it, and empty when a new generation ended the write. The service follows one request at a time, as the timer sends one write at a time. The plain methods keep their signatures and send no `RequestFinished`. The extension always sends the request forms. `Start`, `Stop`, `Pause`, `Resume` and the `StartTime` and `ChosenProjectName` properties carry the `org.freedesktop.DBus.Deprecated` annotation: they stay for third-party callers, the comments name what replaces them (the request methods, `LocalStartTime` and `ChosenProjectLabel`), and nothing in the repo but the service's own tests, the real-service check and the Shell harness's mock (which implements the whole interface) uses them. The member comments say nothing about how a client treats a service without a member: the extension refuses every service below `OLDEST_SUPPORTED_INTERFACE_VERSION`, so there is no older service to describe.
- `RefreshProjects` is the extension's menu-open check (`refreshProjectsOnOpen()` in `timer1.js`, on the menu's `open-state-changed`): the service calls `TimerController::refreshProjects()`, which reads the catalog revision and the list only when it moved; `Projects` changes as usual. It is part of version 2, which no release has published yet, so the version stays 2. The extension sends it only to a running service at or above the floor, since a call to an absent service would start it, and only logs a failure. The Shell harness mock counts these calls apart from the others (`ProjectChecks`), because every menu opening sends one.
- `Configure` with an empty secret keeps the secret the credential store holds for that account. A nonempty one is saved first; if the store refuses, the call fails with `org.tokkl.Timer1.Error.CredentialStore` (`TimerService::credentialStoreError`) and the settings stay as they were. A call that a later `Configure` replaced while the store saved its secret fails with `org.tokkl.Timer1.Error.Superseded` (`TimerService::supersededError`, `ServiceSettings::Outcome::Kind::Superseded`): its settings were never applied, and the preferences keep settings only on success.
- `Activate` returns "ignored" whenever nothing applied, also in Timer mode when the timer's toggle sent nothing (no account, no state read, a write waiting). The extension acts only on "open-menu".

<!-- kk:related:start -->
# Related

- Related: [map-gnome-shell-extension-panel-button-and-menu](../../gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](../../gnome-shell-extension/map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
- Related: [map-gnome-shell-extension-packaging-and-preferences](../../gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md)
- Related: [map-org-tokkl-timer1-interface-file-members-and-interfaceversion](map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
<!-- kk:related:end -->
