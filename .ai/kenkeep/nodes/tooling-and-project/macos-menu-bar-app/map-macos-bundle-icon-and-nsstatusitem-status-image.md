---
type: map
title: macOS bundle icon and NSStatusItem status image
description: >-
  Tokkl.iconset to Tokkl.icns via iconutil; ProjectIndicator, StatusImage and
  macstatusitem.mm drawing; why NSStatusItem
tags:
  - desktop
  - macos
kk_schema_version: 3
kk_id: map-macos-bundle-icon-and-nsstatusitem-status-image
kk_derived_from: []
kk_relates_to:
  - map-macos-app-layout-portable-qt-library-and-native-shims
kk_depends_on: []
kk_confidence: high
---
The bundle icon comes from `desktop/macos/resources/Tokkl.iconset`, the ten PNGs `npm run icons` renders (see `map-app-icons-script`). On macOS the build runs `iconutil -c icns` (found with `find_program(... REQUIRED)`) into `Contents/Resources/Tokkl.icns`; `TOKKL_BUNDLE_ICON` (`Tokkl`) names it, and `cmake/Info.plist.in` sets `CFBundleIconFile` from it. `autotests/infoplisttest.cmake` and `scripts/check-dmg.sh` both check the icon.

`ProjectIndicator` (`projectindicator.h`) decides what the project slot shows: kind (empty while the project loads, outline for no project, filled for a project), shape (dot while running or paused, square while stopped), colour, pulse opacity (only the running dot pulses), reduce-motion and the accessibility label, which reads "<action>, <project>". Its unit test runs on Linux. The portable `StatusImage` (`statusimage.h`, `statusimage.cpp`) composes the button image: the full-colour clock logo at 16 pt, a 2 pt gap, then the 16 pt indicator slot, 34x16 pt in every state so the time never moves. The logo is the iconset's `icon_16x16.png` and `icon_16x16@2x.png`, compiled into the `tokklmacos` library with `qt_add_resources` in `src/CMakeLists.txt`. `MenuBarApp` passes `StatusImage::compose(...)` to `StatusItem::setImage`. `macstatusitem.mm` only draws the parts in their places with `setTemplate:NO`, so the logo keeps its colours, and keeps the indicator's label as `accessibilityDescription`. It draws the indicator with a ring in the menu bar's text colour (black on a light bar, white on a dark one) so the edge stays visible whatever the project colour, and a 66 ms timer for the pulse. The ring never fades, and Reduce Motion stops the pulse.

The app uses `NSStatusItem` instead of `QSystemTrayIcon` because the tray icon API has only an icon, a tooltip and a menu, so it cannot show text, and Qt's Cocoa backend sets only the button image and opens the menu on every click.

<!-- kk:related:start -->
# Related

- Related: [map-macos-app-layout-portable-qt-library-and-native-shims](map-macos-app-layout-portable-qt-library-and-native-shims.md)
<!-- kk:related:end -->
