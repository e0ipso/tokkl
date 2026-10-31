---
type: map
title: 'macOS app layout: portable Qt library and native shims'
description: >-
  Tokkl.app on tokklcore: standalone CMake, LSUIElement, macOS 13;
  Linux-testable src/ library and the three .mm shims
tags:
  - tooling
  - desktop
  - macos
kk_schema_version: 3
kk_id: map-macos-app-layout-portable-qt-library-and-native-shims
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-gnome-timerd-d-bus-timer-service
  - map-macos-menu-bar-timer-actions-and-settings-window-save
  - map-macos-bundle-icon-and-nsstatusitem-status-image
  - map-macos-ci-job-and-dmg-release-publishing
kk_depends_on: []
kk_confidence: high
---
`desktop/macos/` is a Qt 6 menu bar app, `Tokkl.app`, on the shared `tokklcore` (`desktop/core`). It is a standalone CMake project; the npm workspaces and the server image build and ship nothing from it. Requests carry the client name `tokkl-macos`. The bundle sets `LSUIElement` in `cmake/Info.plist.in`, so the menu bar item is its only presence, and the deployment target is macOS 13 because `SMAppService` needs it.

The code is split so most of it builds and runs on Linux. The platform-neutral library in `src/` (`menubarapp`, `statusmenu`, `statuswords`, `projectindicator`, `settingswindow`, the `StatusItem` and `LoginItem` interfaces) builds on any machine with Qt 6, and its tests (`menubarapp`, `infoplist`, plus the core's) run there. `keychaincredentialstore` is built only when QtKeychain is installed. Only three files need macOS: `macstatusitem.mm` (`NSStatusItem`), `macloginitem.mm` (`SMAppService`) and `main.mm`. Put new logic in the portable library behind those interfaces so it stays testable; keep the shims thin.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-and-d-bus-contract](../gnome-timer-service/map-gnome-timer-service-and-d-bus-contract.md)
- Related: [map-macos-menu-bar-timer-actions-and-settings-window-save](map-macos-menu-bar-timer-actions-and-settings-window-save.md)
- Related: [map-macos-bundle-icon-and-nsstatusitem-status-image](map-macos-bundle-icon-and-nsstatusitem-status-image.md)
- Related: [map-macos-ci-job-and-dmg-release-publishing](map-macos-ci-job-and-dmg-release-publishing.md)
<!-- kk:related:end -->
