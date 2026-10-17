---
type: map
title: 'macOS menu bar app: portable library, Objective-C++ shims and CI'
description: >-
  desktop/macos splits a Linux-testable Qt library from three macOS-only shims;
  why NSStatusItem; what the macos CI job covers.
tags:
  - tooling
  - desktop
  - macos
  - ci
kk_schema_version: 3
kk_id: map-macos-menu-bar-app
kk_derived_from: []
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-gnome-timerd-d-bus-timer-service
kk_depends_on: []
kk_confidence: high
---
`desktop/macos/` is a Qt 6 menu bar app, `Tokkl.app`, on the shared `tokklcore` (`desktop/core`). It is a standalone CMake project; the npm workspaces and the server image build and ship nothing from it. Requests carry the client name `tokkl-macos`. The bundle sets `LSUIElement` in `cmake/Info.plist.in`, so the menu bar item is its only presence, and the deployment target is macOS 13 because `SMAppService` needs it.

The code is split so most of it builds and runs on Linux. The platform-neutral library in `src/` (`menubarapp`, `statusmenu`, `statuswords`, `projectindicator`, `settingswindow`, the `StatusItem` and `LoginItem` interfaces) builds on any machine with Qt 6, and its tests (`menubarapp`, `infoplist`, plus the core's) run there. `keychaincredentialstore` is built only when QtKeychain is installed. Only three files need macOS: `macstatusitem.mm` (`NSStatusItem`), `macloginitem.mm` (`SMAppService`) and `main.mm`. Put new logic in the portable library behind those interfaces so it stays testable; keep the shims thin.

`ProjectIndicator` (`projectindicator.h`) decides what the project slot shows: kind (empty while the project loads, outline for no project, filled for a project), shape (dot while running, square while stopped), colour, pulse opacity, reduce-motion and the accessibility label, which reads "<action>, <project>". Its unit test runs on Linux. `macstatusitem.mm` only draws it as the `NSStatusItem` button image, with a ring in the menu bar's text colour (black on a light bar, white on a dark one) so the edge stays visible whatever the project colour, and a 66 ms timer for the pulse. The ring never fades, and Reduce Motion stops the pulse.

The Settings window saves in two steps. It calls `ConnectionSetup::saveSecret(context, done)`, whose callback says whether the Keychain write worked, and writes the URL, auth mode and email and closes only when it did. A failed write keeps the window open with the typed secret. A Keychain write can wait for the user to allow access, so the Save button is disabled meanwhile.

The app uses `NSStatusItem` instead of `QSystemTrayIcon` because the tray icon API has only an icon, a tooltip and a menu, so it cannot show text, and Qt's Cocoa backend sets only the button image and opens the menu on every click.

The `macos` CI job in `.github/workflows/ci.yml` runs on `macos-latest` with Qt 6.11.3 from `jurplel/install-qt-action` (pinned to a commit SHA) and QtKeychain 0.17.0 built from source; the clone is checked against a pinned commit. The build fails if CMake finds a Qt outside `QT_ROOT_DIR`, so a Homebrew Qt on the runner cannot slip in. It builds `Tokkl.app`, runs CTest, checks the bundle's `Info.plist` and starts the app once to see that it stays up. The `release` job lists `macos` in `needs`, so a red `macos` job blocks a release, but the release ships no macOS artifact. The development hosts do not run macOS, so that job is the only place the `.mm` files are compiled; a red `macos` job is the first sign of an error in them.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-gnome-timerd-d-bus-timer-service](map-gnome-timerd-d-bus-timer-service.md)
<!-- kk:related:end -->
