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

The code is split so most of it builds and runs on Linux. The platform-neutral library in `src/` (`menubarapp`, `statusmenu`, `statuswords`, `projectindicator`, `settingswindow`, the `StatusItem` and `LoginItem` interfaces) builds on any machine with Qt 6, and its tests (`menubarapp`, `infoplist`, plus the core's) run there. `keychaincredentialstore` is built only when QtKeychain is installed. Only three files need macOS: `macstatusitem.mm` (`NSStatusItem`), `macloginitem.mm` (`SMAppService`) and `main.mm`. Put new logic in the portable library behind those interfaces so it stays testable; keep the shims thin. The tests reach the app through the Qt object tree, never through test-only members. The app's parts (connection, timer, session, preferences, sounds, alarm, status menu) are its children, found by type with `appPart<T>()`; the settings window is a top-level widget, which each test fixture tells apart from earlier fixtures' (`newSettingsWindow()`); the menu items and settings fields carry the object names listed in `statusmenu.h` and `settingswindow.h`, found with `part<T>()` in `menubarapptest.cpp`. No production class befriends a test or exposes a part for one; make a new part a child, or give a new item or field an object name. `statuswords.cpp` decides no status rule: the tooltip, the menu's state line (`menuLine()`) and the menu bar mark come from the core's `StatusPresentation` with `StatusPolicy::macos()`, and it only puts words to the parts.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions](../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-desktop-kde-readme-guide-prd-scope-and-release-assets](../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-readme-guide-prd-scope-and-release-assets.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-desktop-version-resolution-and-plasma-metadata-stamping](../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-version-resolution-and-plasma-metadata-stamping.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-kde-qml-foreign-types-and-backend-module-linking](../kde-companion/plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](../gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-org-tokkl-timer1-interface-file-members-and-interfaceversion](../gnome-timer-service/timer1-d-bus-contract/map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-actions-presentation-status-and-alarmerror-properties](../gnome-timer-service/timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-methods-requests-refreshprojects-configure-and-activate](../gnome-timer-service/timer1-d-bus-contract/map-timer1-methods-requests-refreshprojects-configure-and-activate.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-propertieschanged-publication-from-timerservice](../gnome-timer-service/timer1-d-bus-contract/map-timer1-propertieschanged-publication-from-timerservice.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-timer-project-and-pomodoro-limit-properties](../gnome-timer-service/timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-tokkl-timerd-daemon-composition-root-and-secret-storage](../gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md)
- Related: [map-macos-menu-bar-timer-actions-and-settings-window-save](map-macos-menu-bar-timer-actions-and-settings-window-save.md)
- Related: [map-macos-bundle-icon-and-nsstatusitem-status-image](map-macos-bundle-icon-and-nsstatusitem-status-image.md)
- Related: [map-macos-ci-job-and-dmg-release-publishing](map-macos-ci-job-and-dmg-release-publishing.md)
<!-- kk:related:end -->
