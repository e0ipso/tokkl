---
type: map
title: 'macOS menu bar app: portable library, Objective-C++ shims and CI'
description: >-
  desktop/macos: a Linux-testable Qt library and three macOS shims; click and
  menu actions, the bundle icon, NSStatusItem, the CI job.
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

A primary click on the item calls `toggle()` (pause, resume or start). The menu's `startStopAction` (`statusmenu.cpp`) reads Start Timer or, while running or paused, Stop Timer, and calls `start()` or `stop()`. Stop Timer while paused only ends the chain, so it is enabled whenever no mutation is in flight, offline too; `menubarapptest` covers that offline case. The pause chain is kept by a `SettingsChainStore` on the app's `QSettings`.

The bundle icon comes from `desktop/macos/resources/Tokkl.iconset`, the ten PNGs `npm run icons` renders (see `map-app-icons-script`). On macOS the build runs `iconutil -c icns` (found with `find_program(... REQUIRED)`) into `Contents/Resources/Tokkl.icns`; `TOKKL_BUNDLE_ICON` (`Tokkl`) names it, and `cmake/Info.plist.in` sets `CFBundleIconFile` from it. `autotests/infoplisttest.cmake` and `scripts/check-dmg.sh` both check the icon.

`ProjectIndicator` (`projectindicator.h`) decides what the project slot shows: kind (empty while the project loads, outline for no project, filled for a project), shape (dot while running or paused, square while stopped), colour, pulse opacity (only the running dot pulses), reduce-motion and the accessibility label, which reads "<action>, <project>". Its unit test runs on Linux. The portable `StatusImage` (`statusimage.h`, `statusimage.cpp`) composes the button image: the full-colour clock logo at 16 pt, a 2 pt gap, then the 16 pt indicator slot, 34x16 pt in every state so the time never moves. The logo is the iconset's `icon_16x16.png` and `icon_16x16@2x.png`, compiled into the `tokklmacos` library with `qt_add_resources` in `src/CMakeLists.txt`. `MenuBarApp` passes `StatusImage::compose(...)` to `StatusItem::setImage`. `macstatusitem.mm` only draws the parts in their places with `setTemplate:NO`, so the logo keeps its colours, and keeps the indicator's label as `accessibilityDescription`. It draws the indicator with a ring in the menu bar's text colour (black on a light bar, white on a dark one) so the edge stays visible whatever the project colour, and a 66 ms timer for the pulse. The ring never fades, and Reduce Motion stops the pulse.

The Settings window saves in two steps. It calls `ConnectionSetup::saveSecret(context, done)`, whose callback says whether the Keychain write worked, and writes the URL, auth mode and email and closes only when it did. A failed write keeps the window open with the typed secret. A Keychain write can wait for the user to allow access, so the Save button is disabled meanwhile.

The app uses `NSStatusItem` instead of `QSystemTrayIcon` because the tray icon API has only an icon, a tooltip and a menu, so it cannot show text, and Qt's Cocoa backend sets only the button image and opens the menu on every click.

The `macos` CI job in `.github/workflows/ci.yml` runs on `macos-latest` with Qt 6.11.3 from `jurplel/install-qt-action` (pinned to a commit SHA) and QtKeychain 0.17.0 built from source; the clone is checked against a pinned commit. The build fails if CMake finds a Qt outside `QT_ROOT_DIR`, so a Homebrew Qt on the runner cannot slip in. It builds `Tokkl.app`, runs CTest, checks the bundle's `Info.plist` and starts the app once to see that it stays up. The `release` job lists `macos` in `needs`, so a red `macos` job blocks a release. The job also runs `scripts/package-dmg.sh` and `scripts/check-dmg.sh` on the build, so a broken bundle fails the pull request, not the release. The development hosts do not run macOS, so that job is the only place the `.mm` files are compiled; a red `macos` job is the first sign of an error in them.

The DMG is built and attached after the release exists. `release` exposes `outputs.tag` (empty when semantic-release made no release). `macos-release` runs on `macos-latest` when that tag is set, checks out `v<version>`, fails if `package.json` there does not hold the version, builds through `.github/actions/macos-build` with `-DTOKKL_VERSION`, packages `Tokkl-<version>-arm64.dmg` with `package-dmg.sh` and uploads it as the `macos-dmg` artifact. `macos-publish` runs on ubuntu with `contents: write` and runs `gh release upload --clobber`, so the job that builds third-party code holds no write token and a re-run replaces the asset. `scripts/release-publish.test.ts` runs the `macos-publish` upload step and the "Check the version" step with a stub `gh`. The DMG therefore shows up on the release a few minutes after the release is public. `macdeployqt` signs ad hoc by default (identity `-`), and arm64 binaries do not run unsigned, so keep that signing. There are no Apple secrets; the install docs tell users to run `xattr -cr /Applications/Tokkl.app` to clear quarantine. actionlint does not read composite actions, so a mistake inside `.github/actions/macos-build` shows up only when the job runs.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-gnome-timerd-d-bus-timer-service](map-gnome-timerd-d-bus-timer-service.md)
<!-- kk:related:end -->
