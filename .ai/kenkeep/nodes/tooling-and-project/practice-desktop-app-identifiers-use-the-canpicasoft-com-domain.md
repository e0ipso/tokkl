---
type: practice
title: Desktop app identifiers use the canpicasoft.com domain
description: >-
  KDE, macOS and GNOME identifiers use com.canpicasoft.tokkl /
  tokkl@canpicasoft.com, never com.github.e0ipso or e0ipso.github.com.
tags:
  - desktop
  - kde
  - macos
  - gnome
  - packaging
kk_schema_version: 3
kk_id: practice-desktop-app-identifiers-use-the-canpicasoft-com-domain
kk_derived_from:
  - 'ff145c98-d4fa-437e-9a73-8d0d0a861a99:practice:0'
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-macos-menu-bar-app
  - map-gnome-shell-extension-for-tokkl-timerd
  - map-kde-native-packaging
kk_depends_on: []
kk_confidence: medium
---
Every desktop app identifier is under the `canpicasoft.com` domain. Never use a `com.github.e0ipso` or `e0ipso.github.com` form.

- **KDE:** the plasmoid `Id` and `Icon` in `desktop/kde/package/metadata.json` are `com.canpicasoft.tokkl`. CMake reads the ID from there, so the QML backend import is `com.canpicasoft.tokkl.backend` and it installs under `qt6/qml/com/canpicasoft/tokkl/backend/` (the RPM spec `%dir` entries follow).
- **macOS:** the bundle ID (`TOKKL_BUNDLE_ID` in `desktop/macos/CMakeLists.txt`) is `com.canpicasoft.tokkl`, `main.mm` sets the organization domain to `canpicasoft.com` (settings plist `~/Library/Preferences/com.canpicasoft.Tokkl.plist`), and the status item's `autosaveName` is `com.canpicasoft.tokkl.timer`.
- **GNOME:** the extension UUID in `desktop/gnome/extension/metadata.json` is `tokkl@canpicasoft.com`; the check scripts read it from that file.

These IDs are what existing installs key on: Plasma stores panel widgets by plugin ID, macOS reads settings from the bundle-domain plist, and GNOME treats a new UUID as a different extension. Changing one breaks saved widgets, settings or the installed extension for current users.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-macos-menu-bar-app → map-macos-app-layout-portable-qt-library-and-native-shims](macos-menu-bar-app/map-macos-app-layout-portable-qt-library-and-native-shims.md)
- Related: [map-macos-menu-bar-app → map-macos-bundle-icon-and-nsstatusitem-status-image](macos-menu-bar-app/map-macos-bundle-icon-and-nsstatusitem-status-image.md)
- Related: [map-macos-menu-bar-app → map-macos-ci-job-and-dmg-release-publishing](macos-menu-bar-app/map-macos-ci-job-and-dmg-release-publishing.md)
- Related: [map-macos-menu-bar-app → map-macos-menu-bar-timer-actions-and-settings-window-save](macos-menu-bar-app/map-macos-menu-bar-timer-actions-and-settings-window-save.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix](gnome-shell-extension/map-gnome-shell-extension-ci-harnesses-and-shell-version-matrix.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-packaging-and-preferences](gnome-shell-extension/map-gnome-shell-extension-packaging-and-preferences.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-panel-button-and-menu](gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md)
- Related: [map-gnome-shell-extension-for-tokkl-timerd → map-gnome-shell-extension-project-indicator-and-chosen-project-label](gnome-shell-extension/map-gnome-shell-extension-project-indicator-and-chosen-project-label.md)
- Related: [map-kde-native-packaging](kde-companion/map-kde-native-packaging.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] ff145c98-d4fa-437e-9a73-8d0d0a861a99:practice:0
<!-- kk:citations:end -->
