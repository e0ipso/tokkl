---
type: practice
title: 'KDE Configure page: cfg_instanceUrl and the wallet save timing'
description: >-
  cfg_instanceUrl holds only persistedUrl(); on a failed secret save the page
  keeps the input and re-enables Apply; OK still closes.
tags:
  - kde
  - desktop
  - configuration
kk_schema_version: 3
kk_id: practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing
kk_derived_from: []
kk_relates_to:
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
kk_depends_on: []
kk_confidence: high
---
Plasma saves every `cfg_*` property on Apply, separately from the page's own `saveConfig()`. A `cfg_*` property that must hold a validated value cannot be an alias of the text field. `cfg_instanceUrl` in `package/contents/ui/configGeneral.qml` is a plain property set from `TokklConnectionSetup.persistedUrl(text)`. That returns the normalized address with its path prefix, or an empty string when the address is invalid or has user info, a query or a fragment, so no credential reaches the config file. `cfg_email` can stay an alias because any text is a valid value.

The Configure page and Plasma's dialog disagree about timing, and the page cannot fix it. `AppletConfiguration.qml` disables Apply after `saveConfig()` returns and closes the dialog on OK, while the wallet answers later; `ConfigView` deletes itself on hide, so a page cannot hold the dialog open. `configGeneral.qml` therefore listens to `secretSaveFinished` and, on failure, keeps the typed secret and error on the page and emits `configurationChanged()`, which re-enables Apply and makes closing prompt. OK still closes before the answer. An upstream proposal for a way to hold the dialog is filed as a dx item; do not work around it in the page. `tst_configure.qml` covers the page with `FakeConnectionSetup` and `WalletFixture`.

<!-- kk:related:start -->
# Related

- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
<!-- kk:related:end -->
